// RecordingSettings.swift

import AVFoundation

/// Read an integer option out of a bridged JS payload.
///
/// The Expo bridge hands JS numbers to Swift as `Double`, so `dict["x"] as? Int`
/// returns nil for every numeric option and the caller silently falls back to its
/// default. That is what pinned `onAudioStream` at the 1s default no matter what
/// `interval` was requested (issue #423). Going through `NSNumber` accepts Double,
/// Int, and NSNumber alike.
///
/// Only numeric payloads are accepted; the TS API never promises numeric strings.
///
/// Note: `intValue` truncates toward zero. The TS contract documents a 10ms minimum
/// for interval values and `AudioStreamManager` clamps with `max(10.0, ...)`, so
/// sub-1ms fractions cannot silently disable emission.
///
/// This is the integer counterpart of the `Float` fix in #422.
func bridgedInt(_ dict: [String: Any], _ key: String) -> Int? {
    (dict[key] as? NSNumber)?.intValue
}

/// `bridgedInt` constrained to a permitted range.
///
/// Bounds applied by `fromDictionary`, chosen to be far wider than any real caller
/// while excluding values that trap or corrupt output:
///   channels 1...2, bitDepth {16, 32}, sampleRate 1...768000 Hz,
///   interval/intervalAnalysis/segmentDurationMs 1...3600000 ms (1 hour),
///   bitrate 1...3000000 bps, maxDurationMs 0...2073600000 ms (24 days),
///   bufferDurationSeconds 0.001...10 s.
/// An out-of-range value falls back to the documented default rather than failing
/// the call, matching how an omitted option already behaves.
///
/// Out-of-range and non-finite values return nil so the caller falls back to its
/// default instead of carrying a hostile value downstream. This matters because
/// several call sites narrow into unsigned types — `UInt32(channels)` in
/// `createWavHeader` and `AVAudioChannelCount(...)` in the decode/trim paths all
/// **trap** on a negative value rather than throwing.
///
/// Before numeric bridging was fixed, `channels: -1` failed the `as? Int` cast and
/// silently fell back to 1. Now that the value parses, that accidental guard is
/// gone, so the bound has to be explicit.
func bridgedInt(_ dict: [String: Any], _ key: String, in range: ClosedRange<Int>) -> Int? {
    guard let value = bridgedInt(dict, key), range.contains(value) else { return nil }
    return value
}

/// `bridgedDouble` constrained to a permitted range, rejecting NaN and infinity.
///
/// `NSNumber.doubleValue` happily returns NaN/inf, and `UInt32(Double.nan)` traps.
func bridgedDouble(_ dict: [String: Any], _ key: String, in range: ClosedRange<Double>) -> Double? {
    guard let value = bridgedDouble(dict, key), value.isFinite, range.contains(value) else {
        return nil
    }
    return value
}

/// Int64 variant of `bridgedInt` for large values such as durations.
///
/// Rejects non-finite input: `NSNumber.int64Value` maps +inf to `Int64.max`, which
/// then traps downstream when `scheduleMaxDurationTimer` narrows it back to `Int`.
func bridgedInt64(_ dict: [String: Any], _ key: String) -> Int64? {
    guard let number = dict[key] as? NSNumber else { return nil }
    guard number.doubleValue.isFinite else { return nil }
    return number.int64Value
}

/// `bridgedInt64` constrained to a permitted range.
func bridgedInt64(_ dict: [String: Any], _ key: String, in range: ClosedRange<Int64>) -> Int64? {
    guard let value = bridgedInt64(dict, key), range.contains(value) else { return nil }
    return value
}

/// Double variant of `bridgedInt`, for symmetry and explicitness.
func bridgedDouble(_ dict: [String: Any], _ key: String) -> Double? {
    (dict[key] as? NSNumber)?.doubleValue
}

struct NotificationAction {
    var title: String
    var identifier: String
}

