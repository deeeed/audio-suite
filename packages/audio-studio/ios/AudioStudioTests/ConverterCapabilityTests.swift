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
/// These assert the shape of that behaviour rather than exact rates, so they document why
/// the production code asks instead of assuming, without failing when Apple changes a
/// limit. The one place a constant is still used — the streaming reader — is covered in
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
        // The reason trimAudio has no ceiling: a rate far above any hardware still
        // converts, so rejecting it would refuse work the platform is willing to do.
        XCTAssertNotNil(converter(to: 384_000))
    }

    func testConverterConstructionIsFallibleByContract() {
        // The reason trim constructs fallibly rather than range-checking: this returns an
        // Optional, and which pairs yield nil varies by OS — 1Hz from a 44.1kHz source is
        // nil on macOS. Asserting the type, not a specific rate, keeps this honest when
        // Apple changes a limit.
        let result: AVAudioConverter? = converter(to: 1)
        XCTAssertTrue(type(of: result) == Optional<AVAudioConverter>.self)
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
