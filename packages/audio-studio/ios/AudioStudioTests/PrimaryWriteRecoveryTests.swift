import XCTest
@testable import AudioStudio

/// Covers the primary-WAV write recovery introduced for #420.
///
/// The reported symptom was the compressed M4A continuing to grow after an interruption
/// while the WAV stopped. The cause was that a failed append was logged and dropped: the
/// handle stayed broken, every later buffer hit the same failure, and nothing told the
/// caller — who was using the WAV as a crash-recovery backup — that it had gone stale.
///
/// These cover the decisions, not the wiring. `AudioStreamManager` imports UIKit and
/// MediaPlayer, so its write path cannot be constructed here; that part is source review
/// only, and is called out as such in the PR.
final class PrimaryWriteRecoveryTests: XCTestCase {

    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("primary-write-recovery-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    // MARK: - Reporting

    func testReportsTheFirstFailureOnly() {
        // One broken handle fails every subsequent buffer — dozens a second. The caller
        // needs to hear that once, not be flooded.
        XCTAssertTrue(PrimaryWriteFailurePolicy.shouldReport(alreadyReported: false))
        XCTAssertFalse(PrimaryWriteFailurePolicy.shouldReport(alreadyReported: true))
    }

    // MARK: - Where to resume writing

    func testResumesInPlaceWhenTheFileMatchesWhatWasCounted() {
        XCTAssertEqual(
            PrimaryWriteFailurePolicy.resume(physicalEnd: 1_068, logicalEnd: 1_068),
            .append
        )
    }

    func testDiscardsAPartiallyCommittedWriteBeforeRetrying() {
        // The case that makes retrying dangerous: `write(contentsOf:)` can commit a prefix
        // and then throw. 512 of a 1,024-byte buffer landed, so the file is 512 bytes past
        // what was counted. Appending the whole buffer again would leave 1,536 bytes of
        // payload described by a header that says 1,024 — duplicated, misaligned audio.
        XCTAssertEqual(
            PrimaryWriteFailurePolicy.resume(physicalEnd: 1_580, logicalEnd: 1_068),
            .truncateTo(1_068)
        )
    }

    func testRefusesToAppendWhenTheFileLostBytesAlreadyCounted() {
        // The file is shorter than what has been accounted for, so the two no longer
        // describe the same recording. Appending would produce a WAV whose header
        // overstates its payload; failing is better than emitting a corrupt file.
        XCTAssertEqual(
            PrimaryWriteFailurePolicy.resume(physicalEnd: 512, logicalEnd: 1_068),
            .refuse
        )
    }

    func testAnEmptyFileWithOnlyTheHeaderCountedIsRefusedRatherThanAppended() {
        // A truncated-away file right after preparation: 44 bytes were counted for the
        // header but nothing is on disk.
        XCTAssertEqual(
            PrimaryWriteFailurePolicy.resume(physicalEnd: 0, logicalEnd: 44),
            .refuse
        )
    }

    // MARK: - The FileHandle behaviour the recovery depends on

    func testTruncateThenSeekResumesAtTheCountedLength() throws {
        // Drives FileHandle the way reopenPrimaryFileHandle() does, to confirm truncating
        // back to the logical end and appending there yields exactly the expected bytes.
        let url = directory.appendingPathComponent("partial.wav")
        FileManager.default.createFile(atPath: url.path, contents: nil)

        let first = try FileHandle(forWritingTo: url)
        try first.write(contentsOf: Data(repeating: 0x11, count: 128))
        // Simulate a write that committed a prefix before failing.
        try first.write(contentsOf: Data(repeating: 0xFF, count: 32))
        try first.close()

        let logicalEnd: UInt64 = 128 // The 32 partial bytes were never counted.
        let reopened = try FileHandle(forWritingTo: url)
        let physicalEnd = try reopened.seekToEnd()
        XCTAssertEqual(physicalEnd, 160)

        guard case .truncateTo(let offset) = PrimaryWriteFailurePolicy.resume(
            physicalEnd: physicalEnd,
            logicalEnd: logicalEnd
        ) else {
            return XCTFail("Expected the partial tail to be truncated")
        }
        try reopened.truncate(atOffset: offset)
        try reopened.seek(toOffset: logicalEnd)
        try reopened.write(contentsOf: Data(repeating: 0x22, count: 64))
        try reopened.close()

        let result = try Data(contentsOf: url)
        XCTAssertEqual(result.count, 192, "Retry must not duplicate the committed prefix")
        XCTAssertEqual(result.prefix(128), Data(repeating: 0x11, count: 128))
        XCTAssertEqual(result.suffix(64), Data(repeating: 0x22, count: 64))
        XCTAssertFalse(result.contains(0xFF), "The uncounted partial bytes must be gone")
    }

    func testRecoveryCannotSucceedWhenTheFileIsGone() {
        // The case that must reach the delegate instead of stalling quietly.
        let url = directory.appendingPathComponent("missing.wav")

        XCTAssertThrowsError(try FileHandle(forWritingTo: url))
    }
}
