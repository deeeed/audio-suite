// packages/audio-studio/ios/AudioProcessor.swift

import Foundation
import Accelerate
import AVFoundation
import QuartzCore

// Constants
private let SILENCE_THRESHOLD_RMS: Float = 0.01

public struct TrimResult {
    let uri: String
    let filename: String
    let durationMs: Double
    let size: Int64
    let sampleRate: Int
    let channels: Int
    let bitDepth: Int
    let mimeType: String
    let requestedFormat: String
    let actualFormat: String
    let compression: [String: Any]?

    init(
        uri: String,
        filename: String,
        durationMs: Double,
        size: Int64,
        sampleRate: Int,
        channels: Int,
        bitDepth: Int,
        mimeType: String,
        requestedFormat: String,
        actualFormat: String,
        compression: [String: Any]?
    ) {
        self.uri = uri
        self.filename = filename
        self.durationMs = durationMs
        self.size = size
        self.sampleRate = sampleRate
        self.channels = channels
        self.bitDepth = bitDepth
        self.mimeType = mimeType
        self.requestedFormat = requestedFormat
        self.actualFormat = actualFormat
        self.compression = compression
    }

    func toDictionary() -> [String: Any] {
        var dict: [String: Any] = [
            "uri": uri,
            "filename": filename,
            "durationMs": durationMs,
            "size": size,
            "sampleRate": sampleRate,
            "channels": channels,
            "bitDepth": bitDepth,
            "mimeType": mimeType,
            "requestedFormat": requestedFormat,
            "actualFormat": actualFormat
        ]
        if let compression = compression {
            dict["compression"] = compression
        }
        return dict
    }
}

public class AudioProcessor {
    public private(set) var audioFile: AVAudioFile?
    private var result: (Any) -> Void
    private var reject: (String, String) -> Void
    private var waveformData = Array<Float>()
    private var progress: Float = 0.0
    private var channelCount: Int = 1
    private var currentProgress: Float = 0.0
    private let extractionQueue = DispatchQueue(label: "AudioProcessor", attributes: .concurrent)
    private var _abortExtraction: Bool = false

    // Add a counter for unique IDs
    private var uniqueIdCounter = 0

    public var abortExtraction: Bool {
        get { _abortExtraction }
        set { _abortExtraction = newValue }
    }

    // Initializer for file-based processing
    public init(url: URL, resolve: @escaping (Any) -> Void, reject: @escaping (String, String) -> Void) throws {
        self.audioFile = try AVAudioFile(forReading: url)
        self.result = resolve
        self.reject = reject
    }

    // Initializer for buffer-based processing
    public init(resolve: @escaping (Any) -> Void, reject: @escaping (String, String) -> Void) {
        self.result = resolve
        self.reject = reject
    }


    deinit {
        audioFile = nil
    }

    /// Error types for AudioProcessor
    public enum AudioProcessorError: Error {
        case fileInitializationFailed(String)
        case bufferCreationFailed
        case audioReadError(String)
    }


    /// Extracts and processes audio data from the audio file.
    /// - Parameters:
    ///   - numberOfSamples: The number of samples to extract (for waveform).
    ///   - offset: The offset to start reading from (in samples).
    ///   - length: The length of the audio to read (in samples).
    ///   - segmentDurationMs: The duration of each segment in milliseconds.
    ///   - featureOptions: The features to extract.
    ///   - bitDepth: The bit depth of the audio data.
    ///   - numberOfChannels: The number of channels in the audio data.
    ///   - position: The position to start reading from (in bytes).
    ///   - byteLength: The length of the audio to read (in bytes).
    /// - Returns: An `AudioAnalysisData` object containing the extracted features.
    public func processAudioData(
        numberOfSamples: Int?,
        offset: Int? = 0,
        length: UInt? = nil,
        segmentDurationMs: Int = 100, // Default 100ms
        featureOptions: [String: Bool],
        bitDepth: Int,
        numberOfChannels: Int,
        position: Int? = nil,
        byteLength: Int? = nil
    ) -> AudioAnalysisData? {
        guard let audioFile = audioFile else {
            reject("FILE_NOT_INITIALIZED", "Audio file is not initialized.")
            return nil
        }

        let totalFrameCount = AVAudioFrameCount(audioFile.length)
        var framesPerBuffer: AVAudioFrameCount
        let _: Int // Changed from actualPointsPerSecond

        NSLog("""
            [AudioProcessor] Starting audio processing:
            - totalFrameCount: \(totalFrameCount)
            - bitDepth: \(bitDepth)
            - numberOfChannels: \(numberOfChannels)
            - position: \(position ?? -1)
            - byteLength: \(byteLength ?? -1)
            - offset: \(offset ?? -1)
            - length: \(length ?? 0)
        """)

        // Use position/byteLength if provided, otherwise fall back to offset/length
        let effectiveOffset: Int64 = if let position = position {
            Int64(position / (bitDepth / 8) / numberOfChannels)
        } else {
            Int64(offset ?? 0)
        }

        let effectiveLength: Int64 = if let byteLength = byteLength {
            Int64(byteLength / (bitDepth / 8) / numberOfChannels)
        } else if let length = length {
            Int64(length)
        } else {
            Int64(totalFrameCount) - effectiveOffset
        }

        // Report the sum rather than computing it: both operands are bridged, and adding
        // them can overflow before any validation runs (#433).
        let (expectedEndFrame, endFrameOverflowed) = effectiveOffset.addingReportingOverflow(effectiveLength)
        NSLog("""
            [AudioProcessor] Calculated frame positions:
            - effectiveOffset: \(effectiveOffset)
            - effectiveLength: \(effectiveLength)
            - expectedEndFrame: \(endFrameOverflowed ? "overflowed" : String(expectedEndFrame))
            - totalFrameCount: \(totalFrameCount)
        """)

        // Validate frame boundaries
        if effectiveOffset < 0 || effectiveOffset >= Int64(totalFrameCount) {
            NSLog("[AudioProcessor] ERROR: Invalid offset value")
            reject("INVALID_OFFSET", "Offset value (\(effectiveOffset)) is outside valid range [0, \(totalFrameCount)]")
            return nil
        }

        if effectiveLength <= 0 {
            NSLog("[AudioProcessor] ERROR: Invalid length value")
            reject("INVALID_LENGTH", "Length value (\(effectiveLength)) must be positive")
            return nil
        }

        if endFrameOverflowed || expectedEndFrame > Int64(totalFrameCount) {
            NSLog("[AudioProcessor] ERROR: Requested range exceeds file length")
            let describedEnd = endFrameOverflowed ? "overflowed" : String(expectedEndFrame)
            reject("INVALID_RANGE", "Requested range [\(effectiveOffset), \(describedEnd)] exceeds file length \(totalFrameCount)")
            return nil
        }

        var startFrame: AVAudioFramePosition = effectiveOffset
        let endFrame: AVAudioFramePosition = effectiveOffset + effectiveLength

        // Calculate frames per segment based on segment duration
        // Clamp before narrowing: AVAudioFrameCount(_:) traps on a value it cannot
        // represent, and the product depends on the file's sample rate, so no bound
        // on segmentDurationMs alone can make this safe.
        let rawFramesPerSegment = (Double(audioFile.fileFormat.sampleRate) * Double(segmentDurationMs) / 1000.0)
            .rounded(.towardZero)
        let framesPerSegment = AVAudioFrameCount(
            min(max(rawFramesPerSegment, 1), Double(AVAudioFrameCount.max))
        )

        if let numberOfSamples = numberOfSamples {
            framesPerBuffer = AVAudioFrameCount(max(1, effectiveLength / Int64(numberOfSamples)))
        } else {
            framesPerBuffer = framesPerSegment
        }

        guard let buffer = AVAudioPCMBuffer(pcmFormat: audioFile.processingFormat, frameCapacity: framesPerBuffer) else {
            reject("BUFFER_CREATION_FAILED", "Failed to create AVAudioPCMBuffer.")
            return nil
        }

        channelCount = Int(audioFile.processingFormat.channelCount)
        let _ = Array(repeating: [Float](repeating: 0, count: Int(framesPerBuffer)), count: channelCount) // Changed from var data

        var channelData = [Float]()
        while startFrame < endFrame {
            let remainingFrames = endFrame - startFrame
            let currentFramesPerBuffer = min(AVAudioFrameCount(framesPerBuffer), AVAudioFrameCount(remainingFrames))

            if currentFramesPerBuffer <= 0 {
                break
            }

            if abortExtraction {
                audioFile.framePosition = startFrame
                abortExtraction = false
                return nil
            }

            do {
                audioFile.framePosition = startFrame
                try audioFile.read(into: buffer, frameCount: currentFramesPerBuffer)
            } catch {
                reject("AUDIO_READ_ERROR", "Couldn't read into buffer: \(error.localizedDescription)")
                return nil
            }

            //TODO: check if we need conversion based on bitDepth here
            guard let floatData = buffer.floatChannelData else {
                reject("BUFFER_DATA_ERROR", "Failed to retrieve float data from buffer.")
                return nil
            }
            for frame in 0..<Int(buffer.frameLength) {
                channelData.append(floatData[0][frame])
            }

            startFrame += AVAudioFramePosition(currentFramesPerBuffer)
        }

        NSLog("""
            [AudioProcessor] Audio processing completed:
            - processedFrames: \(endFrame - startFrame)
            - framesPerBuffer: \(framesPerBuffer)
        """)

        return processChannelData(
            channelData: channelData,
            sampleRate: Float(audioFile.fileFormat.sampleRate),
            segmentDurationMs: segmentDurationMs,
            featureOptions: featureOptions,
            bitDepth: bitDepth,
            numberOfChannels: numberOfChannels
        )
    }

