import Foundation
import CSherpaOnnx
import AVFoundation

/**
 * SherpaOnnxASRHandler - Automatic Speech Recognition Handler
 *
 * Manages ASR functionality using the upstream SherpaOnnx.swift wrapper classes
 * (SherpaOnnxRecognizer, SherpaOnnxOfflineRecognizer) from prebuilt/swift/.
 *
 * Supports both online (streaming) and offline recognition.
 */
@objc public class SherpaOnnxASRHandler: NSObject {
    // Online recognizer (upstream wrapper)
    private var onlineRecognizer: SherpaOnnxRecognizer?
    // Extra stream for the 5 streaming primitives (separate from recognizer.stream)
    private var primitiveStream: OpaquePointer?

    // Offline recognizer (upstream wrapper)
    private var offlineRecognizer: SherpaOnnxOfflineRecognizer?

    // State tracking
    private var isInitialized: Bool = false
    private var isStreaming: Bool = false
    private var currentSampleRate: Int = 16000

    private static let TAG = "[SherpaOnnxASR]"

    @objc public override init() {
        super.init()
    }

    deinit {
        cleanupResources()
    }

    // MARK: - Library validation

    @objc public static func isLibraryLoaded() -> [String: Any] {
        let tempDir = FileManager.default.temporaryDirectory.path
        let result = SherpaOnnxFileExists(tempDir)
        return [
            "loaded": result >= 0,
            "status": result >= 0 ? "Library is loaded and accessible" : "Library could not be accessed properly",
            "testConfig": ["sampleRate": 16000, "featureDim": 80]
        ]
    }

    // MARK: - Init ASR

    @objc public func initAsr(_ config: NSDictionary) -> NSDictionary {
        NSLog("%@ initAsr called with config: %@", SherpaOnnxASRHandler.TAG, config)

        guard let modelDir = config["modelDir"] as? String else {
            return ["success": false, "error": "modelDir is required"]
        }

        let modelType = config["modelType"] as? String ?? "transducer"
        let streaming = config["streaming"] as? Bool ?? false
        let numThreads = config["numThreads"] as? Int ?? 2
        let debug = config["debug"] as? Bool ?? false
        let sampleRate = config["sampleRate"] as? Int ?? 16000
        let featureDim = config["featureDim"] as? Int ?? 80
        let decodingMethod = config["decodingMethod"] as? String ?? "greedy_search"
        let maxActivePaths = config["maxActivePaths"] as? Int ?? 4
        let provider = config["provider"] as? String ?? "cpu"

        let modelFiles = config["modelFiles"] as? [String: String] ?? [:]

        // Clean up any previous recognizer
        cleanupResources()

        if streaming {
            return initOnlineAsr(
                modelDir: modelDir, modelType: modelType, modelFiles: modelFiles,
                numThreads: numThreads, debug: debug, sampleRate: sampleRate,
                featureDim: featureDim, decodingMethod: decodingMethod,
                maxActivePaths: maxActivePaths, provider: provider
            )
        } else {
            return initOfflineAsr(
                modelDir: modelDir, modelType: modelType, modelFiles: modelFiles,
                numThreads: numThreads, debug: debug, sampleRate: sampleRate,
                featureDim: featureDim, decodingMethod: decodingMethod,
                maxActivePaths: maxActivePaths, provider: provider,
                config: config
            )
        }
    }

    // MARK: - Online (streaming) init

