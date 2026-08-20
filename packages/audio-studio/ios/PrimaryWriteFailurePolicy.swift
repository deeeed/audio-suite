import Foundation

/// Standard WAV header is 44 bytes.
///
/// Lives here rather than in AudioStreamManager so the test package, which cannot compile
/// that file, can still reason about file lengths.
internal let WAV_HEADER_SIZE: Int64 = 44

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

    /// The length to finalize the WAV header and reported size against.
    ///
    /// Once writes stop being accepted — an unrecoverable handle, or a file that shrank
    /// below what was counted — the counter keeps the length the recording *would* have
    /// had; sizing the header from it describes audio that is not in the file.
    ///
    /// The smaller of the two wins, because each bounds the other. A file shorter than the
    /// count lost bytes that were written. A file longer holds bytes nothing accounted for
    /// — a write that committed a prefix before throwing, where recovery or truncation then
    /// failed too. Those trailing bytes are not known to be whole frames, so promoting them
    /// into the payload is the same corruption in the other direction.
    ///
    /// - Parameters:
    ///   - physicalSize: the file's length on disk, or nil if it could not be measured
    ///   - accountedSize: header plus every byte this recording counted as written
    static func finalSize(physicalSize: Int64?, accountedSize: Int64) -> Int64 {
        guard let physicalSize = physicalSize else { return accountedSize }
        return min(physicalSize, accountedSize)
    }

    /// Whether a finalized primary WAV holds anything a caller can use.
    ///
    /// 44 bytes is a valid empty WAV — a header with no samples. Anything shorter is a
    /// truncated file that never got one, and reporting it as a successful recording hands
    /// back something no decoder will open.
    static func isUsableWav(finalSize: Int64) -> Bool {
        finalSize >= WAV_HEADER_SIZE
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
