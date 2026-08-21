import Foundation

/// Whether a caller-supplied filename is a single, safe path component.
///
/// Filenames arrive from JS and get appended to a directory, so a separator makes the
/// value a path rather than a name — and a path can traverse out of the directory it was
/// appended to. `trimAudio`'s `outputFileName` and `startRecording`'s `filename` both did
/// this, on iOS and Android alike (#433, #452).
///
/// Rejected names fail in three different ways. Stated exactly because getting it
/// approximately right took four attempts; probed against `/tmp/base`:
/// - **traversing out**: `../escaped` and `../../../../tmp/pwned` land in `/tmp`
/// - **outside without traversing**: `""` leaves the base URL unchanged, so the extension
///   goes onto the directory itself — `/tmp/base.wav`, a sibling
/// - **inside but not a filename**: `a/b` nests, `/absolute` is absorbed, `.` and `..`
///   become `..wav` and `...wav`
///
/// All are refused. The contract is a single filename, and every one of these writes
/// somewhere the caller did not name.
///
/// Rejecting beats sanitising to the last component: silently writing somewhere other than
/// asked is how #423 stayed hidden.
enum SafeFilename {

    /// True when `name` is one path component that can be appended safely.
    static func isValid(_ name: String) -> Bool {
        guard !name.isEmpty else { return false }
        guard !name.contains("/") else { return false }
        guard name != "." && name != ".." else { return false }
        // A NUL truncates the path at the C boundary, so what gets created is not what
        // was inspected.
        guard !name.contains("\0") else { return false }
        return true
    }
}
