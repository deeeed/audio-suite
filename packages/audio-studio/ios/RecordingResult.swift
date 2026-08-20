// RecordingResult.swift

struct RecordingResult {
    var fileUri: String
    var filename: String
    var mimeType: String
    var duration: Int64
    var size: Int64
    var channels: Int
    var bitDepth: Int
    var sampleRate: Double
    var compression: CompressedRecordingInfo?
}

/// Why `startRecording` could not begin.
///
/// Previously every failure returned `nil` and surfaced to JS as the single string
/// "Failed to start recording.", so callers could not tell a phone call from a missing
/// microphone permission from an audio session that failed to configure (#419).
enum StartRecordingError: Error {
    /// Preparation failed for a reason with no more specific case.
    case preparationFailed
    /// The output file could not be created or opened.
    case fileCreationFailed
    /// Settings were rejected during validation.
    case invalidSettings
    /// The audio tap could not be installed on the engine's input node.
    case tapInstallationFailed
    /// A phone call is active — detected during preparation or just before start.
    case phoneCallActive
    /// A recording is already running.
    case alreadyRecording
    /// Settings were missing when start was attempted.
    case missingSettings
    /// `AVAudioEngine.start()` threw.
    case engineStartFailed(underlying: Error)

    /// Stable identifier for the JS error `code`.
    ///
    /// Deliberately reuses the vocabulary Android already emits from
    /// `AudioRecorderManager` — ALREADY_RECORDING, ONGOING_CALL, AUDIO_FOCUS_ERROR and
    /// friends — so a caller switches on one set of codes rather than one per platform.
    var code: String {
        switch self {
        case .preparationFailed: return "START_FAILED"
        case .fileCreationFailed: return "FILE_CREATION_FAILED"
        case .invalidSettings: return "INVALID_SETTINGS"
        case .tapInstallationFailed: return "START_FAILED"
        case .phoneCallActive: return "ONGOING_CALL"
        case .alreadyRecording: return "ALREADY_RECORDING"
        case .missingSettings: return "START_FAILED"
        case .engineStartFailed: return "START_FAILED"
        }
    }

    /// Message for the JS error, phrased for someone reading a crash report.
    var message: String {
        switch self {
        case .preparationFailed:
            return "Failed to prepare recording. The audio session could not be configured."
        case .fileCreationFailed:
            return "Failed to create or open the recording output file."
        case .invalidSettings:
            return "The provided recording settings are invalid."
        case .tapInstallationFailed:
            return "Failed to install the audio tap on the input node."
        case .phoneCallActive:
            return "Cannot start recording during an active phone call."
        case .alreadyRecording:
            return "Recording is already in progress."
        case .missingSettings:
            return "Recording settings are missing."
        case .engineStartFailed(let underlying):
            return "Failed to start the audio engine: \(underlying.localizedDescription)"
        }
    }
}

struct StartRecordingResult {
    var fileUri: String
    var mimeType: String
    var channels: Int
    var bitDepth: Int
    var sampleRate: Double
    var compression: CompressedRecordingInfo?
}
