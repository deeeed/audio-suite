import Foundation

/// Moves a finished work file onto a caller-supplied destination.
///
/// Trimming writes to a private work file and promotes it only on success, because
/// `AVAudioFile` truncates its destination the moment the writer opens — a 14-byte file
/// becomes a 4096-byte WAV header before anything can fail, so writing straight to the
/// destination destroys the caller's data before the outcome is known (#433).
///
/// Promotion is a single `rename(2)`, not an inspect-then-act. Three earlier versions of
/// this were checked by hand and each had a hole somewhere different: writing to the
/// destination corrupted it; guarding cleanup with `fileExists` preserved the corruption
/// and mistook a dangling symlink for nothing; and `replaceItemAt` deleted a non-empty
/// directory. Deciding from a stale `stat` cannot be safe — the destination can become a
/// directory between the look and the act — so the check and the move have to be the same
/// operation.
///
/// `rename` gives exactly the semantics wanted, enforced by the kernel:
/// - absent destination: creates it
/// - regular file: replaced atomically
/// - symlink: the link is replaced, its target untouched
/// - directory: refused with `EISDIR`, contents intact
///
/// `replaceItemAt` was not usable regardless: it throws Cocoa error 4 for both live and
/// dangling symlinks.
enum OutputPromotion {

    /// Promotes `workURL` onto `destination`, or throws describing why it did not.
    ///
    /// The work file is left in place when this throws, so the caller can clean it up.
    static func promote(workURL: URL, to destination: URL) throws {
        guard rename(workURL.path, destination.path) == 0 else {
            let code = errno
            throw NSError(
                domain: "AudioProcessor",
                code: -1,
                userInfo: [
                    NSLocalizedDescriptionKey:
                        "Cannot write the trimmed audio to \(destination.lastPathComponent): "
                        + String(cString: strerror(code)),
                    NSUnderlyingErrorKey: NSError(domain: NSPOSIXErrorDomain, code: Int(code)),
                ]
            )
        }
    }
}
