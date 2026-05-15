// packages/audio-studio/ios/AudioStreamDecoder.swift
//
// Progressive file decoder for `streamAudioData`. Decodes a stored audio
// file into bounded Float32 chunks via AVAssetReader without materializing
// the full PCM range. Sanitizes samples (NaN/Inf -> 0, clamp to [-1, 1])
// and honors per-request cancellation + backpressure ack.
import AVFoundation
import Foundation

public protocol AudioStreamDecoderDelegate: AnyObject {
    func streamDecoder(
        _ decoder: AudioStreamDecoder,
        didEmitChunk payload: [String: Any]
    )
    func streamDecoder(
        _ decoder: AudioStreamDecoder,
        didReportProgress payload: [String: Any]
    )
    func streamDecoder(
        _ decoder: AudioStreamDecoder,
        didCompleteWith payload: [String: Any]
    )
    func streamDecoder(
        _ decoder: AudioStreamDecoder,
        didFailWith payload: [String: Any]
    )
}

public final class AudioStreamDecoder {
    public struct Options {
        public let requestId: String
        public let fileUri: String
        public let startTimeMs: Double?
        public let endTimeMs: Double?
        public let targetSampleRate: Double?
        public let channels: Int?
        public let normalizeAudio: Bool
        public let chunkDurationMs: Int
        public let maxChunkBytes: Int?
        public let maxBufferedChunks: Int
        public let backpressureTimeoutMs: Double?

        public init(
            requestId: String,
            fileUri: String,
            startTimeMs: Double?,
            endTimeMs: Double?,
            targetSampleRate: Double?,
            channels: Int?,
            normalizeAudio: Bool,
            chunkDurationMs: Int,
            maxChunkBytes: Int?,
            maxBufferedChunks: Int,
            backpressureTimeoutMs: Double? = nil
        ) {
            self.requestId = requestId
            self.fileUri = fileUri
            self.startTimeMs = startTimeMs
            self.endTimeMs = endTimeMs
            self.targetSampleRate = targetSampleRate
            self.channels = channels
            self.normalizeAudio = normalizeAudio
            self.chunkDurationMs = chunkDurationMs
            self.maxChunkBytes = maxChunkBytes
            self.maxBufferedChunks = max(1, maxBufferedChunks)
            self.backpressureTimeoutMs = backpressureTimeoutMs
        }
    }

    public weak var delegate: AudioStreamDecoderDelegate?

    private let options: Options
    private let queue: DispatchQueue
    private let cancelLock = NSLock()
    private var cancelled = false
    private let ackCondition = NSCondition()
    private var lastAckedIndex = -1

    public init(options: Options) {
        self.options = options
        self.queue = DispatchQueue(
            label: "net.siteed.audiostudio.streamdecoder.\(options.requestId)",
            qos: .userInitiated
        )
    }

    public func start() {
        queue.async { [weak self] in
            self?.run()
        }
    }

    public func cancel() {
        cancelLock.lock()
        cancelled = true
        cancelLock.unlock()
        ackCondition.lock()
        ackCondition.broadcast()
        ackCondition.unlock()
    }

    public func acknowledgeChunk(_ index: Int) {
        ackCondition.lock()
        if index > lastAckedIndex {
            lastAckedIndex = index
        }
        ackCondition.broadcast()
        ackCondition.unlock()
    }

    private func isCancelled() -> Bool {
        cancelLock.lock()
        defer { cancelLock.unlock() }
        return cancelled
    }

