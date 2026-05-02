import Foundation
import CSherpaOnnx

/// SherpaOnnxVADHandler - Voice Activity Detection Handler
///
/// Manages VAD using the sherpa-onnx C API (Silero VAD v5).
@objc public class SherpaOnnxVADHandler: NSObject {
    private var vad: OpaquePointer?  // const SherpaOnnxVoiceActivityDetector *
    private var sampleRate: Int = 16000

    private static let TAG = "[SherpaOnnxVAD]"

    @objc public override init() {
        super.init()
    }

    deinit {
        cleanupResources()
    }

    // MARK: - Init

    @objc public func initVad(_ config: NSDictionary) -> NSDictionary {
        NSLog("%@ initVad called", SherpaOnnxVADHandler.TAG)

        guard let modelDir = config["modelDir"] as? String else {
            return ["success": false, "error": "modelDir is required"]
        }

        let modelFile = config["modelFile"] as? String ?? "silero_vad_v5.onnx"
        let threshold = config["threshold"] as? Float ?? 0.5
        let minSilenceDuration = config["minSilenceDuration"] as? Float ?? 0.25
        let minSpeechDuration = config["minSpeechDuration"] as? Float ?? 0.25
        let windowSize = config["windowSize"] as? Int32 ?? 512
        let maxSpeechDuration = config["maxSpeechDuration"] as? Float ?? 5.0
        let bufferSizeInSeconds = config["bufferSizeInSeconds"] as? Float ?? 30.0
        let numThreads = config["numThreads"] as? Int32 ?? 1
        let debug = config["debug"] as? Bool ?? false
        let provider = config["provider"] as? String ?? "cpu"

        let modelPath = (modelDir as NSString).appendingPathComponent(modelFile)
        if !FileManager.default.fileExists(atPath: modelPath) {
            return ["success": false, "error": "VAD model file not found: \(modelPath)"]
        }

        // Clean up previous
        cleanupResources()

        sampleRate = 16000

        // Build SileroVadModelConfig
        let modelPathC = strdup(modelPath)!
        var sileroConfig = SherpaOnnxSileroVadModelConfig(
            model: modelPathC,
            threshold: threshold,
            min_silence_duration: minSilenceDuration,
            min_speech_duration: minSpeechDuration,
            window_size: windowSize,
            max_speech_duration: maxSpeechDuration
        )

        // Build VadModelConfig
        let providerC = strdup(provider)!

        var tenVadConfig = SherpaOnnxTenVadModelConfig(
            model: nil,
            threshold: 0,
            min_silence_duration: 0,
            min_speech_duration: 0,
            window_size: 0,
            max_speech_duration: 0
        )

        var vadConfig = SherpaOnnxVadModelConfig(
            silero_vad: sileroConfig,
            sample_rate: Int32(sampleRate),
            num_threads: numThreads,
            provider: providerC,
            debug: debug ? 1 : 0,
            ten_vad: tenVadConfig
        )

        let vadPtr = SherpaOnnxCreateVoiceActivityDetector(&vadConfig, bufferSizeInSeconds)

        // Free C strings
        free(modelPathC)
        free(providerC)

        guard vadPtr != nil else {
            return ["success": false, "error": "Failed to create VAD instance"]
        }
        vad = vadPtr

        NSLog("%@ VAD initialized successfully (threshold=%.2f, windowSize=%d)", SherpaOnnxVADHandler.TAG, threshold, windowSize)
        return ["success": true]
    }

    // MARK: - Accept waveform

    @objc public func acceptWaveform(_ sampleRate: Int, samples: NSArray) -> NSDictionary {
        guard let vadPtr = vad else {
            return ["success": false, "isSpeechDetected": false, "segments": [], "error": "VAD not initialized"] as NSDictionary
        }

        // Convert samples to Float array
        var floatSamples = [Float]()
        floatSamples.reserveCapacity(samples.count)
        for i in 0..<samples.count {
            if let val = samples[i] as? NSNumber {
                floatSamples.append(val.floatValue)
            }
        }

        // Accept waveform
        floatSamples.withUnsafeBufferPointer { bufferPtr in
            SherpaOnnxVoiceActivityDetectorAcceptWaveform(vadPtr, bufferPtr.baseAddress, Int32(floatSamples.count))
        }

        // Check if speech is detected
        let isSpeechDetected = SherpaOnnxVoiceActivityDetectorDetected(vadPtr) == 1

        // Collect completed speech segments
        var segments = [[String: Any]]()
        while SherpaOnnxVoiceActivityDetectorEmpty(vadPtr) == 0 {
            if let segmentPtr = SherpaOnnxVoiceActivityDetectorFront(vadPtr) {
                let start = Int(segmentPtr.pointee.start)
                let numSamples = Int(segmentPtr.pointee.n)
                let segment: [String: Any] = [
                    "start": start,
                    "duration": numSamples,
                    "startTime": Double(start) / Double(self.sampleRate),
                    "endTime": Double(start + numSamples) / Double(self.sampleRate)
                ]
                segments.append(segment)
                SherpaOnnxDestroySpeechSegment(segmentPtr)
            }
            SherpaOnnxVoiceActivityDetectorPop(vadPtr)
        }

        return [
            "success": true,
            "isSpeechDetected": isSpeechDetected,
            "segments": segments
        ] as NSDictionary
    }

    // MARK: - Reset

    @objc public func resetVad() -> NSDictionary {
        guard let vadPtr = vad else {
            return ["success": false, "error": "VAD not initialized"]
        }
        SherpaOnnxVoiceActivityDetectorReset(vadPtr)
        return ["success": true]
    }

    // MARK: - Release

    @objc public func releaseVad() -> NSDictionary {
        cleanupResources()
        return ["released": true]
    }

    private func cleanupResources() {
        if let vadPtr = vad {
            SherpaOnnxDestroyVoiceActivityDetector(vadPtr)
            vad = nil
        }
        NSLog("%@ VAD resources released", SherpaOnnxVADHandler.TAG)
    }
}
