import Foundation
import AVFoundation
import CSherpaOnnx

/// SherpaOnnxSpeakerIdHandler - Speaker Identification Handler
///
/// Manages speaker embedding extraction, registration, identification, and verification
/// using the sherpa-onnx C API directly.
@objc public class SherpaOnnxSpeakerIdHandler: NSObject {
    private var extractor: OpaquePointer?  // const SherpaOnnxSpeakerEmbeddingExtractor *
    private var manager: OpaquePointer?    // const SherpaOnnxSpeakerEmbeddingManager *
    private var stream: OpaquePointer?     // const SherpaOnnxOnlineStream *
    private var embeddingDim: Int = 0
    private var expectedSampleRate: Int = 16_000

    private static let TAG = "[SherpaOnnxSpeakerId]"

    @objc public override init() {
        super.init()
    }

    deinit {
        cleanupResources()
    }

    // MARK: - Init

    @objc public func initSpeakerId(_ config: NSDictionary) -> NSDictionary {
        NSLog("%@ initSpeakerId called", SherpaOnnxSpeakerIdHandler.TAG)

        guard let modelDir = config["modelDir"] as? String else {
            return ["success": false, "embeddingDim": 0, "error": "modelDir is required"]
        }

        let modelFile = config["modelFile"] as? String ?? "model.onnx"
        let numThreads = config["numThreads"] as? Int ?? 1
        let sampleRate = (config["sampleRate"] as? NSNumber)?.intValue ?? 16_000
        let debug = config["debug"] as? Bool ?? false
        let provider = config["provider"] as? String ?? "cpu"

        let modelPath = (modelDir as NSString).appendingPathComponent(modelFile)

        if !FileManager.default.fileExists(atPath: modelPath) {
            return ["success": false, "embeddingDim": 0, "error": "Model file not found: \(modelPath)"]
        }

        // Clean up previous resources
        cleanupResources()

        // Build config using upstream Swift helper
        var extractorConfig = sherpaOnnxSpeakerEmbeddingExtractorConfig(
            model: modelPath,
            numThreads: numThreads,
            debug: debug ? 1 : 0,
            provider: provider
        )

        // Create extractor
        let extractorPtr = SherpaOnnxCreateSpeakerEmbeddingExtractor(&extractorConfig)
        guard extractorPtr != nil else {
            return ["success": false, "embeddingDim": 0, "error": "Failed to create speaker embedding extractor"]
        }
        extractor = extractorPtr

        // Get embedding dimension
        embeddingDim = Int(SherpaOnnxSpeakerEmbeddingExtractorDim(extractor))
        expectedSampleRate = sampleRate

        // Create manager
        let managerPtr = SherpaOnnxCreateSpeakerEmbeddingManager(Int32(embeddingDim))
        guard managerPtr != nil else {
            SherpaOnnxDestroySpeakerEmbeddingExtractor(extractor)
            extractor = nil
            return ["success": false, "embeddingDim": 0, "error": "Failed to create speaker embedding manager"]
        }
        manager = managerPtr

        // Create initial stream
        let streamPtr = SherpaOnnxSpeakerEmbeddingExtractorCreateStream(extractor)
        if streamPtr != nil {
            stream = streamPtr
        }

        NSLog("%@ Speaker ID initialized, embeddingDim=%d", SherpaOnnxSpeakerIdHandler.TAG, embeddingDim)

        return [
            "success": true,
            "embeddingDim": embeddingDim
        ]
    }

    // MARK: - Process audio samples

    @objc public func processSamples(_ sampleRate: Int, samples: NSArray) -> NSDictionary {
        guard extractor != nil, let streamPtr = stream else {
            return ["success": false, "samplesProcessed": 0, "error": "Speaker ID not initialized"]
        }

        var floatSamples = [Float]()
        floatSamples.reserveCapacity(samples.count)
        for i in 0..<samples.count {
            if let val = samples[i] as? NSNumber {
                floatSamples.append(val.floatValue)
            }
        }

        SherpaOnnxOnlineStreamAcceptWaveform(streamPtr, Int32(sampleRate), floatSamples, Int32(floatSamples.count))

        return ["success": true, "samplesProcessed": floatSamples.count]
    }

