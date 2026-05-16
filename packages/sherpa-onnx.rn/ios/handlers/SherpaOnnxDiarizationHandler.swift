import Foundation
import AVFoundation
import CSherpaOnnx

/// SherpaOnnxDiarizationHandler - Offline Speaker Diarization Handler
///
/// Wraps SherpaOnnxOfflineSpeakerDiarizationWrapper to segment audio by speaker.
@objc public class SherpaOnnxDiarizationHandler: NSObject {
    private var sd: SherpaOnnxOfflineSpeakerDiarizationWrapper?
    private var currentConfig: SherpaOnnxOfflineSpeakerDiarizationConfig?

    private static let TAG = "[SherpaOnnxDiarization]"

    @objc public override init() {
        super.init()
    }

    deinit {
        sd = nil
        currentConfig = nil
    }

    // MARK: - Init

    @objc public func initDiarization(_ config: NSDictionary) -> NSDictionary {
        NSLog("%@ initDiarization called", SherpaOnnxDiarizationHandler.TAG)

        guard let segModelDir = config["segmentationModelDir"] as? String else {
            return ["success": false, "sampleRate": 0, "error": "segmentationModelDir is required"]
        }
        guard let embModelFile = config["embeddingModelFile"] as? String else {
            return ["success": false, "sampleRate": 0, "error": "embeddingModelFile is required"]
        }

        let numThreads = config["numThreads"] as? Int ?? 1
        let debug = config["debug"] as? Bool ?? false
        let provider = config["provider"] as? String ?? "cpu"
        let minDurationOn = config["minDurationOn"] as? Float ?? 0.3
        let minDurationOff = config["minDurationOff"] as? Float ?? 0.5
        let numClusters = config["numClusters"] as? Int ?? -1
        let threshold = config["threshold"] as? Float ?? 0.5

        let requestedSegModelFile = config["segmentationModelFile"] as? String
        let segModelPath: String
        if let requestedSegModelFile, !requestedSegModelFile.isEmpty {
            if requestedSegModelFile.hasPrefix("/") {
                segModelPath = requestedSegModelFile
            } else {
                segModelPath = (segModelDir as NSString).appendingPathComponent(requestedSegModelFile)
            }
        } else {
            // Quality default: use the full precision pyannote model.
            // model.int8.onnx remains available by explicitly passing
            // segmentationModelFile for size/speed tradeoff cases.
            segModelPath = (segModelDir as NSString).appendingPathComponent("model.onnx")
        }

        if !FileManager.default.fileExists(atPath: segModelPath) {
            return ["success": false, "sampleRate": 0, "error": "Segmentation model not found: \(segModelPath)"]
        }
        if !FileManager.default.fileExists(atPath: embModelFile) {
            return ["success": false, "sampleRate": 0, "error": "Embedding model not found: \(embModelFile)"]
        }

        // Release previous instance
        sd = nil

        let pyannoteConfig = sherpaOnnxOfflineSpeakerSegmentationPyannoteModelConfig(model: segModelPath)
        let segConfig = sherpaOnnxOfflineSpeakerSegmentationModelConfig(
            pyannote: pyannoteConfig,
            numThreads: numThreads,
            debug: debug ? 1 : 0,
            provider: provider
        )
        let embConfig = sherpaOnnxSpeakerEmbeddingExtractorConfig(
            model: embModelFile,
            numThreads: numThreads,
            debug: debug ? 1 : 0,
            provider: provider
        )
        let clusteringConfig = sherpaOnnxFastClusteringConfig(numClusters: numClusters, threshold: threshold)

        var cfg = sherpaOnnxOfflineSpeakerDiarizationConfig(
            segmentation: segConfig,
            embedding: embConfig,
            clustering: clusteringConfig,
            minDurationOn: minDurationOn,
            minDurationOff: minDurationOff
        )

        let wrapper = SherpaOnnxOfflineSpeakerDiarizationWrapper(config: &cfg)
        guard wrapper.impl != nil else {
            return ["success": false, "sampleRate": 0, "error": "Failed to create diarization instance"]
        }
        sd = wrapper
        currentConfig = cfg

        let sampleRate = wrapper.sampleRate
        NSLog("%@ Diarization initialized, sampleRate=%d", SherpaOnnxDiarizationHandler.TAG, sampleRate)

        return ["success": true, "sampleRate": sampleRate]
    }

    // MARK: - Process file

    @objc public func processDiarizationFile(_ filePath: String, numClusters: Int, threshold: Float) -> NSDictionary {
        guard let sdWrapper = sd else {
            return ["success": false, "segments": [], "numSpeakers": 0, "durationMs": 0,
                    "error": "Diarization not initialized"]
        }

        // Read WAV file
        guard let wave = SherpaOnnxReadWave(filePath) else {
            return ["success": false, "segments": [], "numSpeakers": 0, "durationMs": 0,
                    "error": "Failed to read audio file: \(filePath)"]
        }

        let originalConfig = applyClusteringConfigIfNeeded(
            sdWrapper: sdWrapper,
            numClusters: numClusters,
            threshold: threshold
        )
        defer {
            restoreClusteringConfigIfNeeded(sdWrapper: sdWrapper, config: originalConfig)
        }

        let numSamples = Int(wave.pointee.num_samples)
        var floatSamples = [Float](repeating: 0, count: numSamples)
        for i in 0..<numSamples {
            floatSamples[i] = wave.pointee.samples[i]
        }
        SherpaOnnxFreeWave(wave)

        let startTime = CFAbsoluteTimeGetCurrent()
        let segments = sdWrapper.process(samples: floatSamples)
        let durationMs = Int((CFAbsoluteTimeGetCurrent() - startTime) * 1000)

        var speakerSet = Set<Int>()
        var segmentDicts = [[String: Any]]()
        for seg in segments {
            segmentDicts.append([
                "start": Double(seg.start),
                "end": Double(seg.end),
                "speaker": seg.speaker,
            ])
            speakerSet.insert(seg.speaker)
        }

        return [
            "success": true,
            "segments": segmentDicts,
            "numSpeakers": speakerSet.count,
            "durationMs": durationMs,
        ]
    }