    /// Processes audio data from a buffer.
    /// - Parameters:
    ///   - data: The audio data buffer.
    ///   - sampleRate: The sample rate of the audio data.
    ///   - segmentDurationMs: The duration of each segment in milliseconds.
    ///   - featureOptions: The features to extract.
    ///   - bitDepth: The bit depth of the audio data.
    ///   - numberOfChannels: The number of channels in the audio data.
    /// - Returns: An `AudioAnalysisData` object containing the extracted features.
    public func processAudioBuffer(
        data: Data,
        sampleRate: Float,
        segmentDurationMs: Int,
        featureOptions: [String: Bool],
        bitDepth: Int,
        numberOfChannels: Int
    ) -> AudioAnalysisData? {
        guard !data.isEmpty else {
            Logger.debug("AudioProcessor", "Data is empty, rejecting")
            reject("DATA_EMPTY", "The audio data is empty.")
            return nil
        }

        // Convert Data to Float array based on bit depth
        let floatData: [Float]
        switch bitDepth {
        case 16:
            floatData = data.withUnsafeBytes { bufferPointer in
                let int16Pointer = bufferPointer.bindMemory(to: Int16.self)
                return int16Pointer.map { Float($0) / Float(Int16.max) }
            }
        case 32:
            floatData = data.withUnsafeBytes { bufferPointer in
                let int32Pointer = bufferPointer.bindMemory(to: Int32.self)
                return int32Pointer.map { Float($0) / Float(Int32.max) }
            }
        default:
            Logger.debug("AudioProcessor", "Unsupported bit depth. Rejecting")
            reject("UNSUPPORTED_BIT_DEPTH", "Unsupported bit depth: \(bitDepth)")
            return nil
        }

        return processChannelData(
            channelData: floatData,
            sampleRate: sampleRate,
            segmentDurationMs: segmentDurationMs,
            featureOptions: featureOptions,
            bitDepth: bitDepth,
            numberOfChannels: numberOfChannels
        )
    }

    /// Processes the given audio channel data to extract features.
    /// - Parameters:
    ///   - channelData: The audio channel data to process.
    ///   - sampleRate: The sample rate of the audio data.
    ///   - segmentDurationMs: The duration of each segment in milliseconds.
    ///   - featureOptions: The features to extract.
    ///   - bitDepth: The bit depth of the audio data.
    ///   - numberOfChannels: The number of channels in the audio data.
    /// - Returns: An `AudioAnalysisData` object containing the extracted features.
    private func processChannelData(
        channelData: [Float],
        sampleRate: Float,
        segmentDurationMs: Int,
        featureOptions: [String: Bool],
        bitDepth: Int,
        numberOfChannels: Int
    ) -> AudioAnalysisData? {
        Logger.debug("AudioProcessor", "Processing audio data with sample rate: \(sampleRate), segmentDurationMs: \(segmentDurationMs), bitDepth: \(bitDepth), numberOfChannels: \(numberOfChannels)")

        let startTime = CACurrentMediaTime()

        let length = channelData.count
        // Calculate points per segment based on segment duration
        // Clamp before narrowing. Int(_:) traps on a value it cannot represent, and
        // the product depends on the incoming sampleRate, so no bound on
        // segmentDurationMs alone makes this safe. Mirrors the frames-per-segment
        // clamp in extraction.
        let rawSamplesPerSegment = (Double(segmentDurationMs) * Double(sampleRate) / 1000.0)
            .rounded(.towardZero)
        let samplesPerSegment = Int(min(max(rawSamplesPerSegment, 1), Double(Int.max / 2)))
        var dataPoints = [DataPoint]()
        var minAmplitude: Float = .greatestFiniteMagnitude
        var maxAmplitude: Float = -.greatestFiniteMagnitude

        // Calculate bytes per sample
        let bytesPerSample = bitDepth / 8

        // Process data in segments
        var i = 0
        while i < length {
            let segmentEnd = min(i + samplesPerSegment, length)
            let segment = Array(channelData[i..<segmentEnd])

            // Calculate byte positions and timing
            let startPosition = i * bytesPerSample * numberOfChannels
            let endPosition = segmentEnd * bytesPerSample * numberOfChannels
            let startTime = Float(i) / sampleRate
            let endTime = Float(segmentEnd) / sampleRate

            // Process segment and create data point
            let dataPoint = processSegment(
                segment,
                sampleRate: sampleRate,
                featureOptions: featureOptions,
                startTime: startTime,
                endTime: endTime,
                startPosition: startPosition,
                endPosition: endPosition
            )
            dataPoints.append(dataPoint)

            // Update min/max amplitudes
            minAmplitude = min(minAmplitude, segment.min() ?? minAmplitude)
            maxAmplitude = max(maxAmplitude, segment.max() ?? maxAmplitude)

            i += samplesPerSegment
        }

        let endTime = CACurrentMediaTime()
        let processingTimeMs = Float((endTime - startTime) * 1000)

        Logger.debug("AudioProcessor", "Processed \(dataPoints.count) data points in \(processingTimeMs) ms")

        return AudioAnalysisData(
            segmentDurationMs: segmentDurationMs,
            durationMs: Int(Float(length) / sampleRate * 1000),
            bitDepth: bitDepth,
            numberOfChannels: numberOfChannels,
            sampleRate: Int(sampleRate),
            samples: length,
            dataPoints: dataPoints,
            amplitudeRange: AudioAnalysisData.AmplitudeRange(
                min: minAmplitude,
                max: maxAmplitude
            ),
            rmsRange: AudioAnalysisData.AmplitudeRange(
                min: 0,
                max: 1
            ),
            speechAnalysis: nil,
            extractionTimeMs: processingTimeMs
        )
    }

    private func processSegment(
        _ segment: [Float],
        sampleRate: Float,
        featureOptions: [String: Bool],
        startTime: Float,
        endTime: Float,
        startPosition: Int,
        endPosition: Int
    ) -> DataPoint {
        let sumSquares: Float = segment.reduce(0) { $0 + $1 * $1 }
        let rms = sqrt(sumSquares / Float(segment.count))
        let silent = rms < SILENCE_THRESHOLD_RMS
        let dB = Float(20 * log10(Double(rms)))

        let features = computeFeatures(
            segmentData: segment,
            sampleRate: sampleRate,
            sumSquares: sumSquares,
            zeroCrossings: 0,
            segmentLength: segment.count,
            featureOptions: featureOptions
        )


        let dataPoint = DataPoint(
            id: Int(uniqueIdCounter),
            amplitude: segment.max() ?? 0,
            rms: rms,
            dB: dB,
            silent: silent,
            features: features,
            speech: SpeechFeatures(isActive: !silent),
            startTime: startTime,
            endTime: endTime,
            startPosition: startPosition,
            endPosition: endPosition,
            samples: segment.count
        )
        uniqueIdCounter += 1
        return dataPoint
    }