    private func run() {
        let url: URL
        if let parsed = URL(string: options.fileUri),
           parsed.scheme != nil {
            url = parsed
        } else {
            url = URL(fileURLWithPath: options.fileUri)
        }

        if !FileManager.default.fileExists(atPath: url.path) {
            emitError(
                code: "ERR_AUDIO_STREAM_FILE_NOT_FOUND",
                message: "File not found: \(url.lastPathComponent)"
            )
            return
        }

        let asset = AVURLAsset(url: url)
        guard let audioTrack = asset.tracks(withMediaType: .audio).first else {
            emitError(
                code: "ERR_AUDIO_STREAM_UNSUPPORTED_FORMAT",
                message: "No audio track found"
            )
            return
        }

        let assetDurationMs: Double = {
            let raw = CMTimeGetSeconds(asset.duration) * 1000.0
            return raw.isFinite && raw > 0 ? raw : 0.0
        }()
        // Duration of the *decoded range*, not the whole asset, so progress
        // and completion payloads match what the caller actually receives.
        let totalDurationMs: Double = {
            if let s = options.startTimeMs, let e = options.endTimeMs {
                return max(0, e - s)
            }
            if let e = options.endTimeMs {
                return max(0, e)
            }
            let start = options.startTimeMs ?? 0
            return max(0, assetDurationMs - start)
        }()

        // Read source sample rate from track.
        let sourceSampleRate: Double = {
            guard let desc = audioTrack.formatDescriptions.first else { return 0 }
            // swiftlint:disable:next force_cast
            let formatDescription = desc as! CMAudioFormatDescription
            guard let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(
                formatDescription
            )?.pointee else {
                return 0
            }
            return asbd.mSampleRate
        }()
        let sourceChannelCount: Int = {
            guard let desc = audioTrack.formatDescriptions.first else { return 1 }
            // swiftlint:disable:next force_cast
            let formatDescription = desc as! CMAudioFormatDescription
            guard let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(
                formatDescription
            )?.pointee else {
                return 1
            }
            return Int(asbd.mChannelsPerFrame)
        }()

        let outputSampleRate = options.targetSampleRate
            ?? (sourceSampleRate > 0 ? sourceSampleRate : 16000)
        // Accept the caller's value only when it's positive; explicit `0` or
        // negative input falls back to the source channel count (mirrors the
        // Android guard) so we never produce empty chunks forever.
        let outputChannels: Int = {
            if let c = options.channels, c > 0 { return c }
            return min(2, max(1, sourceChannelCount))
        }()

        let outputSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
            AVSampleRateKey: outputSampleRate,
            AVNumberOfChannelsKey: outputChannels,
        ]

        let reader: AVAssetReader
        do {
            reader = try AVAssetReader(asset: asset)
        } catch {
            emitError(
                code: "ERR_AUDIO_STREAM_DECODE_FAILED",
                message: "Reader init failed: \(error.localizedDescription)"
            )
            return
        }

        if let startMs = options.startTimeMs, let endMs = options.endTimeMs {
            if startMs < 0 || endMs <= startMs {
                emitError(
                    code: "ERR_AUDIO_STREAM_INVALID_RANGE",
                    message: "Invalid time range"
                )
                return
            }
            let start = CMTime(seconds: startMs / 1000.0, preferredTimescale: 600)
            let duration = CMTime(
                seconds: (endMs - startMs) / 1000.0,
                preferredTimescale: 600
            )
            reader.timeRange = CMTimeRange(start: start, duration: duration)
        } else if let startMs = options.startTimeMs {
            let start = CMTime(seconds: startMs / 1000.0, preferredTimescale: 600)
            reader.timeRange = CMTimeRange(
                start: start,
                duration: CMTime.positiveInfinity
            )
        } else if let endMs = options.endTimeMs {
            // endMs-only ranges are documented; treat missing startMs as 0 so
            // iOS matches Android/Web behavior instead of silently decoding the
            // full file.
            let duration = CMTime(seconds: endMs / 1000.0, preferredTimescale: 600)
            reader.timeRange = CMTimeRange(start: .zero, duration: duration)
        }

        let trackOutput = AVAssetReaderTrackOutput(
            track: audioTrack,
            outputSettings: outputSettings
        )
        trackOutput.alwaysCopiesSampleData = false

        guard reader.canAdd(trackOutput) else {
            emitError(
                code: "ERR_AUDIO_STREAM_DECODE_FAILED",
                message: "Cannot attach decoder output"
            )
            return
        }
        reader.add(trackOutput)

