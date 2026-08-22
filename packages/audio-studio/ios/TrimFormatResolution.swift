import Foundation

/// The pure format decisions `trimAudio` makes before touching AVFoundation (#451).
///
/// Extracted so they can be tested. `AudioProcessor.swift` cannot join the SwiftPM test
/// target — it pulls in the Expo module graph — so every bit-depth and fast-path bug in
/// #451 shipped with no automated coverage at all. These four rules are where all of them
/// were.
enum TrimFormatResolution {

    /// Bit depths an `AVAudioFile` WAV writer emits at the depth requested.
    ///
    /// Probed against AVFoundation rather than assumed: 8, 16, 24 and 32 each round-trip
    /// exactly. An earlier `[16, 32]` allowlist silently downconverted 8- and 24-bit
    /// sources nobody asked to convert.
    static let writableBitDepths = [8, 16, 24, 32]

    /// The depth to write when the caller did not ask for one.
    ///
    /// Preserves the input where a writer can express it, rather than forcing 16 during an
    /// unrelated rate or channel change.
    static func defaultBitDepth(inputBitDepth: Int) -> Int {
        writableBitDepths.contains(inputBitDepth) ? inputBitDepth : 16
    }

    /// The depth to write, honouring an explicit request only when it is writable.
    static func targetBitDepth(requested: Int?, inputBitDepth: Int) -> Int {
        if let requested = requested, writableBitDepths.contains(requested) {
            return requested
        }
        return defaultBitDepth(inputBitDepth: inputBitDepth)
    }

    /// Whether the output differs from the input in any way the WAV fast path cannot honour.
    ///
    /// The fast path copies frames without converting, so anything true here must take the
    /// decode-and-re-encode path instead. `bitDepth` belongs in this comparison: a
    /// depth-only request used to take the fast path and be ignored outright.
    static func outputDiffersFromInput(
        targetSampleRate: Double, inputSampleRate: Double,
        targetChannels: Int, inputChannels: Int,
        targetBitDepth: Int, inputBitDepth: Int
    ) -> Bool {
        targetSampleRate != inputSampleRate
            || targetChannels != inputChannels
            || targetBitDepth != inputBitDepth
    }
}
