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
///
/// Where no bound exists, clamp at the conversion, where the other operands are known —
/// a ceiling on `windowSizeMs` alone could never be right, because the safe range depends
/// on the sample rate it is multiplied by. Where the platform does impose a bound, reject
/// instead: clamping an oversized window to a type's maximum still overruns the fixed FFT
/// buffer downstream.
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

    /// Sample rates `AVAssetReaderTrackOutput` will accept, for the streaming decoder.
    ///
    /// Outside this range the reader raises an uncaught `NSException` — not a Swift error,
    /// so nothing downstream can catch it and the process dies. Probed against a real asset
    /// (#433): 1, 7999, 192001 and 384000 all terminate; 8000 and 192000 construct fine.
    ///
    /// Deliberately narrower than what a converter accepts. 384 kHz is a real hardware rate
    /// and converts without complaint, so applying this bound to the trim path would
    /// silently downgrade a request the platform can actually serve.
    static let readerSampleRates: ClosedRange<Double> = 8_000...192_000

    /// Sample rates `AVAudioConverter` can be constructed for, used by trim and decode.
    ///
    /// The converter returns nil rather than throwing, and that nil was force-unwrapped
    /// (#433). It is far more permissive than the reader: 384 kHz succeeds with frames
    /// produced, while 1e12 returns nil. The ceiling here is a sanity bound on what a
    /// caller can mean, not a transcription of a platform limit — hence 4x the highest
    /// consumer rate rather than something tighter.
    static let converterSampleRates: ClosedRange<Double> = 1...768_000

    /// What a caller asked for, distinguishing "nothing" from "something unusable".
    enum RequestedRate: Equatable {
        /// The key was absent or null; use the source rate.
        case absent
        /// A rate the API can serve.
        case valid(Double)
        /// The key was present but is not a rate that can be honoured.
        case invalid
    }

    /// Classifies a raw bridged value against `permitted`.
    ///
    /// Present-but-unusable has to be distinguishable from absent. `bridgedFiniteDouble`
    /// returns nil for both a missing key and `1e20`, so treating its nil as "not
    /// requested" silently fell back to the source rate for a request that should have been
    /// rejected (#433).
    ///
    /// - Parameters:
    ///   - rawValue: the value as it arrived, before parsing
    ///   - parsed: the result of `bridgedFiniteDouble` for the same key
    ///   - permitted: which API's range applies
    static func requestedRate(
        rawValue: Any?,
        parsed: Double?,
        permitted: ClosedRange<Double>
    ) -> RequestedRate {
        guard let rawValue = rawValue, !(rawValue is NSNull) else { return .absent }
        guard let parsed = parsed, permitted.contains(parsed) else { return .invalid }
        return .valid(parsed)
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
