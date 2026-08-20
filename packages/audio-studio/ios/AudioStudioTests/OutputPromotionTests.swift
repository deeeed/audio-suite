import XCTest
@testable import AudioStudio

/// Covers promoting a trim's work file onto its destination (#433).
///
/// Every previous version of this was verified by hand and every one had a hole. Writing
/// straight to the destination destroyed it before failure was known; guarding the cleanup
/// with `fileExists` preserved the already-corrupted file and mistook a dangling symlink
/// for an absent one; and the work-file version replaced a non-empty directory, which the
/// manual check missed because it only exercised directories on the failure path.
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

    // MARK: - The decision

    func testAnAbsentDestinationIsMovedOnto() {
        XCTAssertEqual(OutputPromotion.action(forExistingType: nil), .move)
    }

    func testARegularFileIsReplaced() {
        XCTAssertEqual(OutputPromotion.action(forExistingType: .typeRegular), .replace)
    }

    func testASymlinkIsReplaced() {
        // Replacing the link itself, not what it points at.
        XCTAssertEqual(OutputPromotion.action(forExistingType: .typeSymbolicLink), .replace)
    }

    func testADirectoryIsRefused() {
        // The case that made it through manual checking: replaceItemAt succeeds against a
        // directory and takes its contents with it.
        guard case .refuse = OutputPromotion.action(forExistingType: .typeDirectory) else {
            return XCTFail("A directory destination must be refused")
        }
    }

    func testOtherFileTypesAreRefused() {
        for type in [FileAttributeType.typeSocket, .typeBlockSpecial, .typeCharacterSpecial] {
            guard case .refuse = OutputPromotion.action(forExistingType: type) else {
                return XCTFail("\(type.rawValue) must be refused")
            }
        }
    }

    // MARK: - Against a real filesystem

    func testANonEmptyDirectoryAndItsContentsSurvive() throws {
        let destination = directory.appendingPathComponent("target.wav")
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        let sentinel = destination.appendingPathComponent("keep.txt")
        try "SENTINEL".write(to: sentinel, atomically: true, encoding: .utf8)

        let work = try makeWorkFile()
        XCTAssertThrowsError(try OutputPromotion.promote(workURL: work, to: destination))

        XCTAssertEqual(try String(contentsOf: sentinel), "SENTINEL")
        var isDirectory: ObjCBool = false
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: destination.path, isDirectory: &isDirectory)
        )
        XCTAssertTrue(isDirectory.boolValue, "the destination must still be a directory")
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: work.path),
            "the work file is left for the caller to clean up"
        )
    }

    func testAnExistingFileIsReplacedByTheWorkFile() throws {
        let destination = directory.appendingPathComponent("existing.wav")
        try "OLD AUDIO".write(to: destination, atomically: true, encoding: .utf8)

        let work = try makeWorkFile()
        try OutputPromotion.promote(workURL: work, to: destination)

        XCTAssertEqual(try String(contentsOf: destination), "NEW AUDIO")
        XCTAssertFalse(FileManager.default.fileExists(atPath: work.path))
    }

    func testAFreshDestinationReceivesTheWorkFile() throws {
        let destination = directory.appendingPathComponent("fresh.wav")
        let work = try makeWorkFile()

        try OutputPromotion.promote(workURL: work, to: destination)

        XCTAssertEqual(try String(contentsOf: destination), "NEW AUDIO")
        XCTAssertFalse(FileManager.default.fileExists(atPath: work.path))
    }

    func testADanglingSymlinkIsSeenRatherThanTreatedAsAbsent() throws {
        // fileExists returns false here, which is what made the previous guard wrong.
        let destination = directory.appendingPathComponent("dangling.wav")
        try FileManager.default.createSymbolicLink(
            at: destination,
            withDestinationURL: directory.appendingPathComponent("missing-target")
        )

        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        XCTAssertEqual(OutputPromotion.existingType(at: destination), .typeSymbolicLink)
    }
}
