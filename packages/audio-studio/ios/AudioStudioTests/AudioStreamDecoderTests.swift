import AVFoundation
import XCTest
@testable import AudioStudio

final class AudioStreamDecoderTests: XCTestCase {

    // MARK: - Sample sanitization

    func testSafeFloatToInt16ReplacesNonFinite() {
        // NaN/Inf collapse to 0 per the documented sanitization contract; the
        // helper treats every non-finite sample identically.
        XCTAssertEqual(safeFloatToInt16(Float.nan), 0)
        XCTAssertEqual(safeFloatToInt16(Float.infinity), 0)
        XCTAssertEqual(safeFloatToInt16(-Float.infinity), 0)
    }

    func testSafeFloatToInt16ClampsOutOfRange() {
        XCTAssertEqual(safeFloatToInt16(2.0), Int16.max)
        XCTAssertEqual(safeFloatToInt16(-2.0), Int16.min)
        XCTAssertEqual(safeFloatToInt16(0.0), 0)
    }

    func testSafeFloatToInt16IdentityAtUnityIsBounded() {
        // The previous Swift `Int16(1.0 * Float(Int16.max))` trap requires
        // the result of the multiplication to fit Int16. The new helper
        // must produce Int16.max for sample == 1.0 without trapping.
        XCTAssertEqual(safeFloatToInt16(1.0), Int16.max)
        XCTAssertEqual(safeFloatToInt16(-1.0), -Int16.max)
    }

    func testSafeFloatToInt32ReplacesNonFinite() {
        XCTAssertEqual(safeFloatToInt32(Float.nan), 0)
        XCTAssertEqual(safeFloatToInt32(Float.infinity), 0)
        XCTAssertEqual(safeFloatToInt32(-Float.infinity), 0)
    }

    func testSafeFloatToInt32ClampsOutOfRange() {
        XCTAssertEqual(safeFloatToInt32(5.0), Int32.max)
        XCTAssertEqual(safeFloatToInt32(-5.0), Int32.min)
    }

    // MARK: - Decoder option bounds

    func testDecoderOptionsDoNotSilentlyClampChunkDuration() {
        let opts = AudioStreamDecoder.Options(
            requestId: "test",
            fileUri: "/dev/null",
            startTimeMs: nil,
            endTimeMs: nil,
            targetSampleRate: nil,
            channels: nil,
            normalizeAudio: true,
            chunkDurationMs: 5,
            maxChunkBytes: nil,
            maxBufferedChunks: 0,
            backpressureTimeoutMs: 1234
        )
        XCTAssertEqual(opts.chunkDurationMs, 5, "module entrypoint rejects invalid ranges")
        XCTAssertEqual(opts.maxBufferedChunks, 1, "maxBufferedChunks floor is 1")
        XCTAssertEqual(opts.backpressureTimeoutMs, 1234)
    }

    // MARK: - Decoder event contract

    final class CaptureDelegate: AudioStreamDecoderDelegate {
        var chunks: [[String: Any]] = []
        var progressEvents: [[String: Any]] = []
        var completePayload: [String: Any]?
        var errorPayload: [String: Any]?
        let done = XCTestExpectation(description: "decoder terminal event")

        func streamDecoder(_ decoder: AudioStreamDecoder, didEmitChunk payload: [String: Any]) {
            chunks.append(payload)
            if let idx = payload["chunkIndex"] as? Int {
                decoder.acknowledgeChunk(idx)
            }
        }
        func streamDecoder(_ decoder: AudioStreamDecoder, didReportProgress payload: [String: Any]) {
            progressEvents.append(payload)
        }
        func streamDecoder(_ decoder: AudioStreamDecoder, didCompleteWith payload: [String: Any]) {
            completePayload = payload
            done.fulfill()
        }
        func streamDecoder(_ decoder: AudioStreamDecoder, didFailWith payload: [String: Any]) {
            errorPayload = payload
            // Some flows emit an error then a complete; let complete fulfill.
        }
    }


    private func makeTinyWav(sampleRate: Double = 16000, frames: Int = 1600) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("audio-stream-decoder-\(UUID().uuidString).wav")
        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
        )!
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(frames)
        )!
        buffer.frameLength = AVAudioFrameCount(frames)
        let channel = buffer.floatChannelData![0]
        for i in 0..<frames {
            channel[i] = sin(Float(i) * 0.01) * 0.25
        }
        try file.write(from: buffer)
        return url
    }

    func testDecoderEmitsChunksForTinyWav() throws {
        let url = try makeTinyWav()
        defer { try? FileManager.default.removeItem(at: url) }

        let delegate = CaptureDelegate()
        let opts = AudioStreamDecoder.Options(
            requestId: "tiny-wav",
            fileUri: url.path,
            startTimeMs: nil,
            endTimeMs: nil,
            targetSampleRate: 16000,
            channels: 1,
            normalizeAudio: true,
            chunkDurationMs: 50,
            maxChunkBytes: nil,
            maxBufferedChunks: 1
        )
        let decoder = AudioStreamDecoder(options: opts)
        decoder.delegate = delegate
        decoder.start()

        wait(for: [delegate.done], timeout: 3.0)
        XCTAssertNil(delegate.errorPayload)
        XCTAssertFalse(delegate.chunks.isEmpty)
        XCTAssertEqual(delegate.chunks.last?["isFinal"] as? Bool, true)
        XCTAssertEqual(delegate.completePayload?["requestId"] as? String, "tiny-wav")
        XCTAssertEqual(delegate.completePayload?["cancelled"] as? Bool, false)
        XCTAssertGreaterThan(delegate.completePayload?["samples"] as? Int ?? 0, 0)
    }

    func testDecoderEmitsFileNotFoundForMissingPath() {
        let delegate = CaptureDelegate()
        let opts = AudioStreamDecoder.Options(
            requestId: "missing",
            fileUri: "/tmp/this-file-does-not-exist-\(UUID().uuidString).wav",
            startTimeMs: nil,
            endTimeMs: nil,
            targetSampleRate: nil,
            channels: nil,
            normalizeAudio: true,
            chunkDurationMs: 100,
            maxChunkBytes: nil,
            maxBufferedChunks: 2
        )
        let decoder = AudioStreamDecoder(options: opts)
        decoder.delegate = delegate
        decoder.start()
        // Error path never calls complete, so wait directly on the error.
        let exp = XCTestExpectation(description: "error received")
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) {
            if delegate.errorPayload != nil {
                exp.fulfill()
            }
        }
        wait(for: [exp], timeout: 2.0)
        XCTAssertEqual(delegate.errorPayload?["code"] as? String, "ERR_AUDIO_STREAM_FILE_NOT_FOUND")
        XCTAssertEqual(delegate.errorPayload?["requestId"] as? String, "missing")
    }
}
