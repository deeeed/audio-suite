import XCTest
@testable import AudioStudio

/// Covers the clamping added for #433.
///
/// `bridgedFiniteDouble` proves an option fits `Int`, which is not the same as the
/// conversion being safe. The value gets multiplied by a sample rate, and the product can
/// overflow a type the input comfortably fitted — or overflow `Int32` at a C++ wrapper
/// boundary while remaining a perfectly ordinary `Int`.
final class BridgedNarrowingTests: XCTestCase {

    // MARK: - Milliseconds to a sample count

    func testOrdinaryDurationsConvertUnchanged() {
        // 20 ms at 44.1 kHz is 882 samples — the everyday case must not be perturbed.
        XCTAssertEqual(
            BridgedNarrowing.sampleCount(milliseconds: 20, sampleRate: 44_100),
            882
        )
        XCTAssertEqual(
            BridgedNarrowing.sampleCount(milliseconds: 1_000, sampleRate: 48_000),
            48_000
        )
    }

    func testAProductThatOverflowsIntIsClampedRatherThanTrapping() {
        // This value passes bridgedFiniteDouble — it is exactly representable as Int — and
        // the product with the sample rate is not. Int(_:) would trap here.
        let windowSizeMs = 4.0816326530612243e17
        XCTAssertNotNil(Int(exactly: windowSizeMs.rounded(.towardZero)), "precondition: passes the option guard")
        XCTAssertNil(
            Int(exactly: (windowSizeMs * 44_100 / 1000.0).rounded(.towardZero)),
            "precondition: the product does not fit Int"
        )

        XCTAssertEqual(
            BridgedNarrowing.sampleCount(milliseconds: windowSizeMs, sampleRate: 44_100),
            Int(Double(Int.max).nextDown)
        )
    }

    func testTheCeilingIsRepresentableAsInt() {
        // Double(Int.max) rounds UP to 2^63, so converting it back traps. Clamping to it
        // would be this very bug inside the guard meant to prevent it.
        // Through variables: written literally, the compiler rejects the overflow outright
        // rather than letting the runtime conversion be observed.
        let roundedUp = Double(Int.max)
        let largestRepresentable = roundedUp.nextDown
        XCTAssertNil(Int(exactly: roundedUp))
        XCTAssertNotNil(Int(exactly: largestRepresentable))
    }

    // MARK: - Output sample rates

    func testOrdinarySampleRatesAreAccepted() {
        for rate in [8_000.0, 44_100.0, 48_000.0, 96_000.0, 192_000.0] {
            XCTAssertEqual(BridgedNarrowing.outputSampleRate(rate), rate)
        }
    }

    func testTheBoundsAreTheReadersOwn() {
        // Probed against AVAssetReaderTrackOutput with a real asset: 7999 and 192001 raise
        // an uncaught NSException that terminates the process, while 8000 and 192000
        // construct fine. The bound is the platform's, not a policy choice.
        XCTAssertEqual(BridgedNarrowing.outputSampleRate(8_000), 8_000)
        XCTAssertEqual(BridgedNarrowing.outputSampleRate(192_000), 192_000)
        XCTAssertNil(BridgedNarrowing.outputSampleRate(7_999))
        XCTAssertNil(BridgedNarrowing.outputSampleRate(192_001))
    }

    func testRatesCoreAudioCannotServeAreRejected() {
        // 384000 is a real hardware rate but still crashes the reader, so it is out too.
        XCTAssertNil(BridgedNarrowing.outputSampleRate(384_000))
        XCTAssertNil(BridgedNarrowing.outputSampleRate(1e12))
        XCTAssertNil(BridgedNarrowing.outputSampleRate(1e15))
        XCTAssertNil(BridgedNarrowing.outputSampleRate(1))
        XCTAssertNil(BridgedNarrowing.outputSampleRate(0))
        XCTAssertNil(BridgedNarrowing.outputSampleRate(-44_100))
        XCTAssertNil(BridgedNarrowing.outputSampleRate(nil))
    }

    // MARK: - Time ranges

    private let rate = 44_100.0
    private let available = 44_100 // one second

    func testNoBoundsMeansTheWholeFile() {
        XCTAssertEqual(
            BridgedNarrowing.timeRange(startMs: nil, endMs: nil, sampleRate: rate, availableSamples: available),
            .whole
        )
    }

    func testAnEndOnlyRangeIsHonoured() {
        // The public API allows this, and gating on startTimeMs alone ignored it entirely.
        XCTAssertEqual(
            BridgedNarrowing.timeRange(startMs: nil, endMs: 500, sampleRate: rate, availableSamples: available),
            .samples(start: 0, end: 22_050)
        )
    }

