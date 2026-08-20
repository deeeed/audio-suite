import Foundation

/// Whether a primary-WAV write failure should be reported to the delegate.
///
/// A failed append used to be logged and dropped, so the compressed recorder kept running
/// while the WAV silently stopped — and a caller using the WAV for crash recovery had no
/// way to know it had gone stale (#420). Now the write path tries to reopen the handle, and
/// tells the delegate when that fails.
///
/// One broken handle fails every subsequent buffer, dozens a second, so a recording reports
/// once. That suppression is the whole decision, and it lives in its own file so the test
/// package can compile it: `AudioStreamManager` imports UIKit, MediaPlayer and AVFoundation,
/// which is why its write path is not directly unit-testable.
internal struct PrimaryWriteFailurePolicy {
    /// - Parameter alreadyReported: whether this recording has already reported a failure.
    static func shouldReport(alreadyReported: Bool) -> Bool {
        !alreadyReported
    }
}