    private func computeFeatures(
        segmentData: [Float],
        sampleRate: Float,
        sumSquares: Float,
        zeroCrossings: Int,
        segmentLength: Int,
        featureOptions: [String: Bool]
    ) -> Features {
        let rms = sqrt(sumSquares / Float(segmentLength))
        let energy = featureOptions["energy"] == true ? sumSquares : 0
        let zcr = featureOptions["zcr"] == true ? Float(zeroCrossings) / Float(segmentLength) : 0

        // Determine which C++ features are needed
        let needSpectral = featureOptions["spectralCentroid"] == true ||
                          featureOptions["spectralFlatness"] == true ||
                          featureOptions["spectralRolloff"] == true ||
                          featureOptions["spectralBandwidth"] == true
        let needMfcc = featureOptions["mfcc"] == true
        let needChroma = featureOptions["chromagram"] == true

        // Single C++ call for all FFT-based features
        var spectralCentroid: Float = 0
        var spectralFlatness: Float = 0
        var spectralRolloff: Float = 0
        var spectralBandwidth: Float = 0
        var mfcc: [Float] = []
        var chromagram: [Float] = []

        if needSpectral || needMfcc || needChroma {
            let cppResult = segmentData.withUnsafeBufferPointer { bufPtr in
                AudioFeaturesWrapper.computeFrame(
                    withSamples: bufPtr.baseAddress,
                    numSamples: Int32(segmentData.count),
                    sampleRate: Int32(sampleRate),
                    fftLength: 1024,
                    nMfcc: 13,
                    nMelFilters: 26,
                    computeMfcc: needMfcc,
                    computeChroma: needChroma
                )
            }
            if let result = cppResult {
                if needSpectral {
                    spectralCentroid = (result["spectralCentroid"] as? NSNumber)?.floatValue ?? 0
                    spectralFlatness = (result["spectralFlatness"] as? NSNumber)?.floatValue ?? 0
                    spectralRolloff = (result["spectralRolloff"] as? NSNumber)?.floatValue ?? 0
                    spectralBandwidth = (result["spectralBandwidth"] as? NSNumber)?.floatValue ?? 0
                }
                if needMfcc {
                    mfcc = (result["mfcc"] as? [NSNumber])?.map { $0.floatValue } ?? []
                }
                if needChroma {
                    chromagram = (result["chromagram"] as? [NSNumber])?.map { $0.floatValue } ?? []
                }
            }
        }

        let tempo = featureOptions["tempo"] == true ? extractTempo(from: segmentData, sampleRate: sampleRate) : 0
        let hnr = featureOptions["hnr"] == true ? extractHNR(from: segmentData) : 0
        let melSpectrogram = featureOptions["melSpectrogram"] == true ? computeMelSpectrogram(from: segmentData, sampleRate: sampleRate) : []
        let spectralContrast = featureOptions["spectralContrast"] == true ? computeSpectralContrast(from: segmentData, sampleRate: sampleRate) : []
        let tonnetz = featureOptions["tonnetz"] == true ? computeTonnetz(from: segmentData, sampleRate: sampleRate) : []
        let pitch = featureOptions["pitch"] == true ? estimatePitch(from: segmentData, sampleRate: sampleRate) : 0

        // Calculate min and max amplitudes from the segment data
        let minAmplitude = segmentData.map(abs).min() ?? 0
        let maxAmplitude = segmentData.map(abs).max() ?? 0

        let crc32Value = featureOptions["crc32"] == true ?
            calculateCRC32(from: segmentData, count: segmentData.count) : nil

        return Features(
            energy: energy,
            mfcc: mfcc,
            rms: rms,
            minAmplitude: minAmplitude,
            maxAmplitude: maxAmplitude,
            zcr: zcr,
            spectralCentroid: spectralCentroid,
            spectralFlatness: spectralFlatness,
            spectralRolloff: spectralRolloff,
            spectralBandwidth: spectralBandwidth,
            chromagram: chromagram,
            tempo: tempo,
            hnr: hnr,
            melSpectrogram: melSpectrogram,
            spectralContrast: spectralContrast,
            tonnetz: tonnetz,
            pitch: pitch,
            crc32: crc32Value
        )
    }

    /// Processes audio data with time range support
    public func processAudioData(
        startTimeMs: Double? = nil,
        endTimeMs: Double? = nil,
        segmentDurationMs: Int = 100, // Default 100ms
        featureOptions: [String: Bool]
    ) -> AudioAnalysisData? {
        guard let audioFile = audioFile else {
            Logger.debug("AudioProcessor", "No audio file loaded")
            return nil
        }

        let startTime = CACurrentMediaTime()
        let sampleRate = Float(audioFile.fileFormat.sampleRate)
        let _ = AVAudioFrameCount(audioFile.length) // Changed from totalFrameCount
        let bitDepth = audioFile.fileFormat.settings[AVLinearPCMBitDepthKey] as? Int ?? 16
        let numberOfChannels = Int(audioFile.fileFormat.channelCount)

        // Convert time to frames
        let startFrame = startTimeMs.map { AVAudioFramePosition(Double($0) * Double(sampleRate) / 1000.0) } ?? 0
        let endFrame = endTimeMs.map { AVAudioFramePosition(Double($0) * Double(sampleRate) / 1000.0) } ?? audioFile.length

        // Validate frame range
        guard startFrame >= 0 && endFrame <= audioFile.length && startFrame < endFrame else {
            Logger.debug("AudioProcessor", "Invalid time range")
            return nil
        }

        // Calculate frames per buffer based on segment duration
        // Clamp before narrowing, as above.
        let rawFramesPerBuffer = (Double(sampleRate) * Double(segmentDurationMs) / 1000.0)
            .rounded(.towardZero)
        let framesPerBuffer = AVAudioFrameCount(
            min(max(rawFramesPerBuffer, 1), Double(AVAudioFrameCount.max))
        )

        guard let buffer = AVAudioPCMBuffer(pcmFormat: audioFile.processingFormat, frameCapacity: framesPerBuffer) else {
            Logger.debug("AudioProcessor", "Failed to create buffer")
            return nil
        }

        var dataPoints: [DataPoint] = []
        var minAmplitude: Float = .greatestFiniteMagnitude
        var maxAmplitude: Float = -.greatestFiniteMagnitude
        var currentId = 0

        audioFile.framePosition = startFrame
        var currentFrame = startFrame

        while currentFrame < endFrame {
            let framesToRead = min(framesPerBuffer, AVAudioFrameCount(endFrame - currentFrame))

            do {
                try audioFile.read(into: buffer, frameCount: framesToRead)

                guard let channelData = buffer.floatChannelData else {
                    continue
                }

                // Process each channel's data
                var summedData = [Float](repeating: 0, count: Int(framesToRead))
                for channel in 0..<numberOfChannels {
                    let channelBuffer = UnsafeBufferPointer(start: channelData[channel], count: Int(framesToRead))
                    for (index, sample) in channelBuffer.enumerated() {
                        summedData[index] += sample
                    }
                }

                // Average across channels
                for i in 0..<summedData.count {
                    summedData[i] /= Float(numberOfChannels)
                }

                // Calculate both peak amplitude and RMS
                var localMax: Float = 0
                var rms: Float = 0
                vDSP_maxmgv(summedData, 1, &localMax, vDSP_Length(framesToRead))

                // Calculate RMS using vDSP
                var meanSquare: Float = 0
                vDSP_measqv(summedData, 1, &meanSquare, vDSP_Length(framesToRead))
                rms = sqrt(meanSquare)

                minAmplitude = min(minAmplitude, localMax)
                maxAmplitude = max(maxAmplitude, localMax)

                // Create data point
                let startTime = Float(currentFrame) / Float(sampleRate)
                let endTime = Float(currentFrame + Int64(framesToRead)) / Float(sampleRate)

                let dataPoint = DataPoint(
                    id: currentId,
                    amplitude: localMax,      // Always use peak amplitude
                    rms: rms,                // Use calculated RMS value
                    dB: Float(20 * log10(Double(rms))),  // Use RMS for dB calculation
                    silent: rms < SILENCE_THRESHOLD_RMS,      // Use RMS for silence detection
                    features: computeFeatures(
                        segmentData: Array(summedData[0..<Int(framesToRead)]), // Fixed dangling pointer
                        sampleRate: sampleRate,
                        sumSquares: rms * rms,
                        zeroCrossings: 0,
                        segmentLength: Int(framesToRead),
                        featureOptions: featureOptions
                    ),
                    speech: SpeechFeatures(isActive: rms >= SILENCE_THRESHOLD_RMS),
                    startTime: startTime,
                    endTime: endTime,
                    startPosition: Int(currentFrame),
                    endPosition: Int(currentFrame + Int64(framesToRead)),
                    samples: Int(framesToRead)
                )

                dataPoints.append(dataPoint)
                currentId += 1
            } catch {
                Logger.debug("AudioProcessor", "Error reading audio data: \(error)")
                return nil
            }

            currentFrame += Int64(framesToRead)
        }

        let endTime = CACurrentMediaTime()
        let extractionTime = Float(endTime - startTime) * 1000 // Convert to milliseconds

        return AudioAnalysisData(
            segmentDurationMs: segmentDurationMs,
            durationMs: Int(Float(endFrame - startFrame) * 1000 / sampleRate),
            bitDepth: bitDepth,
            numberOfChannels: numberOfChannels,
            sampleRate: Int(sampleRate),
            samples: Int(endFrame - startFrame),
            dataPoints: dataPoints,
            amplitudeRange: AudioAnalysisData.AmplitudeRange(
                min: minAmplitude,
                max: maxAmplitude
            ),
            rmsRange: AudioAnalysisData.AmplitudeRange(
                min: 0,
                max: 1
            ),
            speechAnalysis: nil,
            extractionTimeMs: extractionTime
        )
    }

