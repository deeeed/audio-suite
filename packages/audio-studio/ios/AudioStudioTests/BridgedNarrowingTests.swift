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

    // MARK: - Int32 at the wrapper boundary

    func testASampleCountValidAsIntStillClampsForInt32() {
        // The reachable case: windowSizeMs 100_000_000 passes every option guard and, at
        // 44.1 kHz, is 4_410_000_000 samples — fine as Int, a trap as Int32.
        let samples = BridgedNarrowing.sampleCount(milliseconds: 100_000_000, sampleRate: 44_100)
        XCTAssertEqual(samples, 4_410_000_000)
        XCTAssertNil(Int32(exactly: samples), "precondition: Int32(_:) would trap")

        XCTAssertEqual(BridgedNarrowing.int32(samples, minimum: 1), Int32.max)
    }

    func testOrdinarySampleCountsCrossUnchanged() {
        XCTAssertEqual(BridgedNarrowing.int32(882, minimum: 1), 882)
        XCTAssertEqual(BridgedNarrowing.int32(Int(Int32.max) - 1, minimum: 1), Int32.max - 1)
    }

    func testInt32ClampsAtBothEnds() {
        XCTAssertEqual(BridgedNarrowing.int32(Int(Int32.max), minimum: 1), Int32.max)
        XCTAssertEqual(BridgedNarrowing.int32(-1, minimum: 1), 1)
        XCTAssertEqual(BridgedNarrowing.int32(Int(Int64.min / 2), minimum: 0), 0)
    }
}
