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
        for rate in [8_000.0, 44_100.0, 48_000.0, 192_000.0, 384_000.0] {
            XCTAssertEqual(BridgedNarrowing.outputSampleRate(rate), rate)
        }
    }

    func testRatesCoreAudioCannotServeAreRejected() {
        // AVAudioConverter returns nil at 1e12 and above, which force-unwraps crashed on.
        XCTAssertNil(BridgedNarrowing.outputSampleRate(1e12))
        XCTAssertNil(BridgedNarrowing.outputSampleRate(1e15))
        XCTAssertNil(BridgedNarrowing.outputSampleRate(384_001))
        XCTAssertNil(BridgedNarrowing.outputSampleRate(0))
        XCTAssertNil(BridgedNarrowing.outputSampleRate(-44_100))
        XCTAssertNil(BridgedNarrowing.outputSampleRate(nil))
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