    /// Trims audio file to specified range
    public func trimAudio(
        mode: String,
        startTimeMs: Double?,
        endTimeMs: Double?,
        ranges: [[String: Double]]?,
        outputFileName: String?,
        outputFormat: [String: Any]?,
        decodingOptions: [String: Any]?,
        progressCallback: ((Float, Int64, Int64) -> Void)? = nil
    ) -> TrimResult? {
        // Log the input parameters
        Logger.debug("AudioProcessor", "Starting audio trim operation:")
        Logger.debug("AudioProcessor", "- Mode: \(mode)")
        if let start = startTimeMs, let end = endTimeMs {
            Logger.debug("AudioProcessor", "- Time range: \(start)ms to \(end)ms")
        }
        if let ranges = ranges {
            Logger.debug("AudioProcessor", "- Ranges count: \(ranges.count)")
        }

        // Log output format details
        if let format = outputFormat {
            let formatType = format["format"] as? String ?? "unknown"
            let bitrate = bridgedInt(format, "bitrate") ?? 0
            Logger.debug("AudioProcessor", "- Output format: \(formatType), bitrate: \(bitrate)")
        }

        guard let audioFile = audioFile else { return nil }

        let inputFormat = audioFile.processingFormat
        let inputSampleRate = inputFormat.sampleRate
        let inputChannels = Int(inputFormat.channelCount)
        let totalDurationMs = Double(audioFile.length) / inputSampleRate * 1000

        // Compute ranges to keep
        let keepRanges = computeKeepRanges(
            mode: mode,
            startTimeMs: startTimeMs,
            endTimeMs: endTimeMs,
            ranges: ranges,
            totalDurationMs: totalDurationMs
        )

        guard !keepRanges.isEmpty else { return nil }

        // Output format setup
        let requestedFormat = outputFormat?["format"] as? String ?? "wav"
        let validFormats = ["wav", "aac"]
        let formatStr = validFormats.contains(requestedFormat.lowercased()) ? requestedFormat.lowercased() : "aac"

        if formatStr != requestedFormat.lowercased() {
            Logger.debug("AudioProcessor", "Unsupported format '\(requestedFormat)', falling back to 'aac'")
        }

        // No invented ceiling here. Whether a rate is usable depends on the source/target
        // pair and on the OS — 1Hz returns a nil converter from a 44.1kHz source while 2MHz
        // succeeds — so a static range would reject what works and admit what does not.
        // Representability is already guaranteed by bridgedFiniteDouble, the positivity
        // check below is this code's own — AVAudioFormat will happily describe 0Hz and
        // negative rates, so it is not the gate it looks like — and the converter answers
        // the rest at the point of use (#433).
        let requestedOutputRate = outputFormat.flatMap { bridgedFiniteDouble($0, "sampleRate") }
        if let requested = requestedOutputRate, requested <= 0 {
            Logger.debug(
                "AudioProcessor",
                "Ignoring non-positive output sampleRate \(requested); using the input rate"
            )
        }
        let targetSampleRate: Double = {
            if let requested = requestedOutputRate, requested > 0 { return requested }
            return inputSampleRate
        }()
        let targetChannels = outputFormat.flatMap { bridgedInt($0, "channels", in: 1...2) } ?? inputChannels
        // The file's real depth, unclamped. Clamping before the comparison below made a
        // 24-bit input look like 16, so an explicit bitDepth: 16 request compared equal,
        // took the fast path, kept 24 bits and reported 16 (#451).
        let inputBitDepth = Int(audioFile.fileFormat.streamDescription.pointee.mBitsPerChannel)
        // What a WAV writer here can actually emit. Probed against AVAudioFile: 8, 16, 24
        // and 32 each round-trip at the requested depth, so an omitted request preserves
        // any of them rather than silently forcing 16 during a rate or channel change.
        // The earlier [16, 32] allowlist downconverted 8- and 24-bit sources nobody asked
        // to convert, contradicting the documented preserve-input contract (#451).
        // Resolved by TrimFormatResolution so the rule is covered by tests: this file
        // cannot join the SwiftPM test target, and every bit-depth bug in #451 lived here.
        let targetBitDepth = TrimFormatResolution.targetBitDepth(
            requested: outputFormat.flatMap { bridgedInt($0, "bitDepth") },
            inputBitDepth: inputBitDepth
        )
        let requestedBitrate = outputFormat.flatMap { bridgedInt($0, "bitrate").flatMap { $0 > 0 ? $0 : nil } }
        let bitrate = requestedBitrate ?? 128000

        let fileExtension = formatStr == "wav" ? "wav" : "aac"
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(outputFileName ?? UUID().uuidString)
            .appendingPathExtension(fileExtension)

        // Write to a private work file and promote it only on success. The destination is
        // caller-supplied, and AVAudioFile truncates it the moment the writer opens — a
        // 14-byte file became a 4096-byte WAV header before a later failure — so writing
        // there directly destroys the caller's data before anything can go wrong. Deciding
        // afterwards whether to delete cannot undo that, and fileExists is not ownership
        // anyway: it is false for a dangling symlink, and two concurrent calls with the
        // same name would both claim it (#433).
        let workURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("trim-\(UUID().uuidString)")
            .appendingPathExtension(fileExtension)

        /// Moves the finished work file onto the requested destination.
        func promoteWorkFile() throws {
            try OutputPromotion.promote(workURL: workURL, to: outputURL)
        }

        let decodingConfig = DecodingConfig.fromDictionary(decodingOptions ?? [:])
        // Compare what was actually resolved, not just decodingOptions. outputFormat is a
        // separate parameter, so a sampleRate or channel change requested there took the
        // WAV fast path and was silently ignored (#433).
        // Includes bitDepth, compared against the file's real depth: a bitDepth-only
        // request used to take the fast path and be ignored outright (#451).
        let outputDiffersFromInput = TrimFormatResolution.outputDiffersFromInput(
            targetSampleRate: targetSampleRate, inputSampleRate: inputSampleRate,
            targetChannels: targetChannels, inputChannels: inputChannels,
            targetBitDepth: targetBitDepth, inputBitDepth: inputBitDepth
        )
        let needFormatChange = decodingConfig.targetSampleRate != nil
            || decodingConfig.targetChannels != nil
            || decodingConfig.targetBitDepth != nil
            || outputDiffersFromInput
        let isWavInput = audioFile.fileFormat.settings[AVFormatIDKey] as? UInt32 == kAudioFormatLinearPCM

        do {
            if isWavInput && formatStr == "wav" && !needFormatChange {
                // Fast path: WAV-to-WAV with no format changes
                // Scoped so the writer is released before the result reads the file back.
                // AVAudioFile reports length 0 for a file whose writer is still alive, so
                // reopening too early reported durationMs: 0 for a successful trim (#433).
                try autoreleasepool {
                // fileFormat.settings, not inputFormat (== processingFormat) .settings.
                // processingFormat is float32 for every PCM WAV, so writing its settings
                // turned a 16-bit source into a 32-bit float file while the result below
                // still reported 16 — the fast path was the one place claiming to preserve
                // the input and the one place not doing it (#451).
                let outputFile = try AVAudioFile(forWriting: workURL, settings: audioFile.fileFormat.settings)
                var totalFrames: Int64 = 0
                for range in keepRanges {
                    // Break down complex expression
                    let startTimeInSeconds = range[0] / 1000
                    let endTimeInSeconds = range[1] / 1000
                    let startFramePosition = startTimeInSeconds * inputSampleRate
                    let endFramePosition = endTimeInSeconds * inputSampleRate
                    totalFrames += Int64(endFramePosition - startFramePosition)
                }
                var cumulativeFrames: Int64 = 0

                for range in keepRanges {
                    // Break down complex expressions
                    let startTimeInSeconds = range[0] / 1000
                    let startFrame = AVAudioFramePosition(startTimeInSeconds * inputSampleRate)

                    let endTimeInSeconds = range[1] / 1000
                    let endFramePosition = endTimeInSeconds * inputSampleRate
                    let frameCount = AVAudioFrameCount(endFramePosition - Double(startFrame))

                    let buffer = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: frameCount)!
                    audioFile.framePosition = startFrame
                    try audioFile.read(into: buffer, frameCount: frameCount)
                    try outputFile.write(from: buffer)
                    cumulativeFrames += Int64(frameCount)
                    let progress = Float(cumulativeFrames) / Float(totalFrames) * 100
                    progressCallback?(progress, Int64(frameCount) * Int64(inputFormat.streamDescription.pointee.mBytesPerFrame), totalFrames * Int64(inputFormat.streamDescription.pointee.mBytesPerFrame))
                }

                // When creating the output file
                Logger.debug("AudioProcessor", "Creating output file at: \(workURL.path)")

                // After processing is complete
                Logger.debug("AudioProcessor", "Trim operation completed")
                Logger.debug("AudioProcessor", "- Output file: \(workURL.path)")
                Logger.debug("AudioProcessor", "- File exists: \(FileManager.default.fileExists(atPath: workURL.path))")
                Logger.debug("AudioProcessor", "- File size: \((try? FileManager.default.attributesOfItem(atPath: workURL.path)[.size] as? Int64) ?? 0) bytes")
                Logger.debug("AudioProcessor", "- File extension: \(workURL.pathExtension)")
                }

                try promoteWorkFile()
                // Reached only when targetBitDepth == inputBitDepth, so the file's real
                // depth is also the requested one.
                return createTrimResult(from: outputURL, keepRanges: keepRanges, formatStr: formatStr, sampleRate: Int(inputSampleRate), channels: inputChannels, bitDepth: inputBitDepth, bitrate: bitrate)
            } else {
                // Non-fast path: Decode and re-encode
                let targetFormat = AVAudioFormat(
                    commonFormat: .pcmFormatFloat32,
                    sampleRate: targetSampleRate,
                    channels: AVAudioChannelCount(targetChannels),
                    interleaved: false
                )!

                var totalFrames: Int64 = 0
                for range in keepRanges {
                    // Break down complex expression
                    let startTimeInSeconds = range[0] / 1000
                    let endTimeInSeconds = range[1] / 1000
                    let startFramePosition = startTimeInSeconds * inputSampleRate
                    let endFramePosition = endTimeInSeconds * inputSampleRate
                    totalFrames += Int64(endFramePosition - startFramePosition)
                }
                var cumulativeFrames: Int64 = 0

                if formatStr == "wav" {
                    // Outside the autoreleasepool: the empty-output guard reads it after
                    // the closure returns.
                    var wavWrittenFrames: Int64 = 0

                    // Scoped for the same reason as the fast path above.
                    try autoreleasepool {
                    let outputFile = try AVAudioFile(forWriting: workURL, settings: [
                        AVFormatIDKey: kAudioFormatLinearPCM,
                        AVSampleRateKey: targetSampleRate,
                        AVNumberOfChannelsKey: targetChannels,
                        AVLinearPCMBitDepthKey: targetBitDepth,
                        AVLinearPCMIsFloatKey: false,
                        AVLinearPCMIsBigEndianKey: false
                    ])

                    // Convert to what the writer resolved, not what was asked for. A WAV
                    // writer clamps a rate it will not serve — 384kHz becomes 192kHz — so
                    // converting to the request and writing into the clamped file produced
                    // twice the audio (#433).
                    let writerFormat = outputFile.processingFormat

                    // Ask about the requested format before deferring to the writer's.
                    // The writer resolves an unsupported rate to one it likes — 1Hz becomes
                    // 8kHz — and that resolved conversion succeeds, so checking only the
                    // writer's format would silently produce 8kHz audio for a request the
                    // platform cannot serve (#433).
                    guard AVAudioConverter(from: inputFormat, to: targetFormat) != nil else {
                        throw NSError(
                            domain: "AudioProcessor",
                            code: -1,
                            userInfo: [NSLocalizedDescriptionKey:
                                "Cannot convert to \(targetFormat.sampleRate)Hz "
                                + "from this file's \(inputFormat.sampleRate)Hz"]
                        )
                    }

                    if writerFormat.sampleRate != targetFormat.sampleRate {
                        Logger.debug(
                            "AudioProcessor",
                            "Writer resolved \(targetFormat.sampleRate)Hz to "
                            + "\(writerFormat.sampleRate)Hz; converting to that instead"
                        )
                    }

                    for range in keepRanges {
                        // Break down complex expressions
                        let startTimeInSeconds = range[0] / 1000
                        let startFrame = AVAudioFramePosition(startTimeInSeconds * inputSampleRate)

                        let endTimeInSeconds = range[1] / 1000
                        let endFramePosition = endTimeInSeconds * inputSampleRate
                        let frameCount = AVAudioFrameCount(endFramePosition - Double(startFrame))

                        // Throw rather than continue: skipping a range would return a
                        // successful result missing the audio the caller asked to keep.
                        guard let buffer = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: frameCount) else {
                            throw NSError(
                                domain: "AudioProcessor",
                                code: -1,
                                userInfo: [NSLocalizedDescriptionKey:
                                    "Could not allocate a \(frameCount)-frame input buffer"]
                            )
                        }
                        audioFile.framePosition = startFrame
                        try audioFile.read(into: buffer, frameCount: frameCount)
                        // Fallible: whether a conversion is supported depends on the
                        // source/target pair, not on the target rate alone. 1Hz returns nil
                        // from a 44.1kHz source while 2MHz succeeds, and the answer differs
                        // between OS versions — so no static range can stand in for asking
                        // (#433).
                        guard let converter = AVAudioConverter(from: inputFormat, to: writerFormat) else {
                            Logger.debug(
                                "AudioProcessor",
                                "Cannot convert \(inputFormat.sampleRate)Hz to \(targetFormat.sampleRate)Hz"
                            )
                            throw NSError(
                                domain: "AudioProcessor",
                                code: -1,
                                userInfo: [NSLocalizedDescriptionKey:
                                    "Cannot convert to \(writerFormat.sampleRate)Hz "
                                    + "from this file's \(inputFormat.sampleRate)Hz"]
                            )
                        }
                        // Mix the channels rather than taking the first. The default
                        // discards the others, so right-only stereo material came back as
                        // silence once a channel-only request started routing through here.
                        if writerFormat.channelCount < inputFormat.channelCount {
                            converter.downmix = true
                        }
                        // Size the output by the rate ratio. A source-sized buffer truncated
                        // every upsample — one second at 44.1kHz came back as 0.5s at 88.2kHz
                        // and 0.23s at 384kHz — because the converter can only write what
                        // the buffer holds (#433).
                        let ratio = writerFormat.sampleRate / inputFormat.sampleRate
                        let scaled = (Double(frameCount) * ratio).rounded(.up)
                        // Throw rather than clamp: a capacity above the maximum means the
                        // request cannot be served, and clamping would silently truncate
                        // exactly the way this sizing exists to prevent.
                        guard scaled <= Double(AVAudioFrameCount.max) else {
                            throw NSError(
                                domain: "AudioProcessor",
                                code: -1,
                                userInfo: [NSLocalizedDescriptionKey:
                                    "Converting \(frameCount) frames to "
                                    + "\(writerFormat.sampleRate)Hz needs \(scaled) frames, "
                                    + "more than one buffer can hold"]
                            )
                        }
                        let outputFrameCapacity = AVAudioFrameCount(max(scaled, 1))
                        guard let convertedBuffer = AVAudioPCMBuffer(pcmFormat: writerFormat, frameCapacity: outputFrameCapacity) else {
                            throw NSError(
                                domain: "AudioProcessor",
                                code: -1,
                                userInfo: [NSLocalizedDescriptionKey:
                                    "Could not allocate a \(outputFrameCapacity)-frame output buffer"]
                            )
                        }
                        let produced = try AudioProcessor.convertOneBuffer(
                            converter, from: buffer, into: convertedBuffer
                        )

                        cumulativeFrames += Int64(frameCount)
                        let progress = Float(cumulativeFrames) / Float(totalFrames) * 100
                        progressCallback?(progress, 0, totalFrames * Int64(inputFormat.streamDescription.pointee.mBytesPerFrame))

                        guard produced > 0 else { continue }
                        try outputFile.write(from: convertedBuffer)
                        wavWrittenFrames += Int64(produced)
                    }
                    }

                    // Same guard as the AAC path: promoting here would hand back a file
                    // with no audio and a duration derived from the requested ranges.
                    guard wavWrittenFrames > 0 else {
                        throw NSError(
                            domain: "AudioProcessor",
                            code: -1,
                            userInfo: [NSLocalizedDescriptionKey:
                                "Trimming produced no audio: converting "
                                + "\(Int(inputSampleRate))Hz to \(Int(targetSampleRate))Hz "
                                + "yielded no output frames for the requested ranges"]
                        )
                    }

                    try promoteWorkFile()
                    return createTrimResult(from: outputURL, keepRanges: keepRanges, formatStr: formatStr, sampleRate: Int(targetSampleRate), channels: targetChannels, bitDepth: targetBitDepth, bitrate: bitrate)
                } else {
                    // Use AAC instead of Opus (Opus support removed)
                    Logger.debug("AudioProcessor", "Using AAC format instead of requested \(formatStr)")

                    // Keep the existing AAC settings structure for consistency
                    let outputSettings: [String: Any] = [
                        AVFormatIDKey: kAudioFormatMPEG4AAC,
                        AVSampleRateKey: targetSampleRate,
                        AVNumberOfChannelsKey: targetChannels,
                        AVEncoderBitRateKey: bitrate,
                        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
                    ]
                    let _ = AVFileType.m4a // Changed from fileType

                    // 4. Update container extension logic for when Opus was selected
                    let _ = "m4a" // Changed from tempFileExtension

                    // 5. Update the MIME type logic for AAC only
                    let _ = "audio/mp4" // Changed from mimeType

                    // Outside the autoreleasepool below: the empty-output guard that reads
                    // this runs after the closure returns.
                    var writtenFrames: Int64 = 0

                    try autoreleasepool {
                    // Ask about the requested rate before deferring to whatever the writer
                    // resolves. An AAC writer turns an unsupported rate into one it likes —
                    // 1Hz becomes 8kHz — and that resolved conversion succeeds, so checking
                    // only the writer's format would silently produce 8kHz for a request the
                    // platform cannot serve (#451, same shape as the WAV path).
                    guard let requestedFormat = AVAudioFormat(
                        commonFormat: .pcmFormatFloat32,
                        sampleRate: targetSampleRate,
                        channels: AVAudioChannelCount(targetChannels),
                        interleaved: false
                    ), AVAudioConverter(from: inputFormat, to: requestedFormat) != nil else {
                        throw NSError(
                            domain: "AudioProcessor",
                            code: -1,
                            userInfo: [NSLocalizedDescriptionKey:
                                "Cannot convert to \(targetSampleRate)Hz "
                                + "from this file's \(inputFormat.sampleRate)Hz"]
                        )
                    }

                    // The encoder rejects bitrates its profile cannot serve at the target
                    // rate — measured: 96k+ at 22.05kHz mono fails with error 560226676,
                    // while omitting the key always succeeds. An explicit request that the
                    // encoder refuses is an error, since the result carries no effective
                    // bitrate and a debug log is not caller-visible. Only the library's own
                    // 128000 default gives way, and only then is the encoder default
                    // intentional.
                    let outputFile: AVAudioFile
                    do {
                        outputFile = try AVAudioFile(forWriting: workURL, settings: outputSettings)
                    } catch {
                        if requestedBitrate != nil {
                            throw NSError(
                                domain: "AudioProcessor",
                                code: -1,
                                userInfo: [NSLocalizedDescriptionKey:
                                    "The encoder cannot use \(bitrate)bps at "
                                    + "\(Int(targetSampleRate))Hz with \(targetChannels) channel(s)"]
                            )
                        }
                        var withoutBitrate = outputSettings
                        withoutBitrate.removeValue(forKey: AVEncoderBitRateKey)
                        Logger.debug(
                            "AudioProcessor",
                            "Default \(bitrate)bps unusable at \(targetSampleRate)Hz; using the encoder's"
                        )
                        outputFile = try AVAudioFile(forWriting: workURL, settings: withoutBitrate)
                    }

                    // Convert to the writer's own format. Writing an inputFormat buffer to a
                    // writer configured at another rate violates AVAudioFile's format-match
                    // contract and mis-times the output: probed at 44.1kHz source, one second
                    // came back as 2.0000s at 22.05kHz and 0.9187s at 48kHz (#451).
                    let writerFormat = outputFile.processingFormat

                    // The PCM check above proves a conversion exists; it does not prove the
                    // encoder will use the rate asked for. Probed: the AAC writer silently
                    // resolves 1Hz and 7999Hz to 8000Hz, and 384000Hz to 192000Hz. Returning
                    // that as success would hand back audio at a rate the caller never
                    // requested, so the substitution is refused here rather than reported.
                    guard writerFormat.sampleRate == targetSampleRate else {
                        throw NSError(
                            domain: "AudioProcessor",
                            code: -1,
                            userInfo: [NSLocalizedDescriptionKey:
                                "The AAC encoder cannot use \(Int(targetSampleRate))Hz; "
                                + "it resolved to \(Int(writerFormat.sampleRate))Hz"]
                        )
                    }
                    guard AVAudioConverter(from: inputFormat, to: writerFormat) != nil else {
                        throw NSError(
                            domain: "AudioProcessor",
                            code: -1,
                            userInfo: [NSLocalizedDescriptionKey:
                                "Cannot convert to \(writerFormat.sampleRate)Hz "
                                + "from this file's \(inputFormat.sampleRate)Hz"]
                        )
                    }

                    // Total input frames to process, computed up front so progress has a
                    // fixed denominator. It previously started at zero and grew as work
                    // completed, while cumulativeFrames was never incremented in this block
                    // at all — the progress fraction was a stale outer value over a moving
                    // total. Written frames are tracked separately below.
                    var totalFrames: Int64 = 0
                    for range in keepRanges {
                        let startFrame = AVAudioFramePosition(range[0] / 1000 * inputSampleRate)
                        let endFramePosition = range[1] / 1000 * inputSampleRate
                        totalFrames += Int64(AVAudioFrameCount(endFramePosition - Double(startFrame)))
                    }
                    var processedFrames: Int64 = 0

                    for range in keepRanges {
                        let startTimeInSeconds = range[0] / 1000
                        let startFrame = AVAudioFramePosition(startTimeInSeconds * inputSampleRate)

                        let endTimeInSeconds = range[1] / 1000
                        let endFramePosition = endTimeInSeconds * inputSampleRate
                        let frameCount = AVAudioFrameCount(endFramePosition - Double(startFrame))

                        guard let buffer = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: frameCount) else {
                            throw NSError(
                                domain: "AudioProcessor",
                                code: -1,
                                userInfo: [NSLocalizedDescriptionKey:
                                    "Could not allocate a \(frameCount)-frame input buffer"]
                            )
                        }
                        audioFile.framePosition = startFrame
                        try audioFile.read(into: buffer, frameCount: frameCount)

                        guard let converter = AVAudioConverter(from: inputFormat, to: writerFormat) else {
                            throw NSError(
                                domain: "AudioProcessor",
                                code: -1,
                                userInfo: [NSLocalizedDescriptionKey:
                                    "Cannot convert to \(writerFormat.sampleRate)Hz"]
                            )
                        }
                        if writerFormat.channelCount < inputFormat.channelCount {
                            converter.downmix = true
                        }

                        // Size by the rate ratio; a source-sized buffer truncates an upsample
                        // and gets overfilled on a downsample.
                        let ratio = writerFormat.sampleRate / inputFormat.sampleRate
                        let scaled = (Double(frameCount) * ratio).rounded(.up)
                        guard scaled <= Double(AVAudioFrameCount.max) else {
                            throw NSError(
                                domain: "AudioProcessor",
                                code: -1,
                                userInfo: [NSLocalizedDescriptionKey:
                                    "Converting \(frameCount) frames to \(writerFormat.sampleRate)Hz "
                                    + "needs \(scaled) frames, more than one buffer can hold"]
                            )
                        }
                        guard let converted = AVAudioPCMBuffer(
                            pcmFormat: writerFormat,
                            frameCapacity: AVAudioFrameCount(max(scaled, 1))
                        ) else {
                            throw NSError(
                                domain: "AudioProcessor",
                                code: -1,
                                userInfo: [NSLocalizedDescriptionKey: "Could not allocate an output buffer"]
                            )
                        }

                        let produced = try AudioProcessor.convertOneBuffer(
                            converter, from: buffer, into: converted
                        )

                        // Progress tracks input consumed, so it advances even for a range
                        // that produces no output.
                        processedFrames += Int64(frameCount)
                        let progress = totalFrames > 0
                            ? Float(processedFrames) / Float(totalFrames) * 100
                            : 100
                        progressCallback?(progress, 0, totalFrames * Int64(inputFormat.streamDescription.pointee.mBytesPerFrame))

                        // Skip empty output and count what was written, not what was
                        // read. See convertOneBuffer for why zero frames happen.
                        guard produced > 0 else { continue }

                        try outputFile.write(from: converted)
                        writtenFrames += Int64(produced)
                    }
                    }

                    // Nothing was written: every conversion produced zero frames. Promoting
                    // here would hand back a file with no audio and a duration derived from
                    // the requested ranges (#451).
                    guard writtenFrames > 0 else {
                        throw NSError(
                            domain: "AudioProcessor",
                            code: -1,
                            userInfo: [NSLocalizedDescriptionKey:
                                "Trimming produced no audio: converting "
                                + "\(Int(inputSampleRate))Hz to \(Int(targetSampleRate))Hz "
                                + "yielded no output frames for the requested ranges"]
                        )
                    }

                    try promoteWorkFile()
                    return createTrimResult(
                        from: outputURL,
                        keepRanges: keepRanges,
                        formatStr: formatStr,
                        sampleRate: Int(targetSampleRate),
                        channels: targetChannels,
                        bitDepth: targetBitDepth,
                        bitrate: bitrate,
                        compression: nil
                    )
                }
            }
        } catch {
            // Only ever the work file: the destination has not been touched, so a failure
            // leaves whatever was there intact.
            try? FileManager.default.removeItem(at: workURL)
            reject("TRIM_ERROR", "Failed to trim audio: \(error.localizedDescription)")
            return nil
        }
    }

    /// Clamps a range to the file, so the frame conversions downstream cannot overflow.
    ///
    /// The bridged values are only checked for Int representability, and every caller then
    /// multiplies them by a sample rate; the product need not fit (#433). Bounding here
    /// covers all three modes and every conversion that reads these ranges, rather than
    /// guarding each site. A range entirely past the end collapses to empty and is dropped.
    private func clampRange(_ range: [Double], totalDurationMs: Double) -> [Double] {
        let start = min(max(0, range[0]), totalDurationMs)
        let end = min(max(start, range[1]), totalDurationMs)
        return [start, end]
    }


    /// Converts one buffer and reports how many frames came out.
    ///
    /// Shared by the WAV and AAC re-encode loops. They previously carried their own copies
    /// of this and had already drifted: only one checked the converter status, and only one
    /// refused zero-frame output (#451).
    ///
    /// A downsampling converter given very few input frames returns `.endOfStream` with no
    /// error and zero output frames — 44.1kHz to 8kHz produces nothing for inputs of 1 to 4
    /// frames. Writing that buffer adds no audio while its input frames still count toward
    /// the reported duration, so the result describes audio the file does not contain.
    private static func convertOneBuffer(
        _ converter: AVAudioConverter,
        from buffer: AVAudioPCMBuffer,
        into converted: AVAudioPCMBuffer
    ) throws -> AVAudioFrameCount {
        // Supply the input once, then report end of stream. Returning the same buffer with
        // .haveData forever made the converter re-consume it, so a downsample emitted more
        // audio than it was given.
        var suppliedInput = false
        var conversionError: NSError?
        let status = converter.convert(to: converted, error: &conversionError) { _, outStatus in
            if suppliedInput {
                outStatus.pointee = .endOfStream
                return nil
            }
            suppliedInput = true
            outStatus.pointee = .haveData
            return buffer
        }
        if let conversionError = conversionError {
            throw NSError(
                domain: "AudioProcessor",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey:
                    "Format conversion failed: \(conversionError.localizedDescription)"]
            )
        }
        if status == .error {
            // .error with no NSError set. Continuing would write an unpopulated buffer and
            // report success.
            throw NSError(
                domain: "AudioProcessor",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Format conversion failed."]
            )
        }
        return converted.frameLength
    }

    private func computeKeepRanges(mode: String, startTimeMs: Double?, endTimeMs: Double?, ranges: [[String: Double]]?, totalDurationMs: Double) -> [[Double]] {
        let clamped = computeRawKeepRanges(
            mode: mode,
            startTimeMs: startTimeMs,
            endTimeMs: endTimeMs,
            ranges: ranges,
            totalDurationMs: totalDurationMs
        ).map { clampRange($0, totalDurationMs: totalDurationMs) }
        return clamped.filter { $0[1] > $0[0] }
    }

    private func computeRawKeepRanges(mode: String, startTimeMs: Double?, endTimeMs: Double?, ranges: [[String: Double]]?, totalDurationMs: Double) -> [[Double]] {
        switch mode {
        case "single":
            guard let start = startTimeMs, let end = endTimeMs else { return [] }
            return [[start, end]]
        case "keep":
            return ranges?.map { [$0["startTimeMs"] ?? 0, $0["endTimeMs"] ?? totalDurationMs] } ?? []
        case "remove":
            let removeRanges = ranges?.map { [$0["startTimeMs"] ?? 0, $0["endTimeMs"] ?? totalDurationMs] }.sorted { $0[0] < $1[0] } ?? []
            var keepRanges: [[Double]] = []
            var lastEnd = 0.0
            for range in removeRanges {
                if range[0] > lastEnd {
                    keepRanges.append([lastEnd, range[0]])
                }
                lastEnd = max(lastEnd, range[1])
            }
            if lastEnd < totalDurationMs {
                keepRanges.append([lastEnd, totalDurationMs])
            }
            return keepRanges
        default:
            return []
        }
    }

    private func createTrimResult(from url: URL, keepRanges: [[Double]], formatStr: String, sampleRate: Int, channels: Int, bitDepth: Int, bitrate: Int, compression: [String: Any]? = nil) -> TrimResult {
        let requestedDurationMs = keepRanges.map { $0[1] - $0[0] }.reduce(0, +)
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64 ?? 0) ?? 0
        let fileExtension = formatStr == "wav" ? "wav" : "aac"

        // Describe the file that was written, not the settings that were asked for.
        // AVAudioFile can clamp a rate the writer will not accept, and reporting the
        // request then claims properties the file does not have (#433).
        let written = try? AVAudioFile(forReading: url)
        let actualSampleRate = written.map { Int($0.fileFormat.sampleRate) } ?? sampleRate
        let actualChannels = written.map { Int($0.fileFormat.channelCount) } ?? channels
        let durationMs = written.map { Double($0.length) / $0.fileFormat.sampleRate * 1000.0 }
            ?? requestedDurationMs

        if let written = written, Int(written.fileFormat.sampleRate) != sampleRate {
            Logger.debug(
                "AudioProcessor",
                "Requested \(sampleRate)Hz but the file was written at "
                + "\(Int(written.fileFormat.sampleRate))Hz; reporting the file"
            )
        }

        return TrimResult(
            uri: url.absoluteString,
            filename: url.lastPathComponent,
            durationMs: durationMs,
            size: size,
            sampleRate: actualSampleRate,
            channels: actualChannels,
            bitDepth: bitDepth,
            mimeType: "audio/\(fileExtension)",
            requestedFormat: formatStr,
            actualFormat: fileExtension,
            compression: compression
        )
    }

    private func createSampleBuffer(from buffer: AVAudioPCMBuffer) -> CMSampleBuffer? {
        var formatDesc: CMAudioFormatDescription?
        CMAudioFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            asbd: buffer.format.streamDescription,
            layoutSize: 0,
            layout: nil,
            magicCookieSize: 0,
            magicCookie: nil,
            extensions: nil,
            formatDescriptionOut: &formatDesc
        )
        guard let format = formatDesc else { return nil }

        var sampleBuffer: CMSampleBuffer?
        var timingInfo = CMSampleTimingInfo(
            duration: CMTime(value: 1, timescale: CMTimeScale(buffer.format.sampleRate)),
            presentationTimeStamp: .zero,
            decodeTimeStamp: .invalid
        )

        CMSampleBufferCreate(
            allocator: kCFAllocatorDefault,
            dataBuffer: nil,
            dataReady: false,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: format,
            sampleCount: CMItemCount(buffer.frameLength),
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timingInfo,
            sampleSizeEntryCount: 0,
            sampleSizeArray: nil,
            sampleBufferOut: &sampleBuffer
        )
        guard let sampleBuf = sampleBuffer else { return nil }

        var dataBuffer: CMBlockBuffer?
        CMBlockBufferCreateWithMemoryBlock(
            allocator: kCFAllocatorDefault,
            memoryBlock: UnsafeMutableRawPointer(buffer.floatChannelData![0]),
            blockLength: Int(buffer.frameLength * buffer.format.streamDescription.pointee.mBytesPerFrame),
            blockAllocator: kCFAllocatorNull,
            customBlockSource: nil,
            offsetToData: 0,
            dataLength: Int(buffer.frameLength * buffer.format.streamDescription.pointee.mBytesPerFrame),
            flags: 0,
            blockBufferOut: &dataBuffer
        )
        guard let blockBuf = dataBuffer else { return nil }

        CMSampleBufferSetDataBuffer(sampleBuf, newValue: blockBuf)

        return sampleBuf
    }

    /// Extracts a preview of the audio data with consistent time range support
    /// - Parameters:
    ///   - numberOfPoints: The number of points to extract
    ///   - startTimeMs: Optional start time in milliseconds
    ///   - endTimeMs: Optional end time in milliseconds
    ///   - featureOptions: The features to extract
    /// - Returns: An `AudioAnalysisData` object containing the extracted features
    public func extractPreviewBars(
        numberOfBars: Int,
        startTimeMs: Double? = nil,
        endTimeMs: Double? = nil,
        silenceRmsThreshold: Float = 0.01
    ) -> [String: Any]? {
        guard let audioFile = audioFile else {
            reject("FILE_NOT_INITIALIZED", "Audio file is not initialized.")
            return nil
        }

        let requestedBars = max(1, numberOfBars)
        let sampleRate = audioFile.fileFormat.sampleRate
        let totalDurationMs = Double(audioFile.length) / sampleRate * 1000
        // Bound the start by the file as well as by zero. endTimeMs is already capped at
        // totalDurationMs, but startTimeMs was not, so a large value overflowed the
        // narrowing below rather than being treated as past the end (#433).
        let effectiveStartMs = min(max(0, startTimeMs ?? 0), totalDurationMs)
        let effectiveEndMs = min(endTimeMs ?? totalDurationMs, totalDurationMs)
        let durationMs = max(1, effectiveEndMs - effectiveStartMs)
        let startFrame = AVAudioFramePosition(
            BridgedNarrowing.sampleCount(
                milliseconds: effectiveStartMs,
                sampleRate: sampleRate,
                minimum: 0
            )
        )
        let endFrame = AVAudioFramePosition(
            BridgedNarrowing.sampleCount(
                milliseconds: effectiveEndMs,
                sampleRate: sampleRate,
                minimum: 0
            )
        )
        let samplesInRange = Int(endFrame - startFrame)

        guard samplesInRange > 0 else {
            reject("INVALID_RANGE", "Invalid sample range: contains no samples")
            return nil
        }

        let framesPerBar = max(1, samplesInRange / requestedBars)
        let startTime = CACurrentMediaTime()
        var bars: [[String: Any]] = []
        bars.reserveCapacity(requestedBars)
        var minAmplitude: Float = .greatestFiniteMagnitude
        var maxAmplitude: Float = -.greatestFiniteMagnitude
        var minRms: Float = .greatestFiniteMagnitude
        var maxRms: Float = -.greatestFiniteMagnitude

        for index in 0..<requestedBars {
            let barStartFrame = startFrame + AVAudioFramePosition(index * framesPerBar)
            let barEndFrame = min(startFrame + AVAudioFramePosition((index + 1) * framesPerBar), endFrame)
            let framesToRead = AVAudioFrameCount(barEndFrame - barStartFrame)
            if framesToRead == 0 { break }

            do {
                audioFile.framePosition = barStartFrame
                guard let buffer = AVAudioPCMBuffer(pcmFormat: audioFile.processingFormat, frameCapacity: framesToRead) else { continue }
                try audioFile.read(into: buffer, frameCount: framesToRead)
                guard let floatData = buffer.floatChannelData else { continue }

                var sumSquares: Float = 0
                var amplitude: Float = 0
                for frame in 0..<Int(buffer.frameLength) {
                    let value = floatData[0][frame]
                    sumSquares += value * value
                    amplitude = max(amplitude, abs(value))
                }
                let frameLength = max(1, Int(buffer.frameLength))
                let rms = sqrt(sumSquares / Float(frameLength))
                minAmplitude = min(minAmplitude, amplitude)
                maxAmplitude = max(maxAmplitude, amplitude)
                minRms = min(minRms, rms)
                maxRms = max(maxRms, rms)

                let startBarTimeMs = Double(barStartFrame - startFrame) / Double(samplesInRange) * durationMs
                let endBarTimeMs = Double(barEndFrame - startFrame) / Double(samplesInRange) * durationMs
                bars.append([
                    "id": index,
                    "amplitude": min(max(amplitude, 0), 1),
                    "rms": min(max(rms, 0), 1),
                    "silent": rms < silenceRmsThreshold,
                    "startTimeMs": startBarTimeMs,
                    "endTimeMs": max(startBarTimeMs, endBarTimeMs)
                ])
            } catch {
                reject("AUDIO_READ_ERROR", "Error reading audio data: \(error.localizedDescription)")
                return nil
            }
        }

        guard !bars.isEmpty else {
            reject("PROCESSING_ERROR", "No preview bars were generated")
            return nil
        }

        let bitDepth = audioFile.fileFormat.settings[AVLinearPCMBitDepthKey] as? Int ?? 16
        let extractionTimeMs = Float((CACurrentMediaTime() - startTime) * 1000)
        return [
            "bars": bars,
            "durationMs": durationMs,
            "sampleRate": Int(sampleRate),
            "numberOfChannels": Int(audioFile.processingFormat.channelCount),
            "bitDepth": bitDepth,
            "samples": samplesInRange,
            "requestedNumberOfBars": requestedBars,
            "barDurationMs": durationMs / Double(bars.count),
            "amplitudeRange": ["min": minAmplitude, "max": maxAmplitude],
            "rmsRange": ["min": minRms, "max": maxRms],
            "extractionTimeMs": extractionTimeMs
        ]
    }

    public func extractPreview(
        numberOfPoints: Int,
        startTimeMs: Double? = nil,
        endTimeMs: Double? = nil,
        featureOptions: [String: Bool]
    ) -> AudioAnalysisData? {
        guard let audioFile = audioFile else {
            reject("FILE_NOT_INITIALIZED", "Audio file is not initialized.")
            return nil
        }

        let sampleRate = Float(audioFile.fileFormat.sampleRate)
        let totalDurationMs = Double(audioFile.length) / Double(sampleRate) * 1000

        // Calculate effective time range
        let effectiveStartMs = startTimeMs ?? 0.0
        let effectiveEndMs = min(endTimeMs ?? totalDurationMs, totalDurationMs)
        let durationMs = effectiveEndMs - effectiveStartMs // This is the actual duration we want to use

        // Convert time to frames with proper offset
        let startFrame = AVAudioFramePosition(effectiveStartMs * Double(sampleRate) / 1000.0)
        let endFrame = AVAudioFramePosition(effectiveEndMs * Double(sampleRate) / 1000.0)
        let samplesInRange = Int(endFrame - startFrame)

        guard samplesInRange > 0 else {
            reject("INVALID_RANGE", "Invalid sample range: contains no samples")
            return nil
        }

        // Calculate exact samples per point to get the requested number of points
        let samplesPerPoint = samplesInRange / numberOfPoints
        var dataPoints = [DataPoint]()
        dataPoints.reserveCapacity(numberOfPoints)

        var minAmplitude: Float = .greatestFiniteMagnitude
        var maxAmplitude: Float = -.greatestFiniteMagnitude

        // `?? 16 / 8` parsed as `?? (16 / 8)`, so a present 16-bit key made this 16 rather
        // than 2 and every byte position below came out eight times too large. The divide
        // has to apply to the resolved depth, not just the fallback. Unrelated to #451,
        // found while auditing the bit-depth reads.
        let bytesPerSample = (audioFile.fileFormat.settings[AVLinearPCMBitDepthKey] as? Int ?? 16) / 8

        for i in 0..<numberOfPoints {
            let pointStartFrame = startFrame + Int64(i * samplesPerPoint)
            let pointEndFrame = startFrame + Int64((i + 1) * samplesPerPoint)
            let framesToRead = AVAudioFrameCount(pointEndFrame - pointStartFrame)

            // Calculate byte positions
            let startPosition = Int(pointStartFrame) * bytesPerSample * Int(audioFile.fileFormat.channelCount)
            let endPosition = Int(pointEndFrame) * bytesPerSample * Int(audioFile.fileFormat.channelCount)
            let segmentStartTime = Float(pointStartFrame) / sampleRate
            let segmentEndTime = Float(pointEndFrame) / sampleRate

            do {
                audioFile.framePosition = pointStartFrame
                let buffer = AVAudioPCMBuffer(pcmFormat: audioFile.processingFormat, frameCapacity: framesToRead)!
                try audioFile.read(into: buffer, frameCount: framesToRead)

                guard let floatData = buffer.floatChannelData else { continue }

                var sumSquares: Float = 0
                var zeroCrossings = 0
                var prevValue: Float = 0
                var localMinAmplitude: Float = .greatestFiniteMagnitude
                var localMaxAmplitude: Float = -.greatestFiniteMagnitude

                // Process samples for this point
                for frame in 0..<Int(framesToRead) {
                    let value = floatData[0][frame]
                    sumSquares += value * value
                    if frame > 0 && value * prevValue < 0 {
                        zeroCrossings += 1
                    }
                    prevValue = value

                    let absValue = abs(value)
                    localMinAmplitude = min(localMinAmplitude, absValue)
                    localMaxAmplitude = max(localMaxAmplitude, absValue)
                }

                let features = computeFeatures(segmentData: Array(UnsafeBufferPointer(start: floatData[0], count: Int(framesToRead))),
                                            sampleRate: sampleRate,
                                            sumSquares: sumSquares,
                                            zeroCrossings: zeroCrossings,
                                            segmentLength: Int(framesToRead),
                                            featureOptions: featureOptions)

                let rms = features.rms
                let silent = rms < SILENCE_THRESHOLD_RMS
                let dB = Float(20 * log10(Double(rms)))

                let dataPoint = DataPoint(
                    id: Int(uniqueIdCounter),
                    amplitude: localMaxAmplitude,
                    rms: rms,
                    dB: dB,
                    silent: silent,
                    features: features,
                    speech: SpeechFeatures(isActive: !silent),
                    startTime: segmentStartTime,
                    endTime: segmentEndTime,
                    startPosition: startPosition,
                    endPosition: endPosition,
                    samples: Int(framesToRead)
                )
                dataPoints.append(dataPoint)
                uniqueIdCounter += 1

                minAmplitude = min(minAmplitude, localMinAmplitude)
                maxAmplitude = max(maxAmplitude, localMaxAmplitude)
            } catch {
                reject("AUDIO_READ_ERROR", "Error reading audio data: \(error.localizedDescription)")
                return nil
            }
        }

        let startTime = CACurrentMediaTime() // Start timing

        let bitDepth = audioFile.fileFormat.settings[AVLinearPCMBitDepthKey] as? Int ?? 16
        let numberOfChannels = Int(audioFile.processingFormat.channelCount)

        NSLog("""
            [AudioProcessor] Starting preview extraction:
            - numberOfPoints: \(numberOfPoints)
            - startTimeMs: \(String(describing: startTimeMs))
            - endTimeMs: \(String(describing: endTimeMs))
            - durationMs: \(durationMs)
            - sampleRate: \(sampleRate)
            - bitDepth: \(bitDepth)
            - channels: \(numberOfChannels)
            - samplesInRange: \(samplesInRange)
            - samplesPerPoint: \(samplesPerPoint)
        """)

        let endTime = CACurrentMediaTime()
        let extractionTimeMs = Float((endTime - startTime) * 1000)

        NSLog("""
            [AudioProcessor] Preview extraction completed:
            - dataPoints generated: \(dataPoints.count)
            - extractionTimeMs: \(String(format: "%.2f", extractionTimeMs))ms
            - amplitudeRange: (min: \(String(format: "%.6f", minAmplitude)), max: \(String(format: "%.6f", maxAmplitude)))
        """)

        return AudioAnalysisData(
            segmentDurationMs: 100, // Default 100ms
            durationMs: Int(durationMs), // Use actual duration of trimmed section
            bitDepth: bitDepth,
            numberOfChannels: numberOfChannels,
            sampleRate: Int(sampleRate),
            samples: samplesInRange,
            dataPoints: dataPoints,
            amplitudeRange: AudioAnalysisData.AmplitudeRange(
                min: minAmplitude,
                max: maxAmplitude
            ),
            rmsRange: AudioAnalysisData.AmplitudeRange(
                min: 0,
                max: 1
            ),
            speechAnalysis: nil,
            extractionTimeMs: extractionTimeMs
        )
    }

    // Add this helper function to the AudioProcessor class
    private func getDocumentsDirectory() -> URL {
        return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }
}
