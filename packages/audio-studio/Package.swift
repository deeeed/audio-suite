// swift-tools-version:5.9
import PackageDescription

// Runnable unit tests for the settings-parsing layer.
//
// The AudioStudioTests/ suite has existed since March but was never compiled:
// the podspec excludes it from source_files (correctly — tests must not ship in
// the framework), and `use_expo_modules!` autolinks the pod, so there is no
// Podfile entry to attach `:testspecs` to. The suite was documentation, not
// enforcement, and could not fail CI. That is how #423 shipped.
//
// This package compiles only the files that are pure parsing logic, so the tests
// need no Xcode project and nothing inside the gitignored apps/playground/ios/.
//
// It targets the iOS simulator, not macOS: RecordingSettings imports AVAudioSession,
// which is unavailable on macOS, so plain `swift test` will not work. Run it with
// `yarn workspace @siteed/audio-studio test:ios`.
let package = Package(
    name: "AudioStudio",
    platforms: [.iOS(.v16)],
    targets: [
        .target(
            name: "AudioStudio",
            path: "ios", sources: [
                "RecordingSettings.swift",
                "DeviceDisconnectionBehavior.swift",
                "PrimaryWriteFailurePolicy.swift",
                "BridgedNarrowing.swift",
                "OutputPromotion.swift",
            ]
        ),
        .testTarget(
            name: "AudioStudioTests",
            dependencies: ["AudioStudio"],
            path: "ios/AudioStudioTests", sources: [
                "BridgedNumericOptionsTests.swift",
                "PrimaryWriteRecoveryTests.swift",
                "BridgedNarrowingTests.swift",
                "ConverterCapabilityTests.swift",
                "OutputPromotionTests.swift",
            ]
        ),
    ]
)
