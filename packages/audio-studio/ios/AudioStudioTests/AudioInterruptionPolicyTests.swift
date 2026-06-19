import XCTest
import AVFoundation
@testable import AudioStudio

final class AudioInterruptionPolicyTests: XCTestCase {
    func testInterruptionOptionsDefaultsToEmptyWhenSystemOmitsKey() {
        let options = InterruptionOptionsPolicy.options(from: [:])

        XCTAssertFalse(options.contains(.shouldResume))
    }

    func testAutoResumeDoesNotRequireShouldResumeOptionWhenSystemPausedRecording() {
        XCTAssertTrue(
            AutoResumePolicy.shouldAutoResume(
                autoResumeAfterInterruption: true,
                isRecording: true,
                isPaused: true,
                pausedBySystemInterruption: true
            )
        )
    }

    func testAutoResumePreservesUserPausedRecording() {
        XCTAssertFalse(
            AutoResumePolicy.shouldAutoResume(
                autoResumeAfterInterruption: true,
                isRecording: true,
                isPaused: true,
                pausedBySystemInterruption: false
            )
        )
    }

    func testInvalidHardwareFormatSkipsTapInstall() {
        XCTAssertFalse(
            AudioTapInstallPolicy.shouldInstallTap(channelCount: 0, sampleRate: 16_000)
        )
        XCTAssertFalse(
            AudioTapInstallPolicy.shouldInstallTap(channelCount: 1, sampleRate: 0)
        )
        XCTAssertTrue(
            AudioTapInstallPolicy.shouldInstallTap(channelCount: 1, sampleRate: 44_100)
        )
    }
}