struct IOSAudioSessionConfig {
    var category: AVAudioSession.Category
    var mode: AVAudioSession.Mode
    var categoryOptions: AVAudioSession.CategoryOptions
}

struct IOSNotificationConfig {
    var categoryIdentifier: String?
}

struct OutputSettings {
    struct PrimaryOutput {
        var enabled: Bool = true
        var format: String = "wav"  // Currently only "wav" is supported
    }

    struct CompressedOutput {
        var enabled: Bool = false
        var format: String = "aac"  // "aac" or "opus" (opus falls back to aac on iOS)
        var bitrate: Int = 128000
    }

    var primary: PrimaryOutput = PrimaryOutput()
    var compressed: CompressedOutput = CompressedOutput()
}

struct CompressedRecordingInfo {
    var compressedFileUri: String
    var mimeType: String
    var bitrate: Int
    var format: String
    var size: Int64 = 0  // Add size with default value

    static func validate(format: String, bitrate: Int) -> Result<(String, Int), Error> {
        // Validate format
        guard ["aac", "opus"].contains(format.lowercased()) else {
            return .failure(RecordingError.unsupportedFormat(format))
        }

        // Adjust bitrate based on format
        let adjustedBitrate: Int
        if format.lowercased() == "aac" {
            // Standard AAC bitrates (bps)
            let standardAACBitrates = [32000, 48000, 64000, 96000, 128000, 160000, 192000, 256000, 320000]
            adjustedBitrate = standardAACBitrates.min(by: { abs($0 - bitrate) < abs($1 - bitrate) }) ?? 128000
        } else {
            // For Opus, allow lower bitrates (especially good for voice)
            // Typical Opus voice bitrates: 8-24 kbps, music: 32-128 kbps
            adjustedBitrate = min(max(bitrate, 8000), 320000)
        }

        return .success((format, adjustedBitrate))
    }
}

struct NotificationConfig {
    var title: String?
    var text: String?
    var icon: String?
    var ios: IOSNotificationConfig?
}

struct IOSConfig {
    var audioSession: IOSAudioSessionConfig?
}

enum RecordingError: Error {
    case unsupportedFormat(String)
    case invalidBitrate(Int)
    case invalidOutputDirectory(String)

    var localizedDescription: String {
        switch self {
        case .unsupportedFormat(let format):
            return "Unsupported compression format: \(format). iOS only supports AAC."
        case .invalidBitrate(let bitrate):
            return "Invalid bitrate: \(bitrate). Must be between 8000 and 960000 bps."
        case .invalidOutputDirectory(let directory):
            return "Invalid output directory: \(directory). Directory does not exist, is not a directory, or is not writable."
        }
    }
}

struct RecordingSettings {
    // Core recording settings
    var sampleRate: Double
    var desiredSampleRate: Double
    var numberOfChannels: Int = 1
    var bitDepth: Int = 16
    var interval: Int?
    var intervalAnalysis: Int?

    // Feature flags
    var keepAwake: Bool = true
    var showNotification: Bool = false
    var enableProcessing: Bool = false

    // Remove pointsPerSecond and algorithm
    var featureOptions: [String: Bool]? = ["rms": true, "zcr": true]

    // iOS-specific configuration
    var ios: IOSConfig?

    // Notification configuration
    var notification: NotificationConfig?

    // Output configuration
    var output: OutputSettings = OutputSettings()

    let autoResumeAfterInterruption: Bool

    var outputDirectory: String? = nil
    var filename: String? = nil

    // Update default to 100ms
    var segmentDurationMs: Int = 100  // Default 100ms segments

    // Add these new properties
    var deviceId: String?
    var deviceDisconnectionBehavior: DeviceDisconnectionBehavior = .FALLBACK
    var bufferDurationSeconds: Double?
    var streamFormat: String = "raw"
    var maxDurationMs: Int64 = 0
    var autoStopOnMaxDuration: Bool = false