    func testAnEndOnlyNegativeRangeIsRejectedRatherThanIgnored() {
        // Previously this fell through and analysed the whole file.
        guard case .invalid = BridgedNarrowing.timeRange(
            startMs: nil, endMs: -100, sampleRate: rate, availableSamples: available
        ) else {
            return XCTFail("A negative end must be rejected")
        }
    }

    func testAStartOnlyRangeRunsToTheEnd() {
        XCTAssertEqual(
            BridgedNarrowing.timeRange(startMs: 500, endMs: nil, sampleRate: rate, availableSamples: available),
            .samples(start: 22_050, end: available)
        )
    }

    func testANegativeStartIsRejectedRatherThanClampedToZero() {
        // Clamping turned -200...-100ms into "the first 100ms" — a silently different
        // request rather than a rejected one.
        guard case .invalid = BridgedNarrowing.timeRange(
            startMs: -200, endMs: -100, sampleRate: rate, availableSamples: available
        ) else {
            return XCTFail("A negative start must be rejected")
        }
        guard case .invalid = BridgedNarrowing.timeRange(
            startMs: -200, endMs: 100, sampleRate: rate, availableSamples: available
        ) else {
            return XCTFail("A negative start with a positive end must be rejected")
        }
    }

    func testAReversedRangeIsRejected() {
        guard case .invalid = BridgedNarrowing.timeRange(
            startMs: 800, endMs: 200, sampleRate: rate, availableSamples: available
        ) else {
            return XCTFail("end <= start must be rejected")
        }
    }

    func testARangePastTheEndIsRejectedRatherThanSilentlyIgnored() {
        // The old bounds check left the samples untouched here, so the call analysed the
        // whole file instead of reporting that the request was outside it.
        guard case .invalid = BridgedNarrowing.timeRange(
            startMs: 5_000, endMs: 6_000, sampleRate: rate, availableSamples: available
        ) else {
            return XCTFail("A range past the end must be rejected")
        }
    }

    func testAnEndBeyondTheFileIsTruncatedNotRejected() {
        // Asking for more than exists is a normal request; asking to start past the end
        // is not.
        XCTAssertEqual(
            BridgedNarrowing.timeRange(startMs: 500, endMs: 90_000, sampleRate: rate, availableSamples: available),
            .samples(start: 22_050, end: available)
        )
    }

    func testAnOverflowingRangeCannotTrap() {
        // Both bounds pass bridgedFiniteDouble; the products do not fit Int.
        guard case .invalid = BridgedNarrowing.timeRange(
            startMs: 4.0816326530612243e17,
            endMs: 4.0816326530612244e17,
            sampleRate: rate,
            availableSamples: available
        ) else {
            return XCTFail("An out-of-file range must be rejected, not trap")
        }
    }

    // MARK: - Byte offsets

    func testByteOffsetsClampLikeSampleCounts() {
        XCTAssertEqual(
            BridgedNarrowing.byteOffset(milliseconds: 1_000, bytesPerSecond: 176_400),
            176_400
        )
        // Passes the option guard; the product does not fit Int.
        XCTAssertEqual(
            BridgedNarrowing.byteOffset(milliseconds: 4.0816326530612243e17, bytesPerSecond: 176_400),
            Int(Double(Int.max).nextDown)
        )
    }

    func testTheMinimumIsHonoured() {
        // A window rounding to zero samples would divide by zero downstream.
        XCTAssertEqual(BridgedNarrowing.sampleCount(milliseconds: 0.0001, sampleRate: 8_000), 1)
        // Where zero is meaningful — a start offset — it is allowed through.
        XCTAssertEqual(
            BridgedNarrowing.sampleCount(milliseconds: 0, sampleRate: 44_100, minimum: 0),
            0
        )
    }

    func testNegativeDurationsClampToTheMinimum() {
        XCTAssertEqual(BridgedNarrowing.sampleCount(milliseconds: -5_000, sampleRate: 44_100), 1)
        XCTAssertEqual(
            BridgedNarrowing.sampleCount(milliseconds: -5_000, sampleRate: 44_100, minimum: 0),
            0
        )
    }

    func testASubSampleHopStaysZeroSoTheNativeDefaultApplies() {
        // The C++ side treats hopLengthSamples <= 0 as "use the 160-sample default"
        // (MelSpectrogram.cpp:15). Flooring at 1 instead would produce ~160x the frames,
        // so the mel path passes minimum: 0 and this records why.
        XCTAssertEqual(
            BridgedNarrowing.sampleCount(milliseconds: 0.001, sampleRate: 44_100, minimum: 0),
            0
        )
        // A hop that does round to whole samples is untouched.
        XCTAssertEqual(
            BridgedNarrowing.sampleCount(milliseconds: 10, sampleRate: 44_100, minimum: 0),
            441
        )
    }
}