    @objc public func processDiarizationFileWindow(_ filePath: String, startTimeMs: Double, durationMs: Double, numClusters: Int, threshold: Float) -> NSDictionary {
        guard let sdWrapper = sd else {
            return ["success": false, "segments": [], "numSpeakers": 0, "durationMs": 0,
                    "startTimeMs": startTimeMs, "windowDurationMs": durationMs,
                    "error": "Diarization not initialized"]
        }

        do {
            let originalConfig = applyClusteringConfigIfNeeded(
                sdWrapper: sdWrapper,
                numClusters: numClusters,
                threshold: threshold
            )
            defer {
                restoreClusteringConfigIfNeeded(sdWrapper: sdWrapper, config: originalConfig)
            }

            let audioFile = try AVAudioFile(forReading: URL(fileURLWithPath: filePath))
            let format = audioFile.processingFormat
            let sampleRate = Int(format.sampleRate)
            let expectedSampleRate = sdWrapper.sampleRate
            guard sampleRate == expectedSampleRate else {
                return ["success": false, "segments": [], "numSpeakers": 0, "durationMs": 0,
                        "startTimeMs": startTimeMs, "windowDurationMs": durationMs,
                        "sampleRate": sampleRate, "samples": 0,
                        "error": "Unsupported sample rate for iOS windowed diarization: got \(sampleRate), expected \(expectedSampleRate). Resample before calling."]
            }
            let channelCount = Int(format.channelCount)
            let requestedStartFrame = AVAudioFramePosition(max(0.0, startTimeMs) / 1000.0 * format.sampleRate)
            let startFrame = max(0, min(requestedStartFrame, audioFile.length))
            let requestedFrameCount = AVAudioFrameCount(max(0.0, durationMs) / 1000.0 * format.sampleRate)
            let availableFrames = AVAudioFrameCount(max(0, audioFile.length - startFrame))
            let frameCount = min(requestedFrameCount, availableFrames)

            guard frameCount > 0,
                  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
                return ["success": false, "segments": [], "numSpeakers": 0, "durationMs": 0,
                        "startTimeMs": startTimeMs, "windowDurationMs": durationMs,
                        "sampleRate": sampleRate, "samples": 0,
                        "error": "Empty audio window"]
            }

            audioFile.framePosition = startFrame
            try audioFile.read(into: buffer, frameCount: frameCount)

            let actualFrames = Int(buffer.frameLength)
            var floatSamples = [Float](repeating: 0, count: actualFrames)
            if let channelData = buffer.floatChannelData {
                for frame in 0..<actualFrames {
                    var sum: Float = 0
                    for channel in 0..<max(1, channelCount) {
                        sum += channelData[channel][frame]
                    }
                    floatSamples[frame] = sum / Float(max(1, channelCount))
                }
            } else {
                return ["success": false, "segments": [], "numSpeakers": 0, "durationMs": 0,
                        "startTimeMs": startTimeMs, "windowDurationMs": durationMs,
                        "sampleRate": sampleRate, "samples": 0,
                        "error": "Unsupported audio buffer format"]
            }

            let startTime = CFAbsoluteTimeGetCurrent()
            let segments = sdWrapper.process(samples: floatSamples)
            let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - startTime) * 1000)
            let offsetSeconds = startTimeMs / 1000.0

            var speakerSet = Set<Int>()
            var segmentDicts = [[String: Any]]()
            for seg in segments {
                segmentDicts.append([
                    "start": Double(seg.start) + offsetSeconds,
                    "end": Double(seg.end) + offsetSeconds,
                    "speaker": seg.speaker,
                ])
                speakerSet.insert(seg.speaker)
            }

            return [
                "success": true,
                "segments": segmentDicts,
                "numSpeakers": speakerSet.count,
                "durationMs": elapsedMs,
                "startTimeMs": startTimeMs,
                "windowDurationMs": durationMs,
                "sampleRate": sampleRate,
                "samples": actualFrames,
            ]
        } catch {
            return ["success": false, "segments": [], "numSpeakers": 0, "durationMs": 0,
                    "startTimeMs": startTimeMs, "windowDurationMs": durationMs,
                    "error": "Failed to read audio window: \(error.localizedDescription)"]
        }
    }

    // MARK: - Release

    @objc public func releaseDiarization() -> NSDictionary {
        sd = nil
        currentConfig = nil
        return ["released": true]
    }

    private func applyClusteringConfigIfNeeded(
        sdWrapper: SherpaOnnxOfflineSpeakerDiarizationWrapper,
        numClusters: Int,
        threshold: Float
    ) -> SherpaOnnxOfflineSpeakerDiarizationConfig? {
        guard numClusters != -1 || threshold != 0.5 else {
            return nil
        }
        guard var config = currentConfig else {
            return nil
        }
        let originalConfig = config
        config.clustering = sherpaOnnxFastClusteringConfig(
            numClusters: numClusters,
            threshold: threshold
        )
        sdWrapper.setConfig(config: &config)
        currentConfig = config
        return originalConfig
    }

    private func restoreClusteringConfigIfNeeded(
        sdWrapper: SherpaOnnxOfflineSpeakerDiarizationWrapper,
        config originalConfig: SherpaOnnxOfflineSpeakerDiarizationConfig?
    ) {
        guard var config = originalConfig else {
            return
        }
        sdWrapper.setConfig(config: &config)
        currentConfig = config
    }
}
