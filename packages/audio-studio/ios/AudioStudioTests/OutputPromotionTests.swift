import XCTest
@testable import AudioStudio

/// Covers promoting a trim's work file onto its destination (#433).
///
/// Every earlier version of this was verified by hand and every one had a hole somewhere
/// different. Writing straight to the destination corrupted it before failure was known;
/// guarding cleanup with `fileExists` preserved the corrupted file and mistook a dangling
/// symlink for nothing; `replaceItemAt` deleted a non-empty directory, which manual checks
/// missed because they only exercised directories on the failure path; and inspecting the
/// type first still raced, since the destination can become a directory between the look
/// and the act.
///
/// These run against a real filesystem rather than asserting on a decision enum, because
/// the decision was never the part that was wrong.
final class OutputPromotionTests: XCTestCase {

    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("promotion-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func makeWorkFile(_ contents: String = "NEW AUDIO") throws -> URL {
        let url = directory.appendingPathComponent("trim-\(UUID().uuidString).wav")
        try contents.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    func testAFreshDestinationReceivesTheWorkFile() throws {
        let destination = directory.appendingPathComponent("fresh.wav")
        let work = try makeWorkFile()

        try OutputPromotion.promote(workURL: work, to: destination)

        XCTAssertEqual(try String(contentsOf: destination), "NEW AUDIO")
        XCTAssertFalse(FileManager.default.fileExists(atPath: work.path))
    }

    func testAnExistingFileIsReplaced() throws {
        let destination = directory.appendingPathComponent("existing.wav")
        try "OLD AUDIO".write(to: destination, atomically: true, encoding: .utf8)
        let work = try makeWorkFile()

        try OutputPromotion.promote(workURL: work, to: destination)

        XCTAssertEqual(try String(contentsOf: destination), "NEW AUDIO")
        XCTAssertFalse(FileManager.default.fileExists(atPath: work.path))
    }

    func testANonEmptyDirectoryAndItsContentsSurvive() throws {
        // The case manual verification missed: replaceItemAt reported success here and
        // took the directory's contents with it.
        let destination = directory.appendingPathComponent("target.wav")
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        let sentinel = destination.appendingPathComponent("keep.txt")
        try "SENTINEL".write(to: sentinel, atomically: true, encoding: .utf8)
        let work = try makeWorkFile()

        XCTAssertThrowsError(try OutputPromotion.promote(workURL: work, to: destination))

        XCTAssertEqual(try String(contentsOf: sentinel), "SENTINEL")
        var isDirectory: ObjCBool = false
        XCTAssertTrue(FileManager.default.fileExists(atPath: destination.path, isDirectory: &isDirectory))
        XCTAssertTrue(isDirectory.boolValue, "the destination must still be a directory")
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: work.path),
            "the work file is left for the caller to clean up"
        )
    }

    func testALiveSymlinkIsReplacedWithoutTouchingItsTarget() throws {
        // rename replaces the link itself. replaceItemAt could not do this at all — it
        // throws Cocoa error 4 for a symlink, live or dangling.
        let target = directory.appendingPathComponent("target.txt")
        try "TARGET".write(to: target, atomically: true, encoding: .utf8)
        let destination = directory.appendingPathComponent("live.wav")
        try FileManager.default.createSymbolicLink(at: destination, withDestinationURL: target)
        let work = try makeWorkFile()

        try OutputPromotion.promote(workURL: work, to: destination)

        XCTAssertEqual(try String(contentsOf: destination), "NEW AUDIO")
        XCTAssertEqual(try String(contentsOf: target), "TARGET", "the link's target is untouched")
        XCTAssertFalse(FileManager.default.fileExists(atPath: work.path))
    }

    func testADanglingSymlinkIsReplaced() throws {
        // fileExists reports false here, which is what made an earlier guard wrong.
        let destination = directory.appendingPathComponent("dangling.wav")
        try FileManager.default.createSymbolicLink(
            at: destination,
            withDestinationURL: directory.appendingPathComponent("missing-target")
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        let work = try makeWorkFile()

        try OutputPromotion.promote(workURL: work, to: destination)

        XCTAssertEqual(try String(contentsOf: destination), "NEW AUDIO")
        XCTAssertFalse(FileManager.default.fileExists(atPath: work.path))
    }

    func testAMissingWorkFileFailsWithoutDisturbingTheDestination() throws {
        let destination = directory.appendingPathComponent("existing.wav")
        try "OLD AUDIO".write(to: destination, atomically: true, encoding: .utf8)
        let absent = directory.appendingPathComponent("never-written.wav")

        XCTAssertThrowsError(try OutputPromotion.promote(workURL: absent, to: destination))
        XCTAssertEqual(try String(contentsOf: destination), "OLD AUDIO")
    }

    func testAFailureCarriesThePosixReason() throws {
        let destination = directory.appendingPathComponent("adir.wav")
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        let work = try makeWorkFile()

        do {
            try OutputPromotion.promote(workURL: work, to: destination)
            XCTFail("promoting onto a directory must throw")
        } catch let error as NSError {
            let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError
            XCTAssertEqual(underlying?.domain, NSPOSIXErrorDomain)
            XCTAssertEqual(underlying?.code, Int(EISDIR), "the kernel refuses, not a pre-check")
        }
    }
}
