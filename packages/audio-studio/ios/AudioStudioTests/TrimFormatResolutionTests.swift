import AVFoundation
import XCTest
@testable import AudioStudio

final class TrimFormatResolutionTests: XCTestCase {

    func testEveryProbedDepthIsWritable() throws {
        // Actually round-trip each depth through AVAudioFile rather than comparing the
        // constant to itself, which is what this did before and proved nothing. 24 is the
        // depth the old [16, 32] allowlist wrongly excluded.
        let fm = FileManager.default
        for depth in TrimFormatResolution.writableBitDepths {
            let url = fm.temporaryDirectory
                .appendingPathComponent("depth-\(depth)-\(UUID().uuidString)")
                .appendingPathExtension("wav")
            defer { try? fm.removeItem(at: url) }

            let writer = try AVAudioFile(forWriting: url, settings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 44100.0,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: depth,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false
            ])
            let buffer = try XCTUnwrap(
                AVAudioPCMBuffer(pcmFormat: writer.processingFormat, frameCapacity: 4410)
            )
            buffer.frameLength = 4410
            try writer.write(from: buffer)

            let reopened = try AVAudioFile(forReading: url)
            XCTAssertEqual(
                Int(reopened.fileFormat.streamDescription.pointee.mBitsPerChannel), depth,
                "a \(depth)-bit WAV must reopen as \(depth)-bit, or it is not writable"
            )
        }
    }

    func testOmittedRequestPreservesTheInputDepth() {
        for depth in [8, 16, 24, 32] {
            XCTAssertEqual(
                TrimFormatResolution.targetBitDepth(requested: nil, inputBitDepth: depth), depth,
                "an omitted bitDepth must preserve a \(depth)-bit input"
            )
        }
    }

    func testAnUnwritableInputDepthFallsBackToSixteen() {
        // e.g. a compressed source reporting 0 bits per channel.
        XCTAssertEqual(TrimFormatResolution.targetBitDepth(requested: nil, inputBitDepth: 0), 16)
    }

    func testAnExplicitWritableRequestIsHonoured() {
        XCTAssertEqual(TrimFormatResolution.targetBitDepth(requested: 24, inputBitDepth: 16), 24)
        XCTAssertEqual(TrimFormatResolution.targetBitDepth(requested: 8, inputBitDepth: 32), 8)
    }

    func testAnUnwritableRequestFallsBackRatherThanBeingWritten() {
        // 12-bit is not something the writer emits; falling back to the input beats
        // claiming a depth the file does not have.
        XCTAssertEqual(TrimFormatResolution.targetBitDepth(requested: 12, inputBitDepth: 24), 24)
    }

    func testADepthOnlyChangeLeavesTheFastPath() {
        // The regression #451 was about: the fast path writes frames unconverted, so a
        // depth-only request that stayed on it was silently dropped.
        XCTAssertTrue(TrimFormatResolution.outputDiffersFromInput(
            targetSampleRate: 44100, inputSampleRate: 44100,
            targetChannels: 1, inputChannels: 1,
            targetBitDepth: 16, inputBitDepth: 24
        ))
    }

    func testAnIdenticalFormatKeepsTheFastPath() {
        XCTAssertFalse(TrimFormatResolution.outputDiffersFromInput(
            targetSampleRate: 44100, inputSampleRate: 44100,
            targetChannels: 2, inputChannels: 2,
            targetBitDepth: 16, inputBitDepth: 16
        ))
    }

    func testRateOrChannelChangesAlsoLeaveTheFastPath() {
        XCTAssertTrue(TrimFormatResolution.outputDiffersFromInput(
            targetSampleRate: 8000, inputSampleRate: 44100,
            targetChannels: 1, inputChannels: 1,
            targetBitDepth: 16, inputBitDepth: 16
        ))
        XCTAssertTrue(TrimFormatResolution.outputDiffersFromInput(
            targetSampleRate: 44100, inputSampleRate: 44100,
            targetChannels: 1, inputChannels: 2,
            targetBitDepth: 16, inputBitDepth: 16
        ))
    }
}