    static func fromDictionary(_ dict: [String: Any]) -> Result<RecordingSettings, Error> {
        // Parse output configuration
        var outputSettings = OutputSettings()

        if let outputDict = dict["output"] as? [String: Any] {
            // Parse primary output settings
            if let primaryDict = outputDict["primary"] as? [String: Any] {
                outputSettings.primary.enabled = primaryDict["enabled"] as? Bool ?? true
                outputSettings.primary.format = primaryDict["format"] as? String ?? "wav"
            }

            // Parse compressed output settings
            if let compressedDict = outputDict["compressed"] as? [String: Any] {
                outputSettings.compressed.enabled = compressedDict["enabled"] as? Bool ?? false
                let format = (compressedDict["format"] as? String)?.lowercased() ?? "aac"
                outputSettings.compressed.format = format
                outputSettings.compressed.bitrate = bridgedInt(compressedDict, "bitrate", in: 1...3_000_000) ?? 128000

                // Validate compression settings if enabled
                if outputSettings.compressed.enabled {
                    if case .failure(let error) = CompressedRecordingInfo.validate(
                        format: format,
                        bitrate: outputSettings.compressed.bitrate
                    ) {
                        return .failure(error)
                    }
                }
            }
        }

        // Add extraction of new properties
        let deviceId = dict["deviceId"] as? String
        let deviceDisconnectionBehaviorStr = dict["deviceDisconnectionBehavior"] as? String

        // Create settings
        var settings = RecordingSettings(
            sampleRate: bridgedDouble(dict, "sampleRate", in: 1...768_000) ?? 44100.0,
            desiredSampleRate: bridgedDouble(dict, "desiredSampleRate", in: 1...768_000) ?? 44100.0,
            autoResumeAfterInterruption: dict["autoResumeAfterInterruption"] as? Bool ?? false
        )

        settings.output = outputSettings

        // Parse core settings
        settings.numberOfChannels = bridgedInt(dict, "channels", in: 1...2) ?? 1
        // Only 16 and 32 are real: AudioStreamManager writes every non-32 depth as
        // pcmFormatInt16, so any other value would put a lie in the WAV header.
        settings.bitDepth = bridgedInt(dict, "bitDepth").flatMap { [16, 32].contains($0) ? $0 : nil } ?? 16
        settings.interval = bridgedInt(dict, "interval", in: 1...3_600_000)
        settings.intervalAnalysis = bridgedInt(dict, "intervalAnalysis", in: 1...3_600_000)
        if let maxDurationMs = bridgedInt64(dict, "maxDurationMs", in: 0...2_073_600_000) {
            settings.maxDurationMs = maxDurationMs
        }
        settings.autoStopOnMaxDuration = dict["autoStopOnMaxDuration"] as? Bool ?? false
        // Parse feature flags
        settings.keepAwake = dict["keepAwake"] as? Bool ?? true
        settings.showNotification = dict["showNotification"] as? Bool ?? false
        settings.enableProcessing = dict["enableProcessing"] as? Bool ?? false

        settings.featureOptions = dict["features"] as? [String: Bool]

        // Update segmentDurationMs parsing
        settings.segmentDurationMs = bridgedInt(dict, "segmentDurationMs", in: 1...3_600_000) ?? 100

        // Parse iOS-specific config
        if let iosDict = dict["ios"] as? [String: Any],
           let audioSessionDict = iosDict["audioSession"] as? [String: Any] {

            // Map category
            let category: AVAudioSession.Category
            if let categoryStr = audioSessionDict["category"] as? String {
                switch categoryStr {
                    case "Ambient": category = .ambient
                    case "SoloAmbient": category = .soloAmbient
                    case "Playback": category = .playback
                    case "Record": category = .record
                    case "PlayAndRecord": category = .playAndRecord
                    case "MultiRoute": category = .multiRoute
                    default: category = .record
                }
            } else {
                category = .record
            }

            // Map mode
            let mode: AVAudioSession.Mode
            if let modeStr = audioSessionDict["mode"] as? String {
                switch modeStr {
                    case "Default": mode = .default
                    case "VoiceChat": mode = .voiceChat
                    case "VideoChat": mode = .videoChat
                    case "GameChat": mode = .gameChat
                    case "VideoRecording": mode = .videoRecording
                    case "Measurement": mode = .measurement
                    case "MoviePlayback": mode = .moviePlayback
                    case "SpokenAudio": mode = .spokenAudio
                    default: mode = .default
                }
            } else {
                mode = .default
            }

            // Map category options
            var categoryOptions: AVAudioSession.CategoryOptions = []
            if let optionsArray = audioSessionDict["categoryOptions"] as? [String] {
                for option in optionsArray {
                    switch option {
                        case "MixWithOthers": categoryOptions.insert(.mixWithOthers)
                        case "DuckOthers": categoryOptions.insert(.duckOthers)
                        case "InterruptSpokenAudioAndMixWithOthers": categoryOptions.insert(.interruptSpokenAudioAndMixWithOthers)
                        case "AllowBluetooth": categoryOptions.insert(.allowBluetooth)
                        case "AllowBluetoothA2DP": categoryOptions.insert(.allowBluetoothA2DP)
                        case "AllowAirPlay": categoryOptions.insert(.allowAirPlay)
                        case "DefaultToSpeaker": categoryOptions.insert(.defaultToSpeaker)
                        default: break
                    }
                }
            }

            settings.ios = IOSConfig(audioSession: IOSAudioSessionConfig(
                category: category,
                mode: mode,
                categoryOptions: categoryOptions
            ))
        }

        // Parse notification config
        if let notificationDict = dict["notification"] as? [String: Any] {
            var notificationConfig = NotificationConfig()
            notificationConfig.title = notificationDict["title"] as? String
            notificationConfig.text = notificationDict["text"] as? String
            notificationConfig.icon = notificationDict["icon"] as? String

            // Parse iOS-specific notification config
            if let iosNotificationDict = notificationDict["ios"] as? [String: Any] {
                notificationConfig.ios = IOSNotificationConfig(
                    categoryIdentifier: iosNotificationDict["categoryIdentifier"] as? String
                )
            }

            settings.notification = notificationConfig
        }

        // Parse output settings (they remain nil if not provided)
        if let directory = dict["outputDirectory"] as? String {
            // Only validate if a custom directory is provided
            let fileManager = FileManager.default
            var isDirectory: ObjCBool = false

            // Clean up the directory path by removing file:// protocol if present
            let cleanDirectory = directory.replacingOccurrences(of: "file://", with: "")
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                .replacingOccurrences(of: "//", with: "/")

            if !fileManager.fileExists(atPath: cleanDirectory, isDirectory: &isDirectory) {
                return .failure(RecordingError.invalidOutputDirectory("Directory does not exist: \(cleanDirectory)"))
            }

            if !isDirectory.boolValue {
                return .failure(RecordingError.invalidOutputDirectory("Path is not a directory: \(cleanDirectory)"))
            }

            if !fileManager.isWritableFile(atPath: cleanDirectory) {
                return .failure(RecordingError.invalidOutputDirectory("Directory is not writable: \(cleanDirectory)"))
            }

            settings.outputDirectory = cleanDirectory
        }

        settings.filename = dict["filename"] as? String

        // Set new properties
        settings.deviceId = deviceId
        settings.deviceDisconnectionBehavior = DeviceDisconnectionBehavior(rawValue: deviceDisconnectionBehaviorStr ?? "fallback") ?? .FALLBACK

        if let bufferDuration = bridgedDouble(dict, "bufferDurationSeconds", in: 0.001...10) {
            settings.bufferDurationSeconds = bufferDuration
        }

        settings.streamFormat = dict["streamFormat"] as? String ?? "raw"

        return .success(settings)
    }
}
