// DeviceDisconnectionBehavior.swift

/// How recording should react when the active input device disappears.
///
/// Lives in its own file (rather than alongside AudioStreamManager) so the
/// settings-parsing layer can be compiled and unit-tested without pulling in
/// AVAudioEngine, UIKit, and ExpoModulesCore.
enum DeviceDisconnectionBehavior: String {
    case PAUSE = "pause"
    case FALLBACK = "fallback"
}