        guard reader.startReading() else {
            let err = reader.error?.localizedDescription ?? "Unknown reader error"
            emitError(
                code: "ERR_AUDIO_STREAM_DECODE_FAILED",
                message: "startReading failed: \(err)"
            )
            return
        }

        let samplesPerChunk = max(
            outputChannels,
            Int((Double(options.chunkDurationMs) / 1000.0) * outputSampleRate) *
                outputChannels
        )
        let cappedSamplesPerChunk: Int = {
            guard let maxBytes = options.maxChunkBytes else { return samplesPerChunk }
            // Round to a multiple of `outputChannels` so a single interleaved
            // frame is never split across chunks (which would yield a
            // fractional `startSample` for the next chunk).
            let rawMax = max(outputChannels, maxBytes / 4)
            let maxFloats = max(
                outputChannels,
                (rawMax / outputChannels) * outputChannels
            )
            return max(outputChannels, min(samplesPerChunk, maxFloats))
        }()

        var pending = [Float]()
        pending.reserveCapacity(cappedSamplesPerChunk * 2)
        // Head-index cursor over `pending`. Avoids `removeFirst(n)` (which is
        // O(remaining)) on every emitted chunk; we periodically compact when
        // the head drifts far enough that the unused prefix becomes wasteful.
        var pendingHead = 0
        let compactThreshold = max(cappedSamplesPerChunk * 4, 4096)
        var chunkIndex = 0
        var totalSamples = 0
        var processedMs: Double = 0
        var cancelledByUser = false
        var backpressureTimedOut = false
        let rangeStartMs = options.startTimeMs ?? 0

        while reader.status == .reading {
            let shouldContinue = autoreleasepool { () -> Bool in
                if isCancelled() {
                    cancelledByUser = true
                    return false
                }
                guard let sampleBuffer = trackOutput.copyNextSampleBuffer() else {
                    return false
                }
                guard let block = CMSampleBufferGetDataBuffer(sampleBuffer) else {
                    return true
                }
                let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
                if frameCount <= 0 { return true }

                var lengthAtOffset = 0
                var totalLength = 0
                var dataPointer: UnsafeMutablePointer<Int8>?
                let status = CMBlockBufferGetDataPointer(
                    block,
                    atOffset: 0,
                    lengthAtOffsetOut: &lengthAtOffset,
                    totalLengthOut: &totalLength,
                    dataPointerOut: &dataPointer
                )
                guard status == kCMBlockBufferNoErr, let raw = dataPointer else {
                    return true
                }

                let sampleCount = totalLength / MemoryLayout<Float>.size
                let floatPtr = UnsafeRawPointer(raw)
                    .assumingMemoryBound(to: Float.self)
                var idx = pending.count
                pending.append(contentsOf: repeatElement(0, count: sampleCount))
                for i in 0..<sampleCount {
                    let v = floatPtr[i]
                    if v.isNaN || v.isInfinite {
                        pending[idx] = 0
                    } else if options.normalizeAudio {
                        pending[idx] = max(-1.0, min(1.0, v))
                    } else {
                        pending[idx] = v
                    }
                    idx += 1
                }

                while (pending.count - pendingHead) >= cappedSamplesPerChunk {
                    let payload = Array(
                        pending[pendingHead..<(pendingHead + cappedSamplesPerChunk)]
                    )
                    pendingHead += cappedSamplesPerChunk
                    if pendingHead >= compactThreshold {
                        pending.removeFirst(pendingHead)
                        pendingHead = 0
                    }
                    let durationOfChunk = Double(cappedSamplesPerChunk)
                        / (outputSampleRate * Double(outputChannels))
                    let startMs = rangeStartMs
                        + (Double(totalSamples) / (outputSampleRate * Double(outputChannels))) * 1000.0
                    emitChunk(
                        index: chunkIndex,
                        startTimeMs: startMs,
                        endTimeMs: startMs + durationOfChunk * 1000.0,
                        startSample: totalSamples / outputChannels,
                        sampleRate: outputSampleRate,
                        channels: outputChannels,
                        samples: payload,
                        isFinal: false
                    )
                    chunkIndex += 1
                    totalSamples += cappedSamplesPerChunk
                    // Progress is *elapsed decoded time within the requested
                    // range* so `processedMs / durationMs` stays in [0, 1]
                    // regardless of `startTimeMs`. Chunk timestamps stay
                    // absolute (rangeStart + offset).
                    processedMs = (Double(totalSamples) /
                        (outputSampleRate * Double(outputChannels))) * 1000.0
                    emitProgress(
                        processedMs: processedMs,
                        durationMs: totalDurationMs,
                        emittedChunks: chunkIndex
                    )

                    switch waitForAckOrCancel(upTo: chunkIndex - 1) {
                    case .ok:
                        ()
                    case .cancelled:
                        cancelledByUser = true
                    case .timedOut:
                        backpressureTimedOut = true
                    }
                    if cancelledByUser || backpressureTimedOut { return false }
                }
                return true
            }
            if !shouldContinue { break }
        }

