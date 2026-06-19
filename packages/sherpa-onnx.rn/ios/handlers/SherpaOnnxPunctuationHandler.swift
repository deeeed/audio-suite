import Foundation
import CSherpaOnnx

@objc public class SherpaOnnxPunctuationHandler: NSObject {
    private enum Engine {
        case online
        case offline
    }

    private var punctPtr: OpaquePointer?
    private var engine: Engine = .online

    private static let TAG = "[SherpaOnnxPunctuation]"

    @objc public override init() {
        super.init()
    }

    deinit {
        cleanupResources()
    }

    // MARK: - Init

    @objc public func initPunctuation(_ config: NSDictionary) -> NSDictionary {
        NSLog("%@ initPunctuation called", SherpaOnnxPunctuationHandler.TAG)

        guard let modelDir = config["modelDir"] as? String else {
            return ["success": false, "error": "modelDir is required"]
        }

        let numThreads = config["numThreads"] as? Int ?? 1
        let debug = config["debug"] as? Bool ?? false
        let provider = config["provider"] as? String ?? "cpu"

        // Find subdirectory (tar.bz2 extracts to subfolder)
        var actualModelDir = modelDir
        let fm = FileManager.default
        if let contents = try? fm.contentsOfDirectory(atPath: modelDir) {
            let subdirs = contents.filter { item in
                var isDir: ObjCBool = false
                fm.fileExists(atPath: (modelDir as NSString).appendingPathComponent(item), isDirectory: &isDir)
                return isDir.boolValue && !item.hasPrefix(".")
            }
            if subdirs.count == 1 {
                actualModelDir = (modelDir as NSString).appendingPathComponent(subdirs[0])
            }
        }

        if let model = config["model"] as? String, !model.isEmpty {
            let modelPath = (actualModelDir as NSString).appendingPathComponent(model)
            if !fm.fileExists(atPath: modelPath) {
                return ["success": false, "error": "model file not found: \(modelPath)"]
            }

            cleanupResources()

            let modelC = strdup(modelPath)!
            let providerC = strdup(provider)!

            var modelConfig = SherpaOnnxOfflinePunctuationModelConfig(
                ct_transformer: modelC,
                num_threads: Int32(numThreads),
                debug: debug ? 1 : 0,
                provider: providerC
            )

            var punctConfig = SherpaOnnxOfflinePunctuationConfig(model: modelConfig)
            let ptr = SherpaOnnxCreateOfflinePunctuation(&punctConfig)

            free(modelC)
            free(providerC)

            guard ptr != nil else {
                return ["success": false, "error": "Failed to create OfflinePunctuation instance"]
            }

            punctPtr = ptr
            engine = .offline

            NSLog("%@ Offline punctuation initialized successfully", SherpaOnnxPunctuationHandler.TAG)
            return ["success": true]
        }

        let cnnBilstm = config["cnnBilstm"] as? String ?? "model.onnx"
        let bpeVocab = config["bpeVocab"] as? String ?? "bpe.vocab"

        let cnnBilstmPath = (actualModelDir as NSString).appendingPathComponent(cnnBilstm)
        let bpeVocabPath = (actualModelDir as NSString).appendingPathComponent(bpeVocab)

        if !fm.fileExists(atPath: cnnBilstmPath) {
            return ["success": false, "error": "cnnBilstm file not found: \(cnnBilstmPath)"]
        }
        if !fm.fileExists(atPath: bpeVocabPath) {
            return ["success": false, "error": "bpeVocab file not found: \(bpeVocabPath)"]
        }

        cleanupResources()

        let cnnBilstmC = strdup(cnnBilstmPath)!
        let bpeVocabC = strdup(bpeVocabPath)!
        let providerC = strdup(provider)!

        var modelConfig = SherpaOnnxOnlinePunctuationModelConfig(
            cnn_bilstm: cnnBilstmC,
            bpe_vocab: bpeVocabC,
            num_threads: Int32(numThreads),
            debug: debug ? 1 : 0,
            provider: providerC
        )

        var punctConfig = SherpaOnnxOnlinePunctuationConfig(
            model: modelConfig
        )

        let ptr = SherpaOnnxCreateOnlinePunctuation(&punctConfig)

        free(cnnBilstmC)
        free(bpeVocabC)
        free(providerC)

        guard ptr != nil else {
            return ["success": false, "error": "Failed to create Punctuation instance"]
        }

        punctPtr = ptr
        engine = .online

        NSLog("%@ Online punctuation initialized successfully", SherpaOnnxPunctuationHandler.TAG)
        return ["success": true]
    }

    // MARK: - Add Punctuation

    @objc public func addPunctuation(_ text: String) -> NSDictionary {
        guard let punct = punctPtr else {
            return ["success": false, "error": "Punctuation not initialized"]
        }

        let startTime = CFAbsoluteTimeGetCurrent()

        var punctuated = ""
        switch engine {
        case .online:
            let resultPtr = SherpaOnnxOnlinePunctuationAddPunct(punct, text)
            if let resultPtr = resultPtr {
                punctuated = String(cString: resultPtr)
                SherpaOnnxOnlinePunctuationFreeText(resultPtr)
            }
        case .offline:
            let resultPtr = SherpaOfflinePunctuationAddPunct(punct, text)
            if let resultPtr = resultPtr {
                punctuated = String(cString: resultPtr)
                SherpaOfflinePunctuationFreeText(resultPtr)
            }
        }

        let durationMs = (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0

        NSLog("%@ Punctuated text: %@ in %.0fms", SherpaOnnxPunctuationHandler.TAG, punctuated, durationMs)

        return [
            "success": true,
            "text": punctuated,
            "durationMs": Int(durationMs)
        ]
    }

    // MARK: - Release

    @objc public func releasePunctuation() -> NSDictionary {
        cleanupResources()
        return ["released": true]
    }

    private func cleanupResources() {
        if let ptr = punctPtr {
            switch engine {
            case .online:
                SherpaOnnxDestroyOnlinePunctuation(ptr)
            case .offline:
                SherpaOnnxDestroyOfflinePunctuation(ptr)
            }
            punctPtr = nil
        }
        engine = .online
        NSLog("%@ Punctuation resources released", SherpaOnnxPunctuationHandler.TAG)
    }
}