    private func initOnlineAsr(
        modelDir: String, modelType: String, modelFiles: [String: String],
        numThreads: Int, debug: Bool, sampleRate: Int, featureDim: Int,
        decodingMethod: String, maxActivePaths: Int, provider: String
    ) -> NSDictionary {
        NSLog("%@ Initializing ONLINE ASR, modelType=%@", SherpaOnnxASRHandler.TAG, modelType)

        let tokensFile = modelFiles["tokens"] ?? "tokens.txt"
        let tokensPath = (modelDir as NSString).appendingPathComponent(tokensFile)

        // Build model config using upstream helpers based on model type
        var transducerConfig = sherpaOnnxOnlineTransducerModelConfig()
        var paraformerConfig = sherpaOnnxOnlineParaformerModelConfig()
        var zipformer2CtcConfig = sherpaOnnxOnlineZipformer2CtcModelConfig()

        switch modelType {
        case "transducer", "zipformer", "zipformer2":
            let encoderFile = modelFiles["encoder"] ?? "encoder.onnx"
            let decoderFile = modelFiles["decoder"] ?? "decoder.onnx"
            let joinerFile = modelFiles["joiner"] ?? "joiner.onnx"
            let encoderPath = (modelDir as NSString).appendingPathComponent(encoderFile)
            let decoderPath = (modelDir as NSString).appendingPathComponent(decoderFile)
            let joinerPath = (modelDir as NSString).appendingPathComponent(joinerFile)
            NSLog("%@ encoder: %@, decoder: %@, joiner: %@", SherpaOnnxASRHandler.TAG, encoderPath, decoderPath, joinerPath)
            // Validate files exist before passing to native (prevents SIGSEGV on missing files)
            for (label, path) in [("encoder", encoderPath), ("decoder", decoderPath), ("joiner", joinerPath), ("tokens", tokensPath)] {
                if !FileManager.default.fileExists(atPath: path) {
                    return ["success": false, "error": "Model file not found: \(label) at \(path)"]
                }
            }
            transducerConfig = sherpaOnnxOnlineTransducerModelConfig(
                encoder: encoderPath, decoder: decoderPath, joiner: joinerPath
            )
        default:
            return ["success": false, "error": "Unsupported online model type: \(modelType)"]
        }

        let modelConfig = sherpaOnnxOnlineModelConfig(
            tokens: tokensPath,
            transducer: transducerConfig,
            paraformer: paraformerConfig,
            zipformer2Ctc: zipformer2CtcConfig,
            numThreads: numThreads,
            provider: provider,
            debug: debug ? 1 : 0,
            modelType: modelType
        )

        let featConfig = sherpaOnnxFeatureConfig(sampleRate: sampleRate, featureDim: featureDim)

        var recognizerConfig = sherpaOnnxOnlineRecognizerConfig(
            featConfig: featConfig,
            modelConfig: modelConfig,
            enableEndpoint: true,
            rule1MinTrailingSilence: 2.4,
            rule2MinTrailingSilence: 1.2,
            rule3MinUtteranceLength: 20.0,
            decodingMethod: decodingMethod,
            maxActivePaths: maxActivePaths
        )

        // Create recognizer using upstream wrapper
        let recognizer = SherpaOnnxRecognizer(config: &recognizerConfig)
        guard recognizer.recognizer != nil else {
            return ["success": false, "error": "Failed to create online recognizer — check model files and paths"]
        }

        onlineRecognizer = recognizer
        isStreaming = true
        isInitialized = true
        currentSampleRate = sampleRate

        NSLog("%@ Online ASR initialized successfully, sampleRate=%d", SherpaOnnxASRHandler.TAG, sampleRate)

        return [
            "success": true,
            "sampleRate": sampleRate,
            "modelType": modelType,
            "streaming": true
        ]
    }

    // MARK: - Offline init

