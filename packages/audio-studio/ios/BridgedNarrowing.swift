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
/// 4_410_000_000 samples — fine for `Int`, and far past what the native code can accept.
/// Where a bound exists the caller rejects rather than clamping, because clamping an
/// oversized window to a type's maximum still overruns the fixed FFT buffer downstream.
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

    /// Milliseconds times a bytes-per-second rate, as a byte offset, clamped to `Int`.
    ///
    /// Same shape as [sampleCount]; named separately so call sites say which unit they mean.
    static func byteOffset(
        milliseconds: Double,
        bytesPerSecond: Int,
        minimum: Int = 0
    ) -> Int {
        sampleCount(
            milliseconds: milliseconds,
            sampleRate: Double(bytesPerSecond),
            minimum: minimum
        )
    }

    /// Sample rates a caller may request for output.
    ///
    /// `bridgedFiniteDouble` only proves representability, so an absurd rate reached
    /// CoreAudio unchecked. Two different failures, verified against the real APIs with a
    /// file from test-assets (#433):
    /// - `AVAssetReaderTrackOutput` raises an uncaught `NSException` — not a Swift error,
    ///   so nothing downstream can catch it — outside 8 kHz...192 kHz. 7999 and 192001 both
    ///   terminate the process; 8000 and 192000 construct fine.
    /// - `AVAudioConverter(from:to:)` returns nil for extreme rates, which was force-
    ///   unwrapped.
    ///
    /// The bound is therefore the reader's, since it is the strictest and its failure is
    /// unrecoverable. This is a real limit of the platform APIs, not a policy about which
    /// formats the library supports.
    static let supportedSampleRates: ClosedRange<Double> = 8_000...192_000

    /// The requested rate if CoreAudio can serve it, otherwise nil.
    static func outputSampleRate(_ value: Double?) -> Double? {
        guard let value = value, supportedSampleRates.contains(value) else { return nil }
        return value
    }

    /// A caller-supplied time range, resolved against the material being analysed.
    enum TimeRange: Equatable {
        /// No bound was given; use everything.
        case whole
        /// Use `start..<end`, in samples.
        case samples(start: Int, end: Int)
        /// The request is not usable; `reason` says why.
        case invalid(reason: String)
    }

    /// Resolves `startTimeMs`/`endTimeMs` into a sample range, or rejects it.
    ///
    /// Written as a decision rather than inline checks because every previous version of
    /// this logic was wrong in a way the type system could not catch (#433): clamping a
    /// negative start to zero turned `-200...-100` into "the first 100 ms"; a reversed or
    /// past-the-end range failed a bounds check and left the samples untouched, so the call
    /// silently analysed the whole file; and gating on `startTimeMs` alone meant an
    /// end-only request — which the public API allows — was ignored entirely.
    ///
    /// Either bound alone defines a range. A missing start means zero.
    static func timeRange(
        startMs: Double?,
        endMs: Double?,
        sampleRate: Double,
        availableSamples: Int
    ) -> TimeRange {
        guard startMs != nil || endMs != nil else { return .whole }

        let start = startMs ?? 0
        guard start >= 0 else {
            return .invalid(reason: "startTimeMs must not be negative, was \(start)")
        }
        if let end = endMs, end < 0 {
            return .invalid(reason: "endTimeMs must not be negative, was \(end)")
        }
        if let end = endMs, end <= start {
            return .invalid(reason: "endTimeMs (\(end)) must be greater than startTimeMs (\(start))")
        }

        let startSample = sampleCount(milliseconds: start, sampleRate: sampleRate, minimum: 0)
        let endSample = endMs.map {
            min(sampleCount(milliseconds: $0, sampleRate: sampleRate, minimum: 0), availableSamples)
        } ?? availableSamples

        guard startSample < endSample, startSample < availableSamples else {
            return .invalid(
                reason: "range \(startSample)..<\(endSample) is empty or outside the "
                    + "\(availableSamples) samples available"
            )
        }
        return .samples(start: startSample, end: endSample)
    }
}
