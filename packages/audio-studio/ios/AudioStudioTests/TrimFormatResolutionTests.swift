import XCTest
@testable import AudioStudio

final class TrimFormatResolutionTests: XCTestCase {

    func testEveryProbedDepthIsWritable() {
        // Verified against AVAudioFile: each of these round-trips at the requested depth.
        // 24 is the one the [16, 32] allowlist wrongly excluded.
        XCTAssertEqual(TrimFormatResolution.writableBitDepths, [8, 16, 24, 32])
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
