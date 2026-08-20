import XCTest
@testable import AudioStudio

/// Covers the primary-WAV write recovery introduced for #420.
///
/// The reported symptom was the compressed M4A continuing to grow after an interruption
/// while the WAV stopped. The cause was that a failed append was logged and dropped: the
/// handle stayed broken, every later buffer hit the same failure, and nothing told the
/// caller — who was using the WAV as a crash-recovery backup — that it had gone stale.
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

    func testReportsTheFirstFailureOnly() {
        // One broken handle produces a failed append per buffer — dozens a second. The
        // caller needs to hear that once, not be flooded.
        XCTAssertTrue(PrimaryWriteFailurePolicy.shouldReport(alreadyReported: false))
        XCTAssertFalse(PrimaryWriteFailurePolicy.shouldReport(alreadyReported: true))
    }

    func testRecoveryResumesWhereTheRecordingStoppedRatherThanTruncating() throws {
        // The behaviour the fix depends on: reopening and seeking to end appends. Starting
        // over would discard the recording so far, which is worse than the stall it fixes,
        // because the WAV header is only written at stop.
        //
        // This drives FileHandle the way reopenPrimaryFileHandle() does rather than calling
        // it, since constructing an AudioStreamManager needs a live AVAudioEngine. It
        // guards the assumption, not the wiring — the write path itself is covered on
        // device, not here.
        let url = directory.appendingPathComponent("resume.wav")
        FileManager.default.createFile(atPath: url.path, contents: nil)

        let first = try FileHandle(forWritingTo: url)
        try first.write(contentsOf: Data(repeating: 0x11, count: 128))
        try first.close()

        // The handle is now unusable, exactly as it is after a bad interruption.
        XCTAssertThrowsError(try first.write(contentsOf: Data([0x01])))

        let reopened = try FileHandle(forWritingTo: url)
        try reopened.seekToEnd()
        try reopened.write(contentsOf: Data(repeating: 0x22, count: 64))
        try reopened.close()

        let result = try Data(contentsOf: url)
        XCTAssertEqual(result.count, 192, "Recovery must append, not truncate")
        XCTAssertEqual(result.prefix(128), Data(repeating: 0x11, count: 128))
        XCTAssertEqual(result.suffix(64), Data(repeating: 0x22, count: 64))
    }

    func testRecoveryCannotSucceedWhenTheFileIsGone() throws {
        // The case that must reach the delegate instead of stalling quietly.
        let url = directory.appendingPathComponent("missing.wav")

        XCTAssertThrowsError(try FileHandle(forWritingTo: url))
    }
}
