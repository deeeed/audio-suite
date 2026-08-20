import Foundation

/// Moves a finished work file onto a caller-supplied destination.
///
/// Trimming writes to a private work file and promotes it only on success, because
/// `AVAudioFile` truncates its destination the moment the writer opens — a 14-byte file
/// becomes a 4096-byte WAV header before anything can fail, so writing straight to the
/// destination destroys the caller's data before the outcome is known (#433).
///
/// Promotion needs its own care. `replaceItemAt` succeeds against a **directory** and
/// deletes it along with everything inside, which manual checking missed because the
/// directory case was only ever exercised on the failure path. Anything that is not a
/// regular file or a symlink is refused rather than replaced.
enum OutputPromotion {

    /// What promotion should do with a given destination.
    enum Action: Equatable {
        /// Nothing is there; move the work file into place.
        case move
        /// A regular file or symlink is there; replace it.
        case replace
        /// Not something this should overwrite. `reason` says what it is.
        case refuse(reason: String)
    }

    /// Decides based on what is actually at `destination`.
    ///
    /// - Parameter attributes: the destination's file type, or nil when nothing is there.
    ///   Passed in rather than read here so the decision can be tested without a filesystem.
    static func action(forExistingType type: FileAttributeType?) -> Action {
        guard let type = type else { return .move }
        switch type {
        case .typeRegular, .typeSymbolicLink:
            return .replace
        case .typeDirectory:
            return .refuse(reason: "the destination is a directory")
        default:
            return .refuse(reason: "the destination is a \(type.rawValue)")
        }
    }

    /// The destination's type, or nil if nothing is there.
    ///
    /// Uses `attributesOfItem`, which does not follow symlinks — so a link is seen as a
    /// link, and a dangling one is still reported rather than looking absent the way
    /// `fileExists` does.
    static func existingType(at url: URL, using manager: FileManager = .default) -> FileAttributeType? {
        guard let attributes = try? manager.attributesOfItem(atPath: url.path) else { return nil }
        return attributes[.type] as? FileAttributeType
    }

    /// Promotes `workURL` onto `destination`, or throws describing why it did not.
    ///
    /// The work file is left in place on refusal so the caller can clean it up.
    static func promote(
        workURL: URL,
        to destination: URL,
        using manager: FileManager = .default
    ) throws {
        switch action(forExistingType: existingType(at: destination, using: manager)) {
        case .move:
            try manager.moveItem(at: workURL, to: destination)
        case .replace:
            _ = try manager.replaceItemAt(destination, withItemAt: workURL)
        case .refuse(let reason):
            throw NSError(
                domain: "AudioProcessor",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey:
                    "Cannot write the trimmed audio to \(destination.lastPathComponent): \(reason)"]
            )
        }
    }
}
