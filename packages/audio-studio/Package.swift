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
// This package compiles the files that are pure parsing logic — no AVAudioEngine,
// no UIKit, no ExpoModulesCore — so `swift test` runs them anywhere, including CI,
// with no Xcode project and nothing inside the gitignored ios/ directory.
let package = Package(
    name: "AudioStudio",
    platforms: [.iOS(.v16)],
    targets: [
        .target(
            name: "AudioStudio",
            path: "ios", sources: ["RecordingSettings.swift", "DeviceDisconnectionBehavior.swift"]
        ),
        .testTarget(
            name: "AudioStudioTests",
            dependencies: ["AudioStudio"],
            path: "ios/AudioStudioTests", sources: ["BridgedNumericOptionsTests.swift"]
        ),
    ]
)