    private func initOfflineAsr(
        modelDir: String, modelType: String, modelFiles: [String: String],
        numThreads: Int, debug: Bool, sampleRate: Int, featureDim: Int,
        decodingMethod: String, maxActivePaths: Int, provider: String,
        config: NSDictionary
    ) -> NSDictionary {
        NSLog("%@ Initializing OFFLINE ASR, modelType=%@", SherpaOnnxASRHandler.TAG, modelType)

        let tokensFile = modelFiles["tokens"] ?? "tokens.txt"
        // Qwen3 ships its own tokenizer directory and does not consume a
        // root-level tokens.txt; pass an empty path so upstream skips the
        // missing-file check.
        let tokensPath = (modelType == "qwen3")
            ? ""
            : (modelDir as NSString).appendingPathComponent(tokensFile)

        // Optional fields read from the JS config dict; defaults match the
        // upstream OfflineModelConfig defaults when the field is absent.
        let language = config["language"] as? String ?? ""
        let task = config["task"] as? String ?? "transcribe"
        let useItn = config["useItn"] as? Bool ?? true
        let usePunct = config["usePunct"] as? Bool ?? true
        let hotwords = config["hotwords"] as? String ?? ""
        // Qwen3 generation params: prefer flattened TurboModule keys, fall back to a
        // nested `qwen3` dict for callers that bypass the SherpaOnnxAPI flatten layer.
        let qwen3Nested = config["qwen3"] as? [String: Any] ?? [:]
        func qwen3Int(_ flatKey: String, _ nestedKey: String, _ defaultValue: Int) -> Int {
            // RN TurboModule numeric fields cross the bridge as NSNumber
            // (often boxed Double), not native Int. `as? Int` returns nil for
            // Double(512), so go through NSNumber.intValue like qwen3Float
            // does for Float.
            if let v = (config[flatKey] as? NSNumber)?.intValue { return v }
            if let v = (qwen3Nested[nestedKey] as? NSNumber)?.intValue { return v }
            return defaultValue
        }
        func qwen3Float(_ flatKey: String, _ nestedKey: String, _ defaultValue: Float) -> Float {
            if let v = (config[flatKey] as? NSNumber)?.floatValue { return v }
            if let v = (qwen3Nested[nestedKey] as? NSNumber)?.floatValue { return v }
            return defaultValue
        }

        // Build model-specific configs using upstream helpers
        var transducerConfig = sherpaOnnxOfflineTransducerModelConfig()
        var paraformerConfig = sherpaOnnxOfflineParaformerModelConfig()
        var whisperConfig = sherpaOnnxOfflineWhisperModelConfig()
        var nemoCtcConfig = sherpaOnnxOfflineNemoEncDecCtcModelConfig()
        var moonshineConfig = sherpaOnnxOfflineMoonshineModelConfig()
        var senseVoiceConfig = sherpaOnnxOfflineSenseVoiceModelConfig()
        var tdnnConfig = sherpaOnnxOfflineTdnnModelConfig()
        var fireRedAsrConfig = sherpaOnnxOfflineFireRedAsrModelConfig()
        var qwen3Config = sherpaOnnxOfflineQwen3ASRModelConfig()
        var cohereTranscribeConfig = sherpaOnnxOfflineCohereTranscribeModelConfig()

        switch modelType {
        case "transducer", "zipformer", "zipformer2":
            let encoderFile = modelFiles["encoder"] ?? "encoder.onnx"
            let decoderFile = modelFiles["decoder"] ?? "decoder.onnx"
            let joinerFile = modelFiles["joiner"] ?? "joiner.onnx"
            transducerConfig = sherpaOnnxOfflineTransducerModelConfig(
                encoder: (modelDir as NSString).appendingPathComponent(encoderFile),
                decoder: (modelDir as NSString).appendingPathComponent(decoderFile),
                joiner: (modelDir as NSString).appendingPathComponent(joinerFile)
            )

        case "paraformer":
            let modelFile = modelFiles["model"] ?? "model.onnx"
            paraformerConfig = sherpaOnnxOfflineParaformerModelConfig(
                model: (modelDir as NSString).appendingPathComponent(modelFile)
            )

        case "whisper":
            let encoderFile = modelFiles["encoder"] ?? "encoder.onnx"
            let decoderFile = modelFiles["decoder"] ?? "decoder.onnx"
            whisperConfig = sherpaOnnxOfflineWhisperModelConfig(
                encoder: (modelDir as NSString).appendingPathComponent(encoderFile),
                decoder: (modelDir as NSString).appendingPathComponent(decoderFile),
                language: language.isEmpty ? "en" : language,
                task: task
            )

        case "nemo_ctc", "nemo_transducer":
            let modelFile = modelFiles["model"] ?? "model.onnx"
            nemoCtcConfig = sherpaOnnxOfflineNemoEncDecCtcModelConfig(
                model: (modelDir as NSString).appendingPathComponent(modelFile)
            )

        case "moonshine":
            let preprocessorFile = modelFiles["preprocessor"] ?? "preprocess.onnx"
            let encoderFile = modelFiles["encoder"] ?? "encode.onnx"
            let uncachedDecoderFile = modelFiles["uncachedDecoder"] ?? "uncached_decode.onnx"
            let cachedDecoderFile = modelFiles["cachedDecoder"] ?? "cached_decode.onnx"
            moonshineConfig = sherpaOnnxOfflineMoonshineModelConfig(
                preprocessor: (modelDir as NSString).appendingPathComponent(preprocessorFile),
                encoder: (modelDir as NSString).appendingPathComponent(encoderFile),
                uncachedDecoder: (modelDir as NSString).appendingPathComponent(uncachedDecoderFile),
                cachedDecoder: (modelDir as NSString).appendingPathComponent(cachedDecoderFile)
            )

        case "sense_voice":
            let modelFile = modelFiles["model"] ?? "model.onnx"
            senseVoiceConfig = sherpaOnnxOfflineSenseVoiceModelConfig(
                model: (modelDir as NSString).appendingPathComponent(modelFile),
                language: language,
                useInverseTextNormalization: useItn
            )

        case "fire_red_asr":
            let encoderFile = modelFiles["encoder"] ?? "encoder.onnx"
            let decoderFile = modelFiles["decoder"] ?? "decoder.onnx"
            fireRedAsrConfig = sherpaOnnxOfflineFireRedAsrModelConfig(
                encoder: (modelDir as NSString).appendingPathComponent(encoderFile),
                decoder: (modelDir as NSString).appendingPathComponent(decoderFile)
            )

        case "qwen3":
            let convFrontendFile = modelFiles["convFrontend"] ?? "conv_frontend.onnx"
            let encoderFile = modelFiles["encoder"] ?? "encoder.int8.onnx"
            let decoderFile = modelFiles["decoder"] ?? "decoder.int8.onnx"
            let tokenizerName = modelFiles["tokenizer"] ?? "tokenizer"
            qwen3Config = sherpaOnnxOfflineQwen3ASRModelConfig(
                convFrontend: (modelDir as NSString).appendingPathComponent(convFrontendFile),
                encoder: (modelDir as NSString).appendingPathComponent(encoderFile),
                decoder: (modelDir as NSString).appendingPathComponent(decoderFile),
                tokenizer: (modelDir as NSString).appendingPathComponent(tokenizerName),
                maxTotalLen: qwen3Int("qwen3MaxTotalLen", "maxTotalLen", 512),
                maxNewTokens: qwen3Int("qwen3MaxNewTokens", "maxNewTokens", 128),
                temperature: qwen3Float("qwen3Temperature", "temperature", 1e-6),
                topP: qwen3Float("qwen3TopP", "topP", 0.8),
                seed: qwen3Int("qwen3Seed", "seed", 42),
                hotwords: hotwords
            )

        case "cohere_transcribe":
            let encoderFile = modelFiles["encoder"] ?? "encoder.int8.onnx"
            let decoderFile = modelFiles["decoder"] ?? "decoder.int8.onnx"
            cohereTranscribeConfig = sherpaOnnxOfflineCohereTranscribeModelConfig(
                encoder: (modelDir as NSString).appendingPathComponent(encoderFile),
                decoder: (modelDir as NSString).appendingPathComponent(decoderFile),
                language: language,
                usePunct: usePunct,
                useInverseTextNormalization: useItn
            )

        default:
            return ["success": false, "error": "Unsupported offline model type: \(modelType)"]
        }

        let modelConfig = sherpaOnnxOfflineModelConfig(
            tokens: tokensPath,
            transducer: transducerConfig,
            paraformer: paraformerConfig,
            nemoCtc: nemoCtcConfig,
            whisper: whisperConfig,
            tdnn: tdnnConfig,
            numThreads: numThreads,
            provider: provider,
            debug: debug ? 1 : 0,
            modelType: modelType,
            senseVoice: senseVoiceConfig,
            moonshine: moonshineConfig,
            fireRedAsr: fireRedAsrConfig,
            qwen3Asr: qwen3Config,
            cohereTranscribe: cohereTranscribeConfig
        )

        let featConfig = sherpaOnnxFeatureConfig(sampleRate: sampleRate, featureDim: featureDim)

        var recognizerConfig = sherpaOnnxOfflineRecognizerConfig(
            featConfig: featConfig,
            modelConfig: modelConfig,
            decodingMethod: decodingMethod,
            maxActivePaths: maxActivePaths
        )

        // Create recognizer using upstream wrapper
        let recognizer = SherpaOnnxOfflineRecognizer(config: &recognizerConfig)
        guard recognizer.recognizer != nil else {
            return ["success": false, "error": "Failed to create offline recognizer — check model files and paths"]
        }

        offlineRecognizer = recognizer
        isStreaming = false
        isInitialized = true
        currentSampleRate = sampleRate

        NSLog("%@ Offline ASR initialized successfully, sampleRate=%d", SherpaOnnxASRHandler.TAG, sampleRate)

        return [
            "success": true,
            "sampleRate": sampleRate,
            "modelType": modelType,
            "streaming": false
        ]
    }

