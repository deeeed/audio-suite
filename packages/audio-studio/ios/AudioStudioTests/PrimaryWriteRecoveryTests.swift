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

    func testSeekingPastEndOfFileWouldWriteSilenceRatherThanFailing() throws {
        // Why every append reconciles, not just the ones after a failure: seeking past EOF
        // succeeds, and the write fills the gap with zeroes. A file that shrank underneath
        // a still-open descriptor would quietly gain silence instead of erroring, so the
        // .refuse branch has to run before the seek.
        let url = directory.appendingPathComponent("hole.wav")
        FileManager.default.createFile(atPath: url.path, contents: nil)

        let handle = try FileHandle(forWritingTo: url)
        try handle.seek(toOffset: 128) // Past the end of an empty file.
        try handle.write(contentsOf: Data(repeating: 0x33, count: 8))
        try handle.close()

        let result = try Data(contentsOf: url)
        XCTAssertEqual(result.count, 136)
        XCTAssertEqual(
            result.prefix(128),
            Data(repeating: 0x00, count: 128),
            "The gap is zero-filled, which as PCM is silence"
        )

        // The policy catches this before the seek happens.
        XCTAssertEqual(
            PrimaryWriteFailurePolicy.resume(physicalEnd: 0, logicalEnd: 128),
            .refuse
        )
    }

    // MARK: - Finalizing after writes stopped being accepted

    func testFinalSizeComesFromTheFileNotTheCounters() throws {
        // Once .refuse stops accepting writes, totalDataSize keeps the length the recording
        // *would* have had. Sizing the header from it writes a data chunk describing audio
        // that is not in the file, and returns that as a successful result — the shrunken
        // file still looks fine to the caller. stopRecording() therefore measures the file.
        let url = directory.appendingPathComponent("shrunk.wav")
        let onDisk = Data(repeating: 0x44, count: 300)
        try onDisk.write(to: url)

        let counted: Int64 = 1_024 // What the counters still believe.
        let physical = (try FileManager.default.attributesOfItem(atPath: url.path)[.size]
            as? NSNumber)?.int64Value
        XCTAssertEqual(physical, 300)

        let finalSize = PrimaryWriteFailurePolicy.finalSize(
            physicalSize: physical,
            accountedSize: counted
        )

        XCTAssertEqual(finalSize, 300, "The file's length wins over a counter that stopped tracking")
        XCTAssertEqual(finalSize - 44, 256, "The data chunk describes bytes that exist")
    }

    func testFinalSizeFallsBackToTheCounterWhenTheFileCannotBeMeasured() {
        // Measuring can fail — a deleted file, a permissions change. The counter is then
        // the only number available, and is right for every recording that did not degrade.
        XCTAssertEqual(
            PrimaryWriteFailurePolicy.finalSize(physicalSize: nil, accountedSize: 1_024),
            1_024
        )
    }

    func testFinalSizeExcludesATailNothingAccountedFor() {
        // The mirror of the shrunken case: a write committed a prefix and neither recovery
        // nor truncation cleaned it up, so the file is longer than what was counted. Those
        // bytes are not known to be whole frames, so claiming them as payload is the same
        // corruption pointing the other way.
        XCTAssertEqual(
            PrimaryWriteFailurePolicy.finalSize(physicalSize: 1_580, accountedSize: 1_024),
            1_024
        )
    }

    func testFinalSizeAgreesWhenNothingDegraded() {
        XCTAssertEqual(
            PrimaryWriteFailurePolicy.finalSize(physicalSize: 1_024, accountedSize: 1_024),
            1_024
        )
    }

    func testAHeaderWithNoSamplesIsStillAUsableFile() {
        // 44 bytes is a valid empty WAV, so it must not be treated as a failure.
        XCTAssertTrue(PrimaryWriteFailurePolicy.isUsableWav(finalSize: 44))
        XCTAssertTrue(PrimaryWriteFailurePolicy.isUsableWav(finalSize: 1_024))
    }

    func testAFileTooShortForAHeaderIsNotUsable() {
        // Nothing will open these, so returning them as a successful recording is a lie.
        XCTAssertFalse(PrimaryWriteFailurePolicy.isUsableWav(finalSize: 43))
        XCTAssertFalse(PrimaryWriteFailurePolicy.isUsableWav(finalSize: 0))
    }

    func testRecoveryCannotSucceedWhenTheFileIsGone() {
        // The case that must reach the delegate instead of stalling quietly.
        let url = directory.appendingPathComponent("missing.wav")

        XCTAssertThrowsError(try FileHandle(forWritingTo: url))
    }
}