        if backpressureTimedOut {
            reader.cancelReading()
            emitError(
                code: "ERR_AUDIO_STREAM_BACKPRESSURE_TIMEOUT",
                message: "Timed out waiting for JS acknowledgement after \(Int(options.backpressureTimeoutMs ?? 0))ms"
            )
            return
        }

        if cancelledByUser {
            reader.cancelReading()
            emitError(
                code: "ERR_AUDIO_STREAM_CANCELLED",
                message: "Stream cancelled"
            )
            // `durationMs` reports the requested range (matches Android),
            // `samples` reports what was actually decoded before cancel.
            emitComplete(
                durationMs: totalDurationMs,
                sampleRate: outputSampleRate,
                channels: outputChannels,
                chunks: chunkIndex,
                samples: totalSamples,
                cancelled: true
            )
            return
        }

        if reader.status == .failed {
            let err = reader.error?.localizedDescription ?? "Unknown decode error"
            emitError(
                code: "ERR_AUDIO_STREAM_DECODE_FAILED",
                message: err
            )
            return
        }

        // Flush remaining samples as final chunk.
        let tailCount = pending.count - pendingHead
        if tailCount > 0 {
            let tail = Array(pending[pendingHead..<pending.count])
            let durationOfChunk = Double(tailCount)
                / (outputSampleRate * Double(outputChannels))
            let startMs = rangeStartMs
                + (Double(totalSamples) / (outputSampleRate * Double(outputChannels))) * 1000.0
            emitChunk(
                index: chunkIndex,
                startTimeMs: startMs,
                endTimeMs: startMs + durationOfChunk * 1000.0,
                startSample: totalSamples / outputChannels,
                sampleRate: outputSampleRate,
                channels: outputChannels,
                samples: tail,
                isFinal: true
            )
            totalSamples += tailCount
            chunkIndex += 1
            processedMs = (Double(totalSamples) /
                (outputSampleRate * Double(outputChannels))) * 1000.0
            // Mirror the per-chunk progress emission so consumers always see
            // a final `processedMs / durationMs ≈ 1.0` from `onProgress`.
            emitProgress(
                processedMs: processedMs,
                durationMs: totalDurationMs,
                emittedChunks: chunkIndex
            )
            pending.removeAll(keepingCapacity: false)
            pendingHead = 0
        } else {
            // Last emitted chunk wasn't marked final (or no data was decoded).
            // Emit a zero-sample final tail so consumers that key off isFinal
            // see termination even for empty-but-valid ranges.
            let startMs = rangeStartMs
                + (Double(totalSamples) / (outputSampleRate * Double(outputChannels))) * 1000.0
            emitChunk(
                index: chunkIndex,
                startTimeMs: startMs,
                endTimeMs: startMs,
                startSample: totalSamples / outputChannels,
                sampleRate: outputSampleRate,
                channels: outputChannels,
                samples: [Float](),
                isFinal: true
            )
            chunkIndex += 1
        }

