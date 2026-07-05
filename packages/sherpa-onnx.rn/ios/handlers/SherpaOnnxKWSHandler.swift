import Foundation
import CSherpaOnnx

/// SherpaOnnxKWSHandler - Keyword Spotting Handler
///
/// Manages keyword spotting using the sherpa-onnx C API directly.
@objc public class SherpaOnnxKWSHandler: NSObject {
    private var spotter: OpaquePointer?   // const SherpaOnnxKeywordSpotter *
    private var stream: OpaquePointer?    // const SherpaOnnxOnlineStream *
    private var totalSamplesAccepted: Int64 = 0

    private static let TAG = "[SherpaOnnxKWS]"

    @objc public override init() {
        super.init()
    }

    deinit {
        cleanupResources()
    }

    // MARK: - Init

    @objc public func initKws(_ config: NSDictionary) -> NSDictionary {
        NSLog("%@ initKws called", SherpaOnnxKWSHandler.TAG)

        guard let modelDir = config["modelDir"] as? String else {
            return ["success": false, "error": "modelDir is required"]
        }

        let numThreads = config["numThreads"] as? Int ?? 2
        let debug = config["debug"] as? Bool ?? false
        let provider = config["provider"] as? String ?? "cpu"
        let maxActivePaths = config["maxActivePaths"] as? Int ?? 4
        // NSNumber bridging fix (Swift SE-0170): the RN bridge boxes JS numbers
        // as double-backed NSNumbers, and `as? Float` on those returns nil unless
        // the value is exactly Float32-representable — so non-dyadic config like
        // 0.005 silently fell back to the default. `.floatValue` converts explicitly.
        let keywordsScore = (config["keywordsScore"] as? NSNumber)?.floatValue ?? 1.5
        let keywordsThreshold = (config["keywordsThreshold"] as? NSNumber)?.floatValue ?? 0.25
        let numTrailingBlanks = config["numTrailingBlanks"] as? Int ?? 2
        let modelType = config["modelType"] as? String ?? "zipformer2"

        // Read model file paths (flattened from TurboModule)
        let encoder = config["modelFileEncoder"] as? String ?? ""
        let decoder = config["modelFileDecoder"] as? String ?? ""
        let joiner = config["modelFileJoiner"] as? String ?? ""
        let tokens = config["modelFileTokens"] as? String ?? "tokens.txt"
        let keywordsFile = config["keywordsFile"] as? String ?? "keywords.txt"

        // Build absolute paths
        let encoderPath = encoder.isEmpty ? "" : (modelDir as NSString).appendingPathComponent(encoder)
        let decoderPath = decoder.isEmpty ? "" : (modelDir as NSString).appendingPathComponent(decoder)
        let joinerPath = joiner.isEmpty ? "" : (modelDir as NSString).appendingPathComponent(joiner)
        let tokensPath = (modelDir as NSString).appendingPathComponent(tokens)
        let keywordsFilePath = (modelDir as NSString).appendingPathComponent(keywordsFile)

        // Validate files
        if !encoder.isEmpty && !FileManager.default.fileExists(atPath: encoderPath) {
            return ["success": false, "error": "Encoder file not found: \(encoderPath)"]
        }
        if !decoder.isEmpty && !FileManager.default.fileExists(atPath: decoderPath) {
            return ["success": false, "error": "Decoder file not found: \(decoderPath)"]
        }
        if !joiner.isEmpty && !FileManager.default.fileExists(atPath: joinerPath) {
            return ["success": false, "error": "Joiner file not found: \(joinerPath)"]
        }
        if !FileManager.default.fileExists(atPath: tokensPath) {
            return ["success": false, "error": "Tokens file not found: \(tokensPath)"]
        }
        if !FileManager.default.fileExists(atPath: keywordsFilePath) {
            return ["success": false, "error": "Keywords file not found: \(keywordsFilePath)"]
        }

        // Clean up previous resources
        cleanupResources()

        // Build configs using upstream Swift helpers
        let transducerConfig = sherpaOnnxOnlineTransducerModelConfig(
            encoder: encoderPath,
            decoder: decoderPath,
            joiner: joinerPath
        )

        let onlineModelConfig = sherpaOnnxOnlineModelConfig(
            tokens: tokensPath,
            transducer: transducerConfig,
            numThreads: numThreads,
            provider: provider,
            debug: debug ? 1 : 0,
            modelType: modelType
        )

        let featConfig = sherpaOnnxFeatureConfig(
            sampleRate: 16000,
            featureDim: 80
        )

        var kwsConfig = sherpaOnnxKeywordSpotterConfig(
            featConfig: featConfig,
            modelConfig: onlineModelConfig,
            keywordsFile: keywordsFilePath,
            maxActivePaths: maxActivePaths,
            numTrailingBlanks: numTrailingBlanks,
            keywordsScore: keywordsScore,
            keywordsThreshold: keywordsThreshold
        )

        // Create spotter
        let spotterPtr = SherpaOnnxCreateKeywordSpotter(&kwsConfig)
        guard spotterPtr != nil else {
            return ["success": false, "error": "Failed to create keyword spotter"]
        }
        spotter = spotterPtr

        // Create initial stream
        let streamPtr = SherpaOnnxCreateKeywordStream(spotter)
        guard streamPtr != nil else {
            SherpaOnnxDestroyKeywordSpotter(spotter)
            spotter = nil
            return ["success": false, "error": "Failed to create KWS stream"]
        }
        stream = streamPtr
        totalSamplesAccepted = 0

        NSLog("%@ KWS initialized successfully", SherpaOnnxKWSHandler.TAG)

        return ["success": true]
    }

