import AVFoundation
import XCTest
@testable import AudioStudio

/// Records what AVFoundation actually does with output sample rates.
///
/// Two attempts at #433 guessed a static range for this and both were wrong in both
/// directions: 1 Hz sits inside a plausible range and yields a nil converter, while 2 MHz
/// sits outside one and converts fine. The answers also differ between macOS and iOS, so
/// they are a property of the platform and the source/target pair, not a constant.
///
/// These do assert specific outcomes, which is a deliberate trade: if Apple changes one,
/// the test fails and someone re-checks the assumption rather than the production code
/// quietly relying on a stale one. They are a record of measured behaviour, not a
/// guarantee it will hold. The one place a constant is still used — the streaming reader — is covered in
/// `BridgedNarrowingTests`, and only because that failure is an uncatchable ObjC exception.
final class ConverterCapabilityTests: XCTestCase {

    private let source = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: 44_100,
        channels: 1,
        interleaved: false
    )!

    private func converter(to rate: Double) -> AVAudioConverter? {
        guard let target = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: rate,
            channels: source.channelCount,
            interleaved: false
        ) else {
            return nil
        }
        return AVAudioConverter(from: source, to: target)
    }

    func testOrdinaryRatesConvert() {
        for rate in [8_000.0, 16_000.0, 44_100.0, 48_000.0, 96_000.0] {
            XCTAssertNotNil(converter(to: rate), "\(rate)Hz should be convertible")
        }
    }

    func testSupportIsNotDescribedByAnUpperBound() {
        // The reason trimAudio has no ceiling. 2MHz is well past the 768kHz bound a
        // previous version of this PR invented, and still converts — so that bound would
        // have refused work the platform is willing to do.
        XCTAssertNotNil(converter(to: 2_000_000))
    }

    func testAnUpsampleNeedsAnOutputBufferSizedByTheRatio() throws {
        // The truncation this PR fixes. A source-sized output buffer cannot hold an
        // upsampled second, so the converter fills what it can and the rest is lost.
        let converted = try convertOneSecond(to: 88_200, scaleOutputBuffer: false)
        XCTAssertEqual(converted, 0.5, accuracy: 0.01, "a source-sized buffer truncates")

        let scaled = try convertOneSecond(to: 88_200, scaleOutputBuffer: true)
        XCTAssertEqual(scaled, 1.0, accuracy: 0.01, "sizing by the ratio preserves duration")
    }

    func testADownsampleMustNotReconsumeItsInput() throws {
        // Returning the same buffer with .haveData forever made the converter read it
        // repeatedly, so a downsample emitted more audio than it was given.
        let reconsumed = try convertOneSecond(to: 22_050, scaleOutputBuffer: false, singleShot: false)
        XCTAssertEqual(reconsumed, 2.0, accuracy: 0.01, "re-consumption doubles the audio")

        let once = try convertOneSecond(to: 22_050, scaleOutputBuffer: true, singleShot: true)
        XCTAssertEqual(once, 1.0, accuracy: 0.01, "supplying the input once preserves duration")
    }

    func testAnExtremeUpsamplePreservesDuration() throws {
        // 384kHz is the case from the report: it used to come back as 0.11s.
        let scaled = try convertOneSecond(to: 384_000, scaleOutputBuffer: true, singleShot: true)
        XCTAssertEqual(scaled, 1.0, accuracy: 0.01)
    }

    /// Converts one second of silence and returns the output duration in seconds.
    private func convertOneSecond(
        to rate: Double,
        scaleOutputBuffer: Bool,
        singleShot: Bool = true
    ) throws -> Double {
        let target = try XCTUnwrap(AVAudioFormat(
            commonFormat: .pcmFormatFloat32, sampleRate: rate,
            channels: source.channelCount, interleaved: false
        ))
        let converter = try XCTUnwrap(AVAudioConverter(from: source, to: target))

        let frames = AVAudioFrameCount(source.sampleRate)
        let input = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: source, frameCapacity: frames))
        input.frameLength = frames

        let capacity = scaleOutputBuffer
            ? AVAudioFrameCount((Double(frames) * rate / source.sampleRate).rounded(.up))
            : frames
        let output = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity))

        var supplied = false
        var error: NSError?
        _ = converter.convert(to: output, error: &error) { _, status in
            if singleShot && supplied {
                status.pointee = .endOfStream
                return nil
            }
            supplied = true
            status.pointee = .haveData
            return input
        }
        XCTAssertNil(error)
        return Double(output.frameLength) / rate
    }

    func testAVAudioFormatIsNotAGateOnNonsenseRates() {
        // Worth recording because it is the opposite of what it looks like: AVAudioFormat
        // happily describes 0 Hz and a negative rate on the simulator. So nothing upstream
        // rejects them, and trim's own `requested > 0` check is what keeps a zero rate from
        // reaching the writer — not the framework.
        XCTAssertNotNil(
            AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 0, channels: 1, interleaved: false),
            "If this ever returns nil, the guard in trimAudio can be simplified"
        )
        XCTAssertNotNil(
            AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: -44_100, channels: 1, interleaved: false)
        )
    }

    func testTheReaderRangeIsStricterThanTheConverter() {
        // Why the two are not one constant: 384kHz converts but terminates the reader, so
        // a shared bound either crashes streaming or downgrades trimming.
        XCTAssertNotNil(converter(to: 384_000))
        XCTAssertFalse(BridgedNarrowing.readerSampleRates.contains(384_000))
    }
}