        emitComplete(
            durationMs: totalDurationMs > 0 ? totalDurationMs : processedMs,
            sampleRate: outputSampleRate,
            channels: outputChannels,
            chunks: chunkIndex,
            samples: totalSamples,
            cancelled: false
        )
    }

    private enum AckWaitResult {
        case ok
        case cancelled
        case timedOut
    }

    /// Blocks the decoder thread while too many unacked chunks are in flight.
    private func waitForAckOrCancel(upTo index: Int) -> AckWaitResult {
        let deadline = options.backpressureTimeoutMs
            .flatMap { $0 > 0 ? Date().addingTimeInterval($0 / 1000.0) : nil }
        ackCondition.lock()
        defer { ackCondition.unlock() }
        while true {
            if isCancelled() {
                return .cancelled
            }
            let inFlight = index - lastAckedIndex
            if inFlight < options.maxBufferedChunks {
                return .ok
            }
            if let deadline, Date() >= deadline {
                return .timedOut
            }
            let nextWake = min(0.05, max(0.001, deadline?.timeIntervalSinceNow ?? 0.05))
            ackCondition.wait(until: Date().addingTimeInterval(nextWake))
        }
    }

    private func emitChunk(
        index: Int,
        startTimeMs: Double,
        endTimeMs: Double,
        startSample: Int,
        sampleRate: Double,
        channels: Int,
        samples: [Float],
        isFinal: Bool
    ) {
        let payload: [String: Any] = [
            "requestId": options.requestId,
            "chunkIndex": index,
            "startTimeMs": startTimeMs,
            "endTimeMs": endTimeMs,
            "startSample": startSample,
            "sampleCount": samples.count,
            "sampleRate": sampleRate,
            "channels": channels,
            "samples": samples,
            "isFinal": isFinal,
        ]
        delegate?.streamDecoder(self, didEmitChunk: payload)
    }

    private func emitProgress(
        processedMs: Double,
        durationMs: Double,
        emittedChunks: Int
    ) {
        let progress: Double = durationMs > 0
            ? min(1.0, max(0.0, processedMs / durationMs))
            : 0
        let payload: [String: Any] = [
            "requestId": options.requestId,
            "processedMs": processedMs,
            "durationMs": durationMs,
            "progress": progress,
            "emittedChunks": emittedChunks,
        ]
        delegate?.streamDecoder(self, didReportProgress: payload)
    }

    private func emitComplete(
        durationMs: Double,
        sampleRate: Double,
        channels: Int,
        chunks: Int,
        samples: Int,
        cancelled: Bool
    ) {
        let payload: [String: Any] = [
            "requestId": options.requestId,
            "durationMs": durationMs,
            "sampleRate": sampleRate,
            "channels": channels,
            "chunks": chunks,
            "samples": samples,
            "cancelled": cancelled,
        ]
        delegate?.streamDecoder(self, didCompleteWith: payload)
    }

    private func emitError(code: String, message: String) {
        let payload: [String: Any] = [
            "requestId": options.requestId,
            "code": code,
            "message": message,
        ]
        delegate?.streamDecoder(self, didFailWith: payload)
    }
}

/// Safe Float -> integer conversion. Replaces NaN/Inf with 0 and clamps the
/// scaled value into the integer range before constructing the bounded type,
/// avoiding the Swift trap that previously crashed the host app inside
/// `extractRawAudioData` on malformed samples.
@inline(__always)
public func safeFloatToInt16(_ sample: Float) -> Int16 {
    let safe = sample.isFinite ? max(-1.0, min(1.0, sample)) : 0
    let scaled = (safe * Float(Int16.max)).rounded()
    let clamped = max(Float(Int16.min), min(Float(Int16.max), scaled))
    return Int16(clamped)
}

@inline(__always)
public func safeFloatToInt32(_ sample: Float) -> Int32 {
    let safe = sample.isFinite ? max(-1.0, min(1.0, sample)) : 0
    let scaled = Double(safe) * Double(Int32.max)
    let rounded = scaled.rounded()
    let clamped = max(Double(Int32.min), min(Double(Int32.max), rounded))
    return Int32(clamped)
}
