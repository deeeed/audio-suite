import XCTest
@testable import AudioStudio

/// Covers the shared filename validator (#433, #452).
///
/// The categories below were established by probing Foundation rather than reasoning about
/// it — four earlier attempts to describe this got it wrong, each in a different place, so
/// the measured resolutions are recorded alongside the assertions.
final class SafeFilenameTests: XCTestCase {

    func testOrdinaryFilenamesAreAccepted() {
        for name in ["recording", "my-trim.wav", "trim 1", "réc", "a.b.c", "..leading"] {
            XCTAssertTrue(SafeFilename.isValid(name), name)
        }
    }

    func testNamesThatTraverseOutOfTheDirectoryAreRejected() {
        // Probed against /tmp/base: these resolve to /tmp/escaped.wav and /tmp/pwned.wav.
        for name in ["../escaped", "../../../../tmp/pwned"] {
            XCTAssertFalse(SafeFilename.isValid(name), name)
        }
    }

    func testAnEmptyNameLandsBesideTheDirectoryRatherThanInsideIt() {
        // Appending "" leaves the base URL unchanged, so the extension goes onto the
        // directory itself — /tmp/base.wav, a sibling. Outside without traversing.
        XCTAssertFalse(SafeFilename.isValid(""))
    }

    func testNonFilenamesAreRejectedEvenWhenTheyStayInside() {
        // These do land inside — "a/b" nests, "/absolute" is absorbed, and "." and ".."
        // become "..wav" and "...wav" — but none is a filename, so each writes somewhere
        // the caller did not name.
        for name in ["a/b", "/absolute", ".", ".."] {
            XCTAssertFalse(SafeFilename.isValid(name), name)
        }
    }

    func testNamesContainingNulAreRejected() {
        // A NUL truncates the path at the C boundary, so the file created is not the one
        // that was inspected.
        XCTAssertFalse(SafeFilename.isValid("bad\0name"))
    }

    func testTheRecordingPathIsCoveredToo() {
        // createRecordingFile strips a trailing extension before appending ".wav", which
        // mangles some of these differently than the trim path — "../escaped" becomes
        // "..wav" and stays put, while "../../../../tmp/pwned" still escapes to "/..wav".
        // The validator runs before any of that, so both are refused regardless.
        XCTAssertFalse(SafeFilename.isValid("../escaped"))
        XCTAssertFalse(SafeFilename.isValid("../../../../tmp/pwned"))
    }
}