    // MARK: - Accept waveform and decode

    @objc public func acceptWaveform(_ sampleRate: Int, samples: NSArray) -> NSDictionary {
        guard let spotterPtr = spotter, let streamPtr = stream else {
            return ["success": false, "detected": false, "keyword": "", "error": "KWS not initialized"]
        }

        // Convert samples to Float array
        var floatSamples = [Float]()
        floatSamples.reserveCapacity(samples.count)
        for i in 0..<samples.count {
            if let val = samples[i] as? NSNumber {
                floatSamples.append(val.floatValue)
            }
        }

        totalSamplesAccepted += Int64(floatSamples.count)
        NSLog("%@ acceptWaveform: %d samples (total: %lld)", SherpaOnnxKWSHandler.TAG, floatSamples.count, totalSamplesAccepted)

        // Accept waveform
        SherpaOnnxOnlineStreamAcceptWaveform(streamPtr, Int32(sampleRate), floatSamples, Int32(floatSamples.count))

        // Decode while ready
        var decodeCount = 0
        while SherpaOnnxIsKeywordStreamReady(spotterPtr, streamPtr) == 1 {
            SherpaOnnxDecodeKeywordStream(spotterPtr, streamPtr)
            decodeCount += 1
        }

        // Get result
        let resultPtr = SherpaOnnxGetKeywordResult(spotterPtr, streamPtr)
        var keyword = ""

        if let resultPtr = resultPtr {
            if let kwPtr = resultPtr.pointee.keyword {
                keyword = String(cString: kwPtr)
            }
            SherpaOnnxDestroyKeywordResult(resultPtr)
        }

        let detected = !keyword.isEmpty

        if detected {
            NSLog("%@ KEYWORD DETECTED: \"%@\" (after %lld samples)", SherpaOnnxKWSHandler.TAG, keyword, totalSamplesAccepted)
            SherpaOnnxResetKeywordStream(spotterPtr, streamPtr)
        }

        if decodeCount > 0 {
            NSLog("%@ Decoded %d times, keyword: \"%@\"", SherpaOnnxKWSHandler.TAG, decodeCount, keyword)
        }

        return [
            "success": true,
            "detected": detected,
            "keyword": keyword
        ]
    }

    // MARK: - Reset stream

    @objc public func resetStream() -> NSDictionary {
        guard let spotterPtr = spotter, let streamPtr = stream else {
            return ["success": false, "error": "KWS not initialized"]
        }

        SherpaOnnxResetKeywordStream(spotterPtr, streamPtr)
        return ["success": true]
    }

    // MARK: - Release

    @objc public func releaseKws() -> NSDictionary {
        cleanupResources()
        return ["released": true]
    }

    private func cleanupResources() {
        if let streamPtr = stream {
            SherpaOnnxDestroyOnlineStream(streamPtr)
            stream = nil
        }
        if let spotterPtr = spotter {
            SherpaOnnxDestroyKeywordSpotter(spotterPtr)
            spotter = nil
        }
        NSLog("%@ KWS resources released", SherpaOnnxKWSHandler.TAG)
    }
}