    // MARK: - Recognize from samples

    @objc public func recognizeFromSamples(_ sampleRate: Int, samples: NSArray) -> NSDictionary {
        // Convert NSArray to [Float]
        var floatSamples = [Float]()
        floatSamples.reserveCapacity(samples.count)
        for i in 0..<samples.count {
            if let val = samples[i] as? NSNumber {
                floatSamples.append(val.floatValue)
            }
        }

        if isStreaming {
            return recognizeFromSamplesStreaming(sampleRate, samples: floatSamples)
        } else {
            return recognizeFromSamplesOffline(sampleRate, samples: floatSamples)
        }
    }

    private func recognizeFromSamplesStreaming(_ sampleRate: Int, samples: [Float]) -> NSDictionary {
        guard let recognizer = onlineRecognizer, recognizer.recognizer != nil else {
            return ["success": false, "error": "Online ASR not initialized"]
        }

        let startTime = CFAbsoluteTimeGetCurrent()

        // Create a fresh stream for this recognition (don't use the persistent one)
        let stream: OpaquePointer! = SherpaOnnxCreateOnlineStream(recognizer.recognizer)
        guard stream != nil else {
            return ["success": false, "error": "Failed to create online stream"]
        }

        // Feed audio in chunks
        let chunkSize = 800
        var offset = 0
        while offset < samples.count {
            let end = min(offset + chunkSize, samples.count)
            let chunk = Array(samples[offset..<end])
            SherpaOnnxOnlineStreamAcceptWaveform(stream, Int32(sampleRate), chunk, Int32(chunk.count))
            while SherpaOnnxIsOnlineStreamReady(recognizer.recognizer, stream) == 1 {
                SherpaOnnxDecodeOnlineStream(recognizer.recognizer, stream)
            }
            offset = end
        }

        // Add tail padding (0.66s of silence) and signal end
        let tailPadFrames = Int(Float(sampleRate) * 0.66)
        let tailPad = [Float](repeating: 0.0, count: tailPadFrames)
        SherpaOnnxOnlineStreamAcceptWaveform(stream, Int32(sampleRate), tailPad, Int32(tailPadFrames))
        SherpaOnnxOnlineStreamInputFinished(stream)

        // Drain remaining frames
        while SherpaOnnxIsOnlineStreamReady(recognizer.recognizer, stream) == 1 {
            SherpaOnnxDecodeOnlineStream(recognizer.recognizer, stream)
        }

        // Get result
        let resultPtr = SherpaOnnxGetOnlineStreamResult(recognizer.recognizer, stream)
        var text = ""
        if let result = resultPtr {
            text = String(cString: result.pointee.text).trimmingCharacters(in: .whitespaces)
            SherpaOnnxDestroyOnlineRecognizerResult(resultPtr)
        }

        SherpaOnnxDestroyOnlineStream(stream)

        let durationMs = (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0

        return [
            "success": true,
            "text": text,
            "durationMs": Int(durationMs),
            "sampleRate": sampleRate,
            "samplesLength": samples.count
        ]
    }

    private func recognizeFromSamplesOffline(_ sampleRate: Int, samples: [Float]) -> NSDictionary {
        guard let recognizer = offlineRecognizer, recognizer.recognizer != nil else {
            return ["success": false, "error": "Offline ASR not initialized"]
        }

        let startTime = CFAbsoluteTimeGetCurrent()

        // Use the upstream wrapper's decode method
        let result = recognizer.decode(samples: samples, sampleRate: sampleRate)
        let text = result.text.trimmingCharacters(in: .whitespaces)

        let durationMs = (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0

        return [
            "success": true,
            "text": text,
            "durationMs": Int(durationMs),
            "sampleRate": sampleRate,
            "samplesLength": samples.count
        ]
    }

    // MARK: - Recognize from file

    @objc public func recognizeFromFile(_ filePath: String) -> NSDictionary {
        let startTime = CFAbsoluteTimeGetCurrent()

        // Read WAV file using the C API
        guard let wave = SherpaOnnxReadWave(filePath) else {
            return ["success": false, "error": "Failed to read WAV file: \(filePath)"]
        }

        let wavSampleRate = Int(wave.pointee.sample_rate)
        let numSamples = Int(wave.pointee.num_samples)

        NSLog("%@ Read WAV: sampleRate=%d, numSamples=%d", SherpaOnnxASRHandler.TAG, wavSampleRate, numSamples)

        // Convert C pointer to Swift array
        var floatSamples = [Float]()
        floatSamples.reserveCapacity(numSamples)
        if let samplesPtr = wave.pointee.samples {
            for i in 0..<numSamples {
                floatSamples.append(samplesPtr[i])
            }
        }
        SherpaOnnxFreeWave(wave)

        var text = ""

        if isStreaming, let recognizer = onlineRecognizer, recognizer.recognizer != nil {
            // Streaming recognition via a temporary stream
            let stream: OpaquePointer! = SherpaOnnxCreateOnlineStream(recognizer.recognizer)
            guard stream != nil else {
                return ["success": false, "error": "Failed to create online stream"]
            }

            let chunkSize = 800
            var offset = 0
            while offset < floatSamples.count {
                let end = min(offset + chunkSize, floatSamples.count)
                let chunk = Array(floatSamples[offset..<end])
                SherpaOnnxOnlineStreamAcceptWaveform(stream, Int32(wavSampleRate), chunk, Int32(chunk.count))
                while SherpaOnnxIsOnlineStreamReady(recognizer.recognizer, stream) == 1 {
                    SherpaOnnxDecodeOnlineStream(recognizer.recognizer, stream)
                }
                offset = end
            }

            // Tail padding + finish
            let tailPadFrames = Int(Float(wavSampleRate) * 0.66)
            let tailPad = [Float](repeating: 0.0, count: tailPadFrames)
            SherpaOnnxOnlineStreamAcceptWaveform(stream, Int32(wavSampleRate), tailPad, Int32(tailPadFrames))
            SherpaOnnxOnlineStreamInputFinished(stream)
            while SherpaOnnxIsOnlineStreamReady(recognizer.recognizer, stream) == 1 {
                SherpaOnnxDecodeOnlineStream(recognizer.recognizer, stream)
            }

            let resultPtr = SherpaOnnxGetOnlineStreamResult(recognizer.recognizer, stream)
            if let result = resultPtr {
                text = String(cString: result.pointee.text).trimmingCharacters(in: .whitespaces)
                SherpaOnnxDestroyOnlineRecognizerResult(resultPtr)
            }
            SherpaOnnxDestroyOnlineStream(stream)

        } else if let recognizer = offlineRecognizer, recognizer.recognizer != nil {
            // Use the upstream wrapper's decode method
            let result = recognizer.decode(samples: floatSamples, sampleRate: wavSampleRate)
            text = result.text.trimmingCharacters(in: .whitespaces)
        } else {
            return ["success": false, "error": "ASR not initialized"]
        }

        let durationMs = (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0

        return [
            "success": true,
            "text": text,
            "durationMs": Int(durationMs),
            "sampleRate": wavSampleRate,
            "samplesLength": numSamples
        ]
    }

    // MARK: - Online streaming primitives (5 methods)
    // These use a separate "primitiveStream" so that the recognizer's built-in stream
    // (used by recognizeFromSamples/recognizeFromFile) is not disturbed.

    @objc public func createAsrOnlineStream() -> NSDictionary {
        guard let recognizer = onlineRecognizer, recognizer.recognizer != nil else {
            return ["success": false, "error": "Online ASR not initialized"]
        }
        if let stream = primitiveStream {
            SherpaOnnxDestroyOnlineStream(stream)
            primitiveStream = nil
        }
        primitiveStream = SherpaOnnxCreateOnlineStream(recognizer.recognizer)
        if primitiveStream == nil {
            return ["success": false, "error": "Failed to create online stream"]
        }
        return ["success": true]
    }

    @objc public func acceptAsrOnlineWaveform(_ sampleRate: Int, samples: NSArray) -> NSDictionary {
        guard let recognizer = onlineRecognizer, recognizer.recognizer != nil,
              let stream = primitiveStream else {
            return ["success": false, "error": "Online stream not created"]
        }
        var floatSamples = [Float]()
        floatSamples.reserveCapacity(samples.count)
        for i in 0..<samples.count {
            if let val = samples[i] as? NSNumber {
                floatSamples.append(val.floatValue)
            }
        }
        SherpaOnnxOnlineStreamAcceptWaveform(stream, Int32(sampleRate), floatSamples, Int32(floatSamples.count))
        while SherpaOnnxIsOnlineStreamReady(recognizer.recognizer, stream) == 1 {
            SherpaOnnxDecodeOnlineStream(recognizer.recognizer, stream)
        }
        return ["success": true]
    }

    @objc public func isAsrOnlineEndpoint() -> NSDictionary {
        guard let recognizer = onlineRecognizer, recognizer.recognizer != nil,
              let stream = primitiveStream else {
            return ["isEndpoint": false, "error": "Online stream not created"]
        }
        let isEndpoint = SherpaOnnxOnlineStreamIsEndpoint(recognizer.recognizer, stream) == 1
        return ["isEndpoint": isEndpoint]
    }

    @objc public func getAsrOnlineResult() -> NSDictionary {
        guard let recognizer = onlineRecognizer, recognizer.recognizer != nil,
              let stream = primitiveStream else {
            return ["text": "", "tokens": [], "timestamps": [], "error": "Online stream not created"]
        }
        let resultPtr = SherpaOnnxGetOnlineStreamResult(recognizer.recognizer, stream)
        guard let result = resultPtr else {
            return ["text": "", "tokens": [], "timestamps": []]
        }
        let text = String(cString: result.pointee.text).trimmingCharacters(in: .whitespaces)
        var tokens: [String] = []
        var timestamps: [Double] = []
        let count = Int(result.pointee.count)
        if count > 0 {
            for i in 0..<count {
                if let tokenPtr = result.pointee.tokens_arr?[i] {
                    tokens.append(String(cString: tokenPtr))
                }
            }
            if let ts = result.pointee.timestamps {
                for i in 0..<count {
                    timestamps.append(Double(ts[i]))
                }
            }
        }
        SherpaOnnxDestroyOnlineRecognizerResult(resultPtr)
        return ["text": text, "tokens": tokens, "timestamps": timestamps]
    }

    @objc public func resetAsrOnlineStream() -> NSDictionary {
        guard let recognizer = onlineRecognizer, recognizer.recognizer != nil,
              let stream = primitiveStream else {
            return ["success": false, "error": "Online stream not created"]
        }
        SherpaOnnxOnlineStreamReset(recognizer.recognizer, stream)
        return ["success": true]
    }

    // MARK: - Release

    @objc public func releaseResources() -> NSDictionary {
        cleanupResources()
        return ["released": true]
    }

    private func cleanupResources() {
        if let stream = primitiveStream {
            SherpaOnnxDestroyOnlineStream(stream)
            primitiveStream = nil
        }
        // The upstream wrappers handle their own cleanup in deinit
        onlineRecognizer = nil
        offlineRecognizer = nil
        isInitialized = false
        isStreaming = false
    }
}
