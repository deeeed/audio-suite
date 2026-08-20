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

    /// How to resume writing at `logicalEnd` given what is physically on disk.
    enum Resume: Equatable {
        /// Physical and logical agree; append from here.
        case append
        /// Physical is longer: a write committed a prefix before throwing, or a flush was
        /// interrupted. Cut back to `logicalEnd` before appending, or the retried buffer
        /// duplicates those bytes and the header's size field stops describing the payload.
        case truncateTo(UInt64)
        /// Physical is shorter than what has been counted as written. The file and the
        /// counters no longer describe the same recording, and appending would produce a
        /// WAV whose header overstates its payload.
        case refuse
    }

    /// - Parameters:
    ///   - physicalEnd: the file's actual length on disk
    ///   - logicalEnd: header plus every byte this recording has accounted for
    static func resume(physicalEnd: UInt64, logicalEnd: UInt64) -> Resume {
        if physicalEnd > logicalEnd {
            return .truncateTo(logicalEnd)
        }
        if physicalEnd < logicalEnd {
            return .refuse
        }
        return .append
    }
}