    // MARK: - Compute embedding

    @objc public func computeEmbedding() -> NSDictionary {
        guard let extractorPtr = extractor, let streamPtr = stream else {
            return ["success": false, "durationMs": 0, "embedding": [], "embeddingDim": 0, "error": "Speaker ID not initialized"]
        }

        // Check readiness
        let isReady = SherpaOnnxSpeakerEmbeddingExtractorIsReady(extractorPtr, streamPtr)
        if isReady == 0 {
            resetEmbeddingStream(extractorPtr)
            return ["success": false, "durationMs": 0, "embedding": [], "embeddingDim": 0, "error": "Not enough audio data to compute embedding"]
        }

        let startTime = CFAbsoluteTimeGetCurrent()
        let embeddingPtr = SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding(extractorPtr, streamPtr)
        let durationMs = (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0

        guard let embPtr = embeddingPtr else {
            resetEmbeddingStream(extractorPtr)
            return ["success": false, "durationMs": 0, "embedding": [], "embeddingDim": 0, "error": "Failed to compute embedding"]
        }

        // Copy embedding to array
        var embedding = [Double]()
        embedding.reserveCapacity(embeddingDim)
        for i in 0..<embeddingDim {
            embedding.append(Double(embPtr[i]))
        }
        SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding(embeddingPtr)

        // Reset stream for next use
        resetEmbeddingStream(extractorPtr)

        return [
            "success": true,
            "durationMs": Int(durationMs),
            "embedding": embedding,
            "embeddingDim": embeddingDim
        ]
    }

    // MARK: - Register speaker

    @objc public func registerSpeaker(_ name: String, embedding: NSArray) -> NSDictionary {
        guard let managerPtr = manager else {
            return ["success": false, "error": "Speaker ID not initialized"]
        }

        var floatEmbedding = [Float]()
        floatEmbedding.reserveCapacity(embedding.count)
        for i in 0..<embedding.count {
            if let val = embedding[i] as? NSNumber {
                floatEmbedding.append(val.floatValue)
            }
        }

        let added = SherpaOnnxSpeakerEmbeddingManagerAdd(managerPtr, name, floatEmbedding)
        if added == 1 {
            return ["success": true, "message": "Speaker '\(name)' registered successfully"]
        } else {
            return ["success": false, "error": "Failed to register speaker '\(name)'"]
        }
    }

    // MARK: - Remove speaker

    @objc public func removeSpeaker(_ name: String) -> NSDictionary {
        guard let managerPtr = manager else {
            return ["success": false, "error": "Speaker ID not initialized"]
        }

        let removed = SherpaOnnxSpeakerEmbeddingManagerRemove(managerPtr, name)
        if removed == 1 {
            return ["success": true, "message": "Speaker '\(name)' removed successfully"]
        } else {
            return ["success": false, "error": "Speaker '\(name)' not found"]
        }
    }

    // MARK: - Get speakers

    @objc public func getSpeakers() -> NSDictionary {
        guard let managerPtr = manager else {
            return ["success": false, "speakers": [], "count": 0, "error": "Speaker ID not initialized"]
        }

        let count = Int(SherpaOnnxSpeakerEmbeddingManagerNumSpeakers(managerPtr))
        var speakers: [String] = []

        let namesPtr = SherpaOnnxSpeakerEmbeddingManagerGetAllSpeakers(managerPtr)
        if let namesPtr = namesPtr {
            var i = 0
            while let namePtr = namesPtr[i] {
                speakers.append(String(cString: namePtr))
                i += 1
            }
            SherpaOnnxSpeakerEmbeddingManagerFreeAllSpeakers(namesPtr)
        }

        return [
            "success": true,
            "speakers": speakers,
            "count": count
        ]
    }

    // MARK: - Identify speaker

    @objc public func identifySpeaker(_ embedding: NSArray, threshold: Float) -> NSDictionary {
        guard let managerPtr = manager else {
            return ["success": false, "speakerName": "", "identified": false, "error": "Speaker ID not initialized"]
        }

        var floatEmbedding = [Float]()
        floatEmbedding.reserveCapacity(embedding.count)
        for i in 0..<embedding.count {
            if let val = embedding[i] as? NSNumber {
                floatEmbedding.append(val.floatValue)
            }
        }

        let namePtr = SherpaOnnxSpeakerEmbeddingManagerSearch(managerPtr, floatEmbedding, threshold)
        var speakerName = ""
        if let namePtr = namePtr {
            speakerName = String(cString: namePtr)
            SherpaOnnxSpeakerEmbeddingManagerFreeSearch(namePtr)
        }

        return [
            "success": true,
            "speakerName": speakerName,
            "identified": !speakerName.isEmpty
        ]
    }

    // MARK: - Verify speaker

    @objc public func verifySpeaker(_ name: String, embedding: NSArray, threshold: Float) -> NSDictionary {
        guard let managerPtr = manager else {
            return ["success": false, "verified": false, "error": "Speaker ID not initialized"]
        }

        // Check if speaker exists
        let exists = SherpaOnnxSpeakerEmbeddingManagerContains(managerPtr, name)
        if exists == 0 {
            return ["success": false, "verified": false, "error": "Speaker '\(name)' not found"]
        }

        var floatEmbedding = [Float]()
        floatEmbedding.reserveCapacity(embedding.count)
        for i in 0..<embedding.count {
            if let val = embedding[i] as? NSNumber {
                floatEmbedding.append(val.floatValue)
            }
        }

        let verified = SherpaOnnxSpeakerEmbeddingManagerVerify(managerPtr, name, floatEmbedding, threshold)

        return [
            "success": true,
            "verified": verified == 1
        ]
    }

    // MARK: - Process audio file

    @objc public func processFile(_ filePath: String) -> NSDictionary {
        guard let extractorPtr = extractor else {
            return ["success": false, "durationMs": 0, "embedding": [], "embeddingDim": 0, "sampleRate": 0, "samples": 0, "error": "Speaker ID not initialized"]
        }

        // Read WAV
        guard let wave = SherpaOnnxReadWave(filePath) else {
            return ["success": false, "durationMs": 0, "embedding": [], "embeddingDim": 0, "sampleRate": 0, "samples": 0, "error": "Failed to read WAV file: \(filePath)"]
        }

        let sampleRate = Int(wave.pointee.sample_rate)
        let numSamples = Int(wave.pointee.num_samples)

        // Create stream
        let streamPtr = SherpaOnnxSpeakerEmbeddingExtractorCreateStream(extractorPtr)
        guard streamPtr != nil else {
            SherpaOnnxFreeWave(wave)
            return ["success": false, "durationMs": 0, "embedding": [], "embeddingDim": 0, "sampleRate": 0, "samples": 0, "error": "Failed to create stream"]
        }
        let opaqueStream = streamPtr!

        // Feed audio
        SherpaOnnxOnlineStreamAcceptWaveform(opaqueStream, Int32(sampleRate), wave.pointee.samples, Int32(numSamples))
        SherpaOnnxOnlineStreamInputFinished(opaqueStream)
        SherpaOnnxFreeWave(wave)

        // Check readiness
        let isReady = SherpaOnnxSpeakerEmbeddingExtractorIsReady(extractorPtr, opaqueStream)
        if isReady == 0 {
            SherpaOnnxDestroyOnlineStream(opaqueStream)
            return ["success": false, "durationMs": 0, "embedding": [], "embeddingDim": 0, "sampleRate": sampleRate, "samples": numSamples, "error": "Not enough audio data to compute embedding"]
        }

        // Compute embedding
        let startTime = CFAbsoluteTimeGetCurrent()
        let embeddingPtr = SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding(extractorPtr, opaqueStream)
        let durationMs = (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0

        SherpaOnnxDestroyOnlineStream(opaqueStream)

        guard let embPtr = embeddingPtr else {
            return ["success": false, "durationMs": 0, "embedding": [], "embeddingDim": 0, "sampleRate": sampleRate, "samples": numSamples, "error": "Failed to compute embedding"]
        }

        var embedding = [Double]()
        embedding.reserveCapacity(embeddingDim)
        for i in 0..<embeddingDim {
            embedding.append(Double(embPtr[i]))
        }
        SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding(embeddingPtr)

        return [
            "success": true,
            "durationMs": Int(durationMs),
            "embedding": embedding,
            "embeddingDim": embeddingDim,
            "sampleRate": sampleRate,
            "samples": numSamples
        ]
    }

    @objc public func processFileWindow(_ filePath: String, startTimeMs: Double, durationMs: Double) -> NSDictionary {
        guard let extractorPtr = extractor else {
            return [
                "success": false,
                "durationMs": 0,
                "embedding": [],
                "embeddingDim": 0,
                "sampleRate": 0,
                "samples": 0,
                "startTimeMs": startTimeMs,
                "windowDurationMs": durationMs,
                "error": "Speaker ID not initialized"
            ]
        }

        do {
            let audioFile = try AVAudioFile(forReading: URL(fileURLWithPath: filePath))
            let format = audioFile.processingFormat
            let sampleRate = Int(format.sampleRate)
            guard sampleRate == expectedSampleRate else {
                return [
                    "success": false,
                    "durationMs": 0,
                    "embedding": [],
                    "embeddingDim": 0,
                    "sampleRate": sampleRate,
                    "samples": 0,
                    "startTimeMs": startTimeMs,
                    "windowDurationMs": durationMs,
                    "error": "Unsupported sample rate for iOS windowed speaker embedding: got \(sampleRate), expected \(expectedSampleRate). Resample before calling."
                ]
            }
            let channelCount = Int(format.channelCount)
            let requestedStartFrame = AVAudioFramePosition(max(0.0, startTimeMs) / 1000.0 * format.sampleRate)
            let startFrame = max(0, min(requestedStartFrame, audioFile.length))
            let requestedFrameCount = AVAudioFrameCount(max(0.0, durationMs) / 1000.0 * format.sampleRate)
            let availableFrames = AVAudioFrameCount(max(0, audioFile.length - startFrame))
            let frameCount = min(requestedFrameCount, availableFrames)

            guard frameCount > 0 else {
                return [
                    "success": false,
                    "durationMs": 0,
                    "embedding": [],
                    "embeddingDim": 0,
                    "sampleRate": sampleRate,
                    "samples": 0,
                    "startTimeMs": startTimeMs,
                    "windowDurationMs": durationMs,
                    "error": "Empty audio window"
                ]
            }

            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
                return [
                    "success": false,
                    "durationMs": 0,
                    "embedding": [],
                    "embeddingDim": 0,
                    "sampleRate": sampleRate,
                    "samples": 0,
                    "startTimeMs": startTimeMs,
                    "windowDurationMs": durationMs,
                    "error": "Failed to allocate audio buffer"
                ]
            }

            audioFile.framePosition = startFrame
            try audioFile.read(into: buffer, frameCount: frameCount)

            let actualFrames = Int(buffer.frameLength)
            var samples = [Float](repeating: 0, count: actualFrames)
            if let channelData = buffer.floatChannelData {
                for frame in 0..<actualFrames {
                    var sum: Float = 0
                    for channel in 0..<max(1, channelCount) {
                        sum += channelData[channel][frame]
                    }
                    samples[frame] = sum / Float(max(1, channelCount))
                }
            } else {
                return [
                    "success": false,
                    "durationMs": 0,
                    "embedding": [],
                    "embeddingDim": 0,
                    "sampleRate": sampleRate,
                    "samples": 0,
                    "startTimeMs": startTimeMs,
                    "windowDurationMs": durationMs,
                    "error": "Unsupported audio buffer format"
                ]
            }

            let streamPtr = SherpaOnnxSpeakerEmbeddingExtractorCreateStream(extractorPtr)
            guard let opaqueStream = streamPtr else {
                return [
                    "success": false,
                    "durationMs": 0,
                    "embedding": [],
                    "embeddingDim": 0,
                    "sampleRate": sampleRate,
                    "samples": samples.count,
                    "startTimeMs": startTimeMs,
                    "windowDurationMs": durationMs,
                    "error": "Failed to create stream"
                ]
            }

            SherpaOnnxOnlineStreamAcceptWaveform(opaqueStream, Int32(sampleRate), samples, Int32(samples.count))
            SherpaOnnxOnlineStreamInputFinished(opaqueStream)

            let isReady = SherpaOnnxSpeakerEmbeddingExtractorIsReady(extractorPtr, opaqueStream)
            if isReady == 0 {
                SherpaOnnxDestroyOnlineStream(opaqueStream)
                return [
                    "success": false,
                    "durationMs": 0,
                    "embedding": [],
                    "embeddingDim": 0,
                    "sampleRate": sampleRate,
                    "samples": samples.count,
                    "startTimeMs": startTimeMs,
                    "windowDurationMs": durationMs,
                    "error": "Not enough audio data to compute embedding"
                ]
            }

            let startedAt = CFAbsoluteTimeGetCurrent()
            let embeddingPtr = SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding(extractorPtr, opaqueStream)
            let elapsedMs = (CFAbsoluteTimeGetCurrent() - startedAt) * 1000.0
            SherpaOnnxDestroyOnlineStream(opaqueStream)

            guard let embPtr = embeddingPtr else {
                return [
                    "success": false,
                    "durationMs": 0,
                    "embedding": [],
                    "embeddingDim": 0,
                    "sampleRate": sampleRate,
                    "samples": samples.count,
                    "startTimeMs": startTimeMs,
                    "windowDurationMs": durationMs,
                    "error": "Failed to compute embedding"
                ]
            }

            var embedding = [Double]()
            embedding.reserveCapacity(embeddingDim)
            for i in 0..<embeddingDim {
                embedding.append(Double(embPtr[i]))
            }
            SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding(embeddingPtr)

            return [
                "success": true,
                "durationMs": Int(elapsedMs),
                "embedding": embedding,
                "embeddingDim": embeddingDim,
                "sampleRate": sampleRate,
                "samples": samples.count,
                "startTimeMs": startTimeMs,
                "windowDurationMs": durationMs
            ]
        } catch {
            return [
                "success": false,
                "durationMs": 0,
                "embedding": [],
                "embeddingDim": 0,
                "sampleRate": 0,
                "samples": 0,
                "startTimeMs": startTimeMs,
                "windowDurationMs": durationMs,
                "error": "Failed to read audio window: \(error.localizedDescription)"
            ]
        }
    }

    // MARK: - Release

    @objc public func releaseResources() -> NSDictionary {
        cleanupResources()
        return ["released": true]
    }

    private func resetEmbeddingStream(_ extractorPtr: OpaquePointer) {
        if let s = stream {
            SherpaOnnxDestroyOnlineStream(s)
            stream = nil
        }
        let newStream = SherpaOnnxSpeakerEmbeddingExtractorCreateStream(extractorPtr)
        if newStream != nil {
            stream = newStream
        }
    }

    private func cleanupResources() {
        if let s = stream {
            SherpaOnnxDestroyOnlineStream(s)
            stream = nil
        }
        if let m = manager {
            SherpaOnnxDestroySpeakerEmbeddingManager(m)
            manager = nil
        }
        if let e = extractor {
            SherpaOnnxDestroySpeakerEmbeddingExtractor(e)
            extractor = nil
        }
        embeddingDim = 0
    }
}
