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
///
/// Note this is broader than the version it replaced, which refused FIFOs, sockets and
/// device nodes: `rename` replaces those. That is acceptable because a destination like
/// that cannot be reached through the documented contract — `outputFileName` is a single
/// filename, enforced by `isSafeOutputFileName` at the bridge — and narrowing it again
/// would mean reintroducing the inspect-then-act race this exists to remove.
enum OutputPromotion {

    /// Whether a caller-supplied output filename is a single, safe path component.
    ///
    /// `outputFileName` arrives from JS and is appended to a directory. A separator makes
    /// it a path rather than a name, and a path can traverse: `../../../../tmp/pwned`
    /// resolves to `/var/tmp/pwned.wav`, where the trim then writes — outside the
    /// documented contract, and a way to overwrite unrelated files (#433).
    ///
    /// Not every rejected name escapes, and the difference is worth stating precisely,
    /// having been described wrongly twice. Probed against `/tmp/base`:
    /// - `../escaped` and `../../../../tmp/pwned` land outside it
    /// - `a/b` nests inside it, `/absolute` is absorbed, `.` and `..` become `..wav` and
    ///   `...wav` inside it
    ///
    /// All are refused, because the contract is a single filename and anything else writes
    /// somewhere the caller did not name. Only the first group is a traversal.
    static func isSafeOutputFileName(_ name: String) -> Bool {
        guard !name.isEmpty else { return false }
        guard !name.contains("/") else { return false }
        guard name != "." && name != ".." else { return false }
        // Reject NUL and anything that would not survive as one path component.
        guard !name.contains("\0") else { return false }
        return true
    }

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
