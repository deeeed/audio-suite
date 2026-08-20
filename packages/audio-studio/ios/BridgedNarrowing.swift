import Foundation

/// Narrowing conversions for values that reach native code from JS.
///
/// Swift's `Int(_:)`, `Int32(_:)` and friends **trap** on a value the target cannot
/// represent — they do not throw or clamp. `bridgedFiniteDouble` already rejects a value
/// that is not exactly representable as `Int`, but that is not sufficient at the conversion
/// site: a duration in milliseconds gets multiplied by a sample rate, and the product can
/// overflow a type the input comfortably fitted (#432, #433).
///
/// `windowSizeMs: 100_000_000` passes every option guard and, at 44.1 kHz, produces
/// 4_410_000_000 samples — fine for `Int`, a trap for the `Int32` the C++ wrapper takes.
///
/// So clamp at the conversion, where the other operands are known, rather than inventing a
/// ceiling on the option itself. A bound on `windowSizeMs` alone could never be right,
/// because the safe range depends on the sample rate it is multiplied by.
enum BridgedNarrowing {

    /// Milliseconds times a sample rate, as a sample count, clamped to `Int`.
    ///
    /// - Parameters:
    ///   - milliseconds: a duration that came from JS
    ///   - sampleRate: samples per second, from the file or the settings
    ///   - minimum: floor for the result; pass 0 where zero is meaningful
    static func sampleCount(
        milliseconds: Double,
        sampleRate: Double,
        minimum: Int = 1
    ) -> Int {
        let raw = (milliseconds * sampleRate / 1000.0).rounded(.towardZero)
        // Compare in Double: the product may already exceed Int.max, so converting first
        // is the trap being avoided.
        //
        // The ceiling is `nextDown`, not `Double(Int.max)`. Int.max is not representable
        // as a Double, so Double(Int.max) rounds *up* to 2^63 — and converting that back
        // traps, which is this very bug in the guard meant to prevent it.
        return Int(min(max(raw, Double(minimum)), Double(Int.max).nextDown))
    }

    /// Clamps to `Int32`, for values crossing into C++ wrappers that take `int32_t`.
    ///
    /// A sample count can be perfectly valid as `Int` and still trap here, so this is a
    /// separate step rather than folded into `sampleCount`.
    static func int32(_ value: Int, minimum: Int32 = 0) -> Int32 {
        if value >= Int(Int32.max) { return Int32.max }
        if value <= Int(minimum) { return minimum }
        return Int32(value)
    }
}
