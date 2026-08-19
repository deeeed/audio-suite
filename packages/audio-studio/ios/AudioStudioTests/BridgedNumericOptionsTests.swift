import XCTest
@testable import AudioStudio

/// Regression coverage for issue #423.
///
/// The Expo bridge hands JS numbers to Swift as `Double`, so reading them with
/// `dict["x"] as? Int` returned nil and every numeric option silently fell back
/// to its default — `onAudioStream` stayed pinned at the 1s default no matter
/// what `interval` was requested.
///
/// These tests feed the same shapes the bridge actually delivers. Reverting
/// `bridgedInt` to `as? Int` fails `testDoubleBackedIntIsReadAsInt`,
/// `testInt64ReadsLargeDurations`, and the `fromDictionary` cases; reverting
/// `bridgedDouble` to `as? Double` fails `testDoubleReadsSampleRate` (the
/// Int-backed input). The pre-existing `EventEmissionIntervalTests` could not
/// catch #423 at all: it builds a Swift `RecordingConfig` directly and never
/// crosses the dictionary boundary where the bug lived.
///
/// KNOWN GAP: `AudioStudioTests/` has no Xcode test target or scheme, so this
/// suite is not executed by `yarn test:ios` (which only builds) or by CI. That
/// predates this file. Until a target exists these assertions document and
/// pin intent for a human running them manually, rather than enforcing it
/// automatically.
final class BridgedNumericOptionsTests: XCTestCase {

    // MARK: - The exact failure mode from #423

    func testDoubleBackedIntIsReadAsInt() {
        // This is what Expo actually delivers for `interval: 100`.
        let dict: [String: Any] = ["interval": Double(100)]

        XCTAssertNil(
            dict["interval"] as? Int,
            "Precondition: `as? Int` must fail on a Double — this is the bug being guarded"
        )
        XCTAssertEqual(
            bridgedInt(dict, "interval"), 100,
            "bridgedInt must read a Double-backed numeric option"
        )
    }

    func testNativeIntAndNSNumberStillWork() {
        XCTAssertEqual(bridgedInt(["v": Int(42)], "v"), 42)
        XCTAssertEqual(bridgedInt(["v": NSNumber(value: 42)], "v"), 42)
    }

    func testMissingKeyReturnsNilSoCallerDefaultApplies() {
        XCTAssertNil(bridgedInt([:], "interval"))
        XCTAssertNil(bridgedDouble([:], "sampleRate"))
        XCTAssertNil(bridgedInt64([:], "maxDurationMs"))
    }

    func testNonNumericValuesReturnNil() {
        // The TS API never promises numeric strings; anything non-numeric must
        // fall through to the caller's default rather than be coerced.
        XCTAssertNil(bridgedInt(["v": "100"], "v"))
        XCTAssertNil(bridgedInt(["v": ["nested": 1]], "v"))
    }

    func testBoolBridgesAsNumber() {
        // Bool is NSNumber-backed on this platform, so it reads as 1/0 rather
        // than nil. No caller passes a Bool where a number is expected; this is
        // pinned so any future change to that behavior is a deliberate one.
        XCTAssertEqual(bridgedInt(["v": true], "v"), 1)
    }

    func testInt64ReadsLargeDurations() {
        // maxDurationMs exceeds Int32 for long recordings.
        let dict: [String: Any] = ["maxDurationMs": Double(9_000_000_000)]
        XCTAssertEqual(bridgedInt64(dict, "maxDurationMs"), 9_000_000_000)
    }

    func testDoubleReadsSampleRate() {
        XCTAssertEqual(bridgedDouble(["sampleRate": Double(44100)], "sampleRate"), 44100.0)
        XCTAssertEqual(bridgedDouble(["sampleRate": Int(16000)], "sampleRate"), 16000.0)
    }

    // MARK: - End-to-end through RecordingSettings.fromDictionary

    func testFromDictionaryParsesBridgedNumbers() {
        // Every numeric value arrives as Double, exactly as the bridge sends it.
        let dict: [String: Any] = [
            "sampleRate": Double(16000),
            "channels": Double(2),
            "bitDepth": Double(32),
            "interval": Double(250),
            "intervalAnalysis": Double(500),
            "segmentDurationMs": Double(150),
            "maxDurationMs": Double(60000),
        ]

        guard case .success(let settings) = RecordingSettings.fromDictionary(dict) else {
            return XCTFail("fromDictionary rejected a valid bridged payload")
        }

        XCTAssertEqual(settings.interval, 250, "interval must survive the bridge (#423)")
        XCTAssertEqual(settings.intervalAnalysis, 500)
        XCTAssertEqual(settings.numberOfChannels, 2)
        XCTAssertEqual(settings.bitDepth, 32)
        XCTAssertEqual(settings.segmentDurationMs, 150)
        XCTAssertEqual(settings.maxDurationMs, 60000)
        XCTAssertEqual(settings.sampleRate, 16000.0)
    }

    func testFromDictionaryFallsBackWhenOptionsAbsent() {
        // Defaults must still apply when the caller omits values entirely.
        guard case .success(let settings) = RecordingSettings.fromDictionary([:]) else {
            return XCTFail("fromDictionary rejected an empty payload")
        }

        XCTAssertNil(settings.interval, "absent interval stays nil so the manager default applies")
        XCTAssertEqual(settings.numberOfChannels, 1)
        XCTAssertEqual(settings.bitDepth, 16)
        XCTAssertEqual(settings.sampleRate, 44100.0)
    }

    func testCompressedBitrateSurvivesTheBridge() {
        let dict: [String: Any] = [
            "output": [
                "compressed": [
                    "enabled": true,
                    "format": "aac",
                    "bitrate": Double(96000),
                ] as [String: Any]
            ] as [String: Any]
        ]

        guard case .success(let settings) = RecordingSettings.fromDictionary(dict) else {
            return XCTFail("fromDictionary rejected a valid compressed payload")
        }
        XCTAssertEqual(settings.output.compressed.bitrate, 96000)
    }
}
