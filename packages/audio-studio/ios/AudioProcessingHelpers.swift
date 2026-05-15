// packages/audio-studio/ios/AudioProcessingHelpers.swift

import Accelerate
import AVFoundation
import QuartzCore
import zlib

// Constants
private let FFT_LENGTH = 1024
private let sharedFFT = FFT(FFT_LENGTH)

// Main feature extraction functions
func extractMFCC(from segment: [Float], sampleRate: Float) -> [Float] {
    let nMFCC = 40
    
    // Apply Hann window and prepare for FFT
    let windowed = applyHannWindow(to: segment)
    let fftData = sharedFFT.processSegment(windowed)
    
    // Compute power spectrum
    let powerSpectrum = computePowerSpectrum(from: fftData)
    
    // Apply Mel filterbank
    let melFilters = computeMelFilterbank(numFilters: nMFCC, fftSize: FFT_LENGTH, sampleRate: sampleRate)
    var melEnergies = [Float](repeating: 0, count: nMFCC)
    
    // Safe array access with bounds checking
    for i in 0..<nMFCC {
        var energy: Float = 0
        let filterBank = melFilters[i]
        let minLength = min(powerSpectrum.count, filterBank.count)
        
        for j in 0..<minLength {
            energy += powerSpectrum[j] * filterBank[j]
        }
        melEnergies[i] = log(max(energy, .leastNormalMagnitude))
    }
    
    // Apply DCT
    return computeDCT(from: melEnergies)
}

func extractSpectralCentroid(from segment: [Float], sampleRate: Float) -> Float {
    let fftData = sharedFFT.processSegment(segment)
    
    let magnitudes = computeMagnitudeSpectrum(from: fftData)
    let frequencies = (0..<magnitudes.count).map { Float($0) * sampleRate / Float(2 * magnitudes.count) }
    
    let sumMagnitudes = magnitudes.reduce(0, +)
    guard sumMagnitudes > 0 else { return 0 }
    
    let weightedSum = zip(frequencies, magnitudes)
        .map { $0.0 * $0.1 }
        .reduce(0, +)
    
    return weightedSum / sumMagnitudes
}

func extractSpectralFlatness(from segment: [Float]) -> Float {
    let fftData = sharedFFT.processSegment(segment)
    
    // Compute power spectrum
    let powerSpectrum = computePowerSpectrum(from: fftData)
    
    // Calculate geometric mean using log-space to avoid numerical issues
    var sumLogValues: Float = 0.0
    for value in powerSpectrum {
        sumLogValues += log(value + 1e-10) // Add small epsilon to avoid log(0)
    }
    let geometricMean = exp(sumLogValues / Float(powerSpectrum.count))
    
    // Calculate arithmetic mean
    let arithmeticMean = powerSpectrum.reduce(0, +) / Float(powerSpectrum.count)
    
    return arithmeticMean > 0 ? geometricMean / arithmeticMean : 0.0
}

func extractSpectralRollOff(from segment: [Float], sampleRate: Float) -> Float {
    let fftData = sharedFFT.processSegment(segment)
    
    let magnitudes = computeMagnitudeSpectrum(from: fftData)
    let totalEnergy = magnitudes.reduce(0, +)
    let threshold = 0.85 * totalEnergy // 85% rolloff point
    
    var cumulativeEnergy: Float = 0
    for (index, magnitude) in magnitudes.enumerated() {
        cumulativeEnergy += magnitude
        if cumulativeEnergy >= threshold {
            return Float(index) * sampleRate / Float(2 * magnitudes.count)
        }
    }
    
    return 0.0
}

func extractSpectralBandwidth(from segment: [Float], sampleRate: Float) -> Float {
    let fftData = sharedFFT.processSegment(segment)
    
    let centroid = extractSpectralCentroid(from: segment, sampleRate: sampleRate)
    
    let magnitudes = computeMagnitudeSpectrum(from: fftData)
    let frequencies = (0..<magnitudes.count).map { Float($0) * sampleRate / Float(2 * magnitudes.count) }
    
    let sumMagnitudes = magnitudes.reduce(0, +)
    guard sumMagnitudes > 0 else { return 0 }
    
    let variance = zip(frequencies, magnitudes)
        .map { pow($0.0 - centroid, 2) * $0.1 }
        .reduce(0, +)
    
    return sqrt(variance / sumMagnitudes)
}

func extractChromagram(from segment: [Float], sampleRate: Float) -> [Float] {
    let fftData = sharedFFT.processSegment(segment)
    let numBins = fftData.count / 2
    let nChroma = 12
    var chroma = [Float](repeating: 0, count: nChroma)
    let freqsPerBin = sampleRate / Float(FFT_LENGTH)
    
    for i in 0..<numBins {
        let freq = Float(i) * freqsPerBin
        if freq > 0 {
            let pitchClass = Int((12 * log2(freq / 440.0)).truncatingRemainder(dividingBy: 12))
            if pitchClass >= 0 && pitchClass < nChroma {
                let realIndex = 2 * i
                let imagIndex = realIndex + 1
                
                let re = realIndex < fftData.count ? fftData[realIndex] : 0
                let im = imagIndex < fftData.count ? fftData[imagIndex] : 0
                let magnitude = sqrt(re * re + im * im)
                
                chroma[pitchClass] += magnitude
            }
        }
    }
    
    return chroma
}

func extractTempo(from segment: [Float], sampleRate: Float) -> Float {
    let hopLength = 512
    let frameLength = 2048
    
    // Compute onset strength signal using spectral flux
    var onsetEnvelope = [Float]()
    var previousSpectrum = [Float](repeating: 0, count: frameLength / 2)
    
    // Ensure we have enough samples for at least one frame
    guard segment.count >= frameLength else {
        return 120.0 // Return default tempo if segment is too short
    }
    
    // Safe frame processing
    for i in stride(from: 0, to: max(0, segment.count - frameLength), by: hopLength) {
        let endIndex = min(i + frameLength, segment.count)
        let frame = Array(segment[i..<endIndex])
        var fftData = frame + [Float](repeating: 0, count: frameLength - frame.count)
        sharedFFT.realForward(&fftData)
        
        let magnitudes = computeMagnitudeSpectrum(from: fftData)
        var flux: Float = 0
        for j in 0..<min(magnitudes.count, previousSpectrum.count) {
            flux += max(magnitudes[j] - previousSpectrum[j], 0)
        }
        onsetEnvelope.append(flux)
        previousSpectrum = magnitudes
    }
    
    // Find peaks in onset envelope - ensure we have enough points
    var peaks = [Int]()
    if onsetEnvelope.count >= 3 {
        for i in 1..<(onsetEnvelope.count - 1) {
            if onsetEnvelope[i] > onsetEnvelope[i-1] && onsetEnvelope[i] > onsetEnvelope[i+1] {
                peaks.append(i)
            }
        }
    }
    
    // Calculate tempo from peak intervals
    if peaks.count > 1 {
        let intervals = zip(peaks, peaks.dropFirst()).map { $1 - $0 }
        if !intervals.isEmpty {
            let averageInterval = Float(intervals.reduce(0, +)) / Float(intervals.count)
            if averageInterval > 0 {
                let tempo = 60.0 * sampleRate / Float(hopLength) / averageInterval
                // Constrain tempo to reasonable range (20-300 BPM)
                return min(300.0, max(20.0, tempo))
            }
        }
    }
    
    return 120.0 // Default tempo if no clear peaks found
}

private func findPeaks(in data: [Float], minProminence: Float) -> [Int] {
    var peaks = [Int]()
    for i in 1..<data.count - 1 {
        if data[i] > data[i - 1] && data[i] > data[i + 1] {
            let prominence = data[i] - max(data[i - 1], data[i + 1])
            if prominence >= minProminence {
                peaks.append(i)
            }
        }
    }
    return peaks
}

func extractHNR(from segment: [Float]) -> Float {
    let frameSize = segment.count
    var autocorrelation = [Float](repeating: 0, count: frameSize)
    
    // Compute autocorrelation
    vDSP_conv(segment, 1, segment.reversed(), 1, &autocorrelation, 1, vDSP_Length(frameSize), vDSP_Length(frameSize))
    
    // Find peaks with minimum prominence
    if let maxValue = autocorrelation.max() {
        let peaks = findPeaks(in: autocorrelation, minProminence: 0.1 * maxValue)
        
        // Find first peak after zero lag
        if let firstPeakIndex = peaks.first(where: { $0 > 0 }) {
            let harmonicEnergy = autocorrelation[firstPeakIndex]
            let noiseEnergy = autocorrelation[0] - harmonicEnergy
            if noiseEnergy > 0 {
                return 10 * log10(harmonicEnergy / noiseEnergy)
            }
        }
    }
    
    return 0.0
}

// Helper functions
private func computeMagnitudeSpectrum(from fftData: [Float]) -> [Float] {
    let numBins = fftData.count / 2  // Since FFT data contains real and imaginary pairs
    var magnitudes = [Float]()
    
    for i in 0..<numBins {
        let realIndex = 2 * i
        let imagIndex = realIndex + 1
        
        let re = realIndex < fftData.count ? fftData[realIndex] : 0
        let im = imagIndex < fftData.count ? fftData[imagIndex] : 0
        magnitudes.append(sqrt(re*re + im*im))
    }
    return magnitudes
}

private func applyHannWindow(to segment: [Float]) -> [Float] {
    var window = [Float](repeating: 0, count: segment.count)
    vDSP_hann_window(&window, vDSP_Length(segment.count), Int32(vDSP_HANN_NORM))
    
    var result = [Float](repeating: 0, count: segment.count)
    vDSP_vmul(segment, 1, window, 1, &result, 1, vDSP_Length(segment.count))
    
    return result
}

private func computePowerSpectrum(from fftData: [Float]) -> [Float] {
    let numBins = fftData.count / 2
    var powerSpectrum = [Float]()
    
    for i in 0..<numBins {
        let realIndex = 2 * i
        let imagIndex = realIndex + 1
        
        let re = realIndex < fftData.count ? fftData[realIndex] : 0
        let im = imagIndex < fftData.count ? fftData[imagIndex] : 0
        powerSpectrum.append(re*re + im*im)
    }
    return powerSpectrum
}

private func computeMelFilterbank(numFilters: Int, fftSize: Int, sampleRate: Float) -> [[Float]] {
    let fMin: Float = 0
    let fMax = sampleRate / 2
    
    let melMin = hzToMel(fMin)
    let melMax = hzToMel(fMax)
    let melStep = (melMax - melMin) / Float(numFilters + 1)
    
    let melPoints = (0...numFilters+1).map { melMin + Float($0) * melStep }
    let hzPoints = melPoints.map { melToHz($0) }
    let bins = hzPoints.map { Int(($0 * Float(fftSize) / sampleRate).rounded()) }
    
    var filterbank = [[Float]](repeating: [Float](repeating: 0, count: 1 + fftSize/2), count: numFilters)
    
    for i in 0..<numFilters {
        for j in bins[i]..<bins[i+2] {
            if j < bins[i+1] {
                filterbank[i][j] = Float(j - bins[i]) / Float(bins[i+1] - bins[i])
            } else {
                filterbank[i][j] = Float(bins[i+2] - j) / Float(bins[i+2] - bins[i+1])
            }
        }
    }
    
    return filterbank
}

private func hzToMel(_ hz: Float) -> Float {
    return 2595 * log10(1 + hz/700)
}

private func melToHz(_ mel: Float) -> Float {
    return 700 * (pow(10, mel/2595) - 1)
}

private func computeDCT(from input: [Float]) -> [Float] {
    let N = input.count
    var output = [Float](repeating: 0, count: N)
    let scale = sqrt(2.0 / Float(N))
    
    for i in 0..<N {
        var sum: Float = 0
        for j in 0..<N {
            sum += input[j] * cos(.pi * Float(i) * (2 * Float(j) + 1) / (2 * Float(N)))
        }
        output[i] = scale * sum
    }
    
    return output
}

func computeMelSpectrogram(from segment: [Float], sampleRate: Float) -> [Float] {
    let nMels: Int32 = 128
    let fftLength: Int32 = 2048
    let windowSize = Int32(min(segment.count, Int(fftLength)))
    let hopLength = windowSize  // single frame

    MelSpectrogramWrapper.initWithSampleRate(
        Int32(sampleRate),
        fftLength: fftLength,
        windowSizeSamples: windowSize,
        hopLengthSamples: hopLength,
        nMels: nMels,
        fMin: 0.0,
        fMax: sampleRate / 2.0,
        windowType: 0  // Hann
    )

    let melResult: [NSNumber]? = segment.withUnsafeBufferPointer { bufPtr in
        return MelSpectrogramWrapper.computeFrame(
            withSamples: bufPtr.baseAddress,
            frameSize: Int32(segment.count)
        )
    }

    guard let result = melResult else {
        return []
    }

    return result.map { $0.floatValue }
}

func computeSpectralContrast(from segment: [Float], sampleRate: Float) -> [Float] {
    let fftData = sharedFFT.processSegment(segment)
    
    let magnitudeSpectrum = computeMagnitudeSpectrum(from: fftData)
    var contrast = [Float]()
    
    // Define standard octave-based frequency bands
    let bandFrequencies = [
        (20.0, 125.0),    // Sub-bass
        (125.0, 250.0),   // Bass
        (250.0, 500.0),   // Low-mids
        (500.0, 1000.0),  // Mids
        (1000.0, 2000.0), // High-mids
        (2000.0, 4000.0), // Presence
        (4000.0, min(8000.0, Double(sampleRate) / 2.0)) // Brilliance
    ]
    
    // Calculate frequency resolution
    let freqResolution = Float(sampleRate) / Float(FFT_LENGTH)
    
    for (lowFreq, highFreq) in bandFrequencies {
        // Convert frequencies to FFT bin indices
        let startBin = Int(Float(lowFreq) / freqResolution)
        let endBin = min(Int(Float(highFreq) / freqResolution), magnitudeSpectrum.count - 1)
        
        if startBin < endBin {
            let bandSpectrum = Array(magnitudeSpectrum[startBin...endBin])
            
            // Sort magnitudes for percentile calculation
            let sortedMagnitudes = bandSpectrum.sorted()
            let length = sortedMagnitudes.count
            
            // Calculate peak (95th percentile) and valley (5th percentile)
            let peakIndex = Int(Float(length) * 0.95)
            let valleyIndex = Int(Float(length) * 0.05)
            let peak = sortedMagnitudes[peakIndex]
            let valley = sortedMagnitudes[valleyIndex]
            
            // Calculate contrast in dB scale
            let contrastValue = 20 * log10(peak / max(valley, .leastNormalMagnitude))
            contrast.append(contrastValue)
        } else {
            contrast.append(0)
        }
    }
    
    return contrast
}

// Original function for backward compatibility
func computeTonnetz(from segment: [Float], sampleRate: Float) -> [Float] {
    let chroma = extractChromagram(from: segment, sampleRate: sampleRate)
    return computeTonnetz(fromChroma: chroma)
}

// New optimized function that accepts pre-computed chromagram
func computeTonnetz(fromChroma chroma: [Float]) -> [Float] {
    // Tonnetz transformation matrix (6x12)
    let tonnetzMatrix: [[Float]] = [
        [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], // Perfect fifth
        [0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0], // Minor third
        [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0], // Major third
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0], // Perfect fifth
        [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1], // Minor third
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]  // Major third
    ]
    
    // Compute tonnetz features
    return tonnetzMatrix.map { row in
        zip(row, chroma).map { $0 * $1 }.reduce(0, +)
    }
}

struct AudioData {
    let samples: [Float]
    let sampleRate: Int
}

func loadAudioFile(_ fileUri: String) throws -> AudioData {
    guard let url = URL(string: fileUri) else {
        throw NSError(domain: "AudioProcessing", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid file URL"])
    }
    
    let file = try AVAudioFile(forReading: url)
    let format = file.processingFormat
    let frameCount = UInt32(file.length)
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount)!
    
    try file.read(into: buffer, frameCount: frameCount)
    
    // Convert buffer to float array
    let samples: [Float]
    if let floatData = buffer.floatChannelData?[0] {
        samples = Array(UnsafeBufferPointer(start: floatData, count: Int(frameCount)))
    } else {
        throw NSError(domain: "AudioProcessing", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to read audio data"])
    }
    
    return AudioData(samples: samples, sampleRate: Int(format.sampleRate))
}

func computeEnergy(from samples: [Float]) -> Float {
    var energy: Float = 0
    vDSP_measqv(samples, 1, &energy, vDSP_Length(samples.count))
    return energy / Float(samples.count)
}

func computeRMS(from samples: [Float]) -> Float {
    let energy = computeEnergy(from: samples)
    return sqrt(energy)
}

func computeZCR(from samples: [Float]) -> Float {
    var zeroCrossings: Int = 0
    for i in 1..<samples.count {
        if (samples[i-1] * samples[i]) < 0 {
            zeroCrossings += 1
        }
    }
    return Float(zeroCrossings) / Float(samples.count)
}

// Keep in AudioProcessingHelpers.swift
private let N_MFCC = 40
private let N_FFT = 1024
private let N_MELS = 128
private let N_CHROMA = 12
private let N_BANDS = 7

// Core audio processing functions
func calculateZeroCrossingRate(_ data: [Float]) -> Float {
    var count: Float = 0
    for i in 1..<data.count {
        if (data[i] >= 0 && data[i-1] < 0) || (data[i] < 0 && data[i-1] >= 0) {
            count += 1
        }
    }
    return count / Float(data.count)
}

func calculateEnergy(_ data: [Float]) -> Float {
    var energy: Float = 0
    vDSP_svesq(data, 1, &energy, vDSP_Length(data.count))
    return energy / Float(data.count)
}

// Feature extraction functions
func computeFeatures(segmentData: [Float], sampleRate: Float, sumSquares: Float, zeroCrossings: Int, segmentLength: Int, featureOptions: [String: Bool]) -> Features {
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

    // Single C++ call for all FFT-based features (spectral + MFCC + chroma)
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
                fftLength: Int32(N_FFT),
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

    let melSpectrogram = featureOptions["melSpectrogram"] == true ? computeMelSpectrogram(from: segmentData, sampleRate: sampleRate) : []
    let spectralContrast = featureOptions["spectralContrast"] == true ? computeSpectralContrast(from: segmentData, sampleRate: sampleRate) : []
    let tonnetz = featureOptions["tonnetz"] == true ? computeTonnetz(from: segmentData, sampleRate: sampleRate) : []

    let pitch = featureOptions["pitch"] == true ? estimatePitch(from: segmentData, sampleRate: sampleRate) : nil

    return Features(
        energy: energy,
        mfcc: mfcc,
        rms: rms,
        zcr: zcr,
        spectralCentroid: spectralCentroid,
        spectralFlatness: spectralFlatness,
        spectralRolloff: spectralRolloff,
        spectralBandwidth: spectralBandwidth,
        chromagram: chromagram,
        tempo: extractTempo(from: segmentData, sampleRate: sampleRate),
        hnr: extractHNR(from: segmentData),
        melSpectrogram: melSpectrogram,
        spectralContrast: spectralContrast,
        tonnetz: tonnetz,
        pitch: pitch
    )
}

private func nextPowerOfTwo(_ n: Int) -> Int {
    var power = 1
    while power < n {
        power *= 2
    }
    return power
}

func estimatePitch(from segment: [Float], sampleRate: Float) -> Float {
    guard segment.count >= 2 else { return 0.0 }
    
    // Apply a Hann window to reduce edge effects
    let windowed = applyHannWindow(to: segment)
    
    // Pad the signal for FFT
    let fftLength = nextPowerOfTwo(segment.count * 2 - 1)
    var padded = windowed + [Float](repeating: 0, count: fftLength - windowed.count)
    sharedFFT.realForward(&padded)
    
    // Compute autocorrelation using FFT
    var autocorrelation = [Float](repeating: 0, count: fftLength)
    vDSP_conv(segment, 1, segment.reversed(), 1, &autocorrelation, 1, vDSP_Length(segment.count), vDSP_Length(segment.count))
    
    // Find the first peak within the pitch range (50-500 Hz)
    let minLag = Int(sampleRate / 500.0) // Max frequency
    let maxLag = Int(sampleRate / 50.0)  // Min frequency
    var maxCorr: Float = -1.0
    var pitchLag = 0
    
    // Skip the first few samples to avoid the zero-lag peak
    for lag in minLag...maxLag {
        if autocorrelation[lag] > maxCorr {
            maxCorr = autocorrelation[lag]
            pitchLag = lag
        }
    }
    
    // Convert lag to frequency (sampleRate / lag)
    return pitchLag > 0 ? sampleRate / Float(pitchLag) : 0.0
}

// Add speech detection helper function
func detectSpeech(from segment: [Float], rms: Float) -> (isActive: Bool, probability: Float) {
    // Simple speech detection based on RMS and zero-crossing rate
    let zcr = calculateZeroCrossingRate(segment)
    let isSpeech = rms > 0.01 && zcr > 0.1 && zcr < 0.5
    let probability = min(1.0, max(0.0, rms * 10)) // Simple probability estimation
    
    return (isActive: isSpeech, probability: probability)
}

func extractRawAudioData(
    from url: URL,
    startFrame: AVAudioFramePosition,
    frameCount: AVAudioFrameCount,
    format: AVAudioFormat,
    decodingConfig: DecodingConfig,
    includeNormalizedData: Bool,
    includeBase64Data: Bool
) throws -> (pcmData: Data, floatData: [Float]?, base64Data: String?) {
    // Apply decoding configuration
    let targetFormat = decodingConfig.toAudioFormat(baseFormat: format)
    
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount)!
    let audioFile = try AVAudioFile(forReading: url)
    
    audioFile.framePosition = startFrame
    try audioFile.read(into: buffer, frameCount: frameCount)
    
    // Convert to target format if different from source
    let finalBuffer: AVAudioPCMBuffer
    if targetFormat != format {
        let converter = AVAudioConverter(from: format, to: targetFormat)!
        finalBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: frameCount)!
        
        var error: NSError?
        _ = converter.convert(to: finalBuffer, error: &error) { inNumPackets, outStatus in
            outStatus.pointee = .haveData
            return buffer
        }
        
        if let error = error {
            Logger.debug("AudioProcessingHelpers", "Format conversion failed: \(error.localizedDescription)")
            throw error
        }
    } else {
        finalBuffer = buffer
    }
    
    guard let floatData = finalBuffer.floatChannelData else {
        throw NSError(domain: "AudioProcessing", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to get float channel data"])
    }
    
    let channels = Int(targetFormat.channelCount)
    let totalSamples = Int(finalBuffer.frameLength) * channels
    
    // Use targetBitDepth from decodingConfig instead of format's bit depth
    let targetBitDepth = decodingConfig.targetBitDepth ?? 16
    let bytesPerSample = targetBitDepth / 8
    var pcmData = Data(capacity: totalSamples * bytesPerSample)
    
    // Convert float samples to PCM format with specified bit depth
    for frame in 0..<Int(finalBuffer.frameLength) {
        for channel in 0..<channels {
            let sample = floatData[channel][frame]
            
            // Sanitize: replace NaN/Inf with 0 then clamp. Skip clamp when
            // normalizeAudio=false so callers see the raw decoded magnitude,
            // but always finite-check to avoid Swift's `Int16(_:)` /
            // `Int32(_:)` trap on non-finite values.
            let safeSample: Float = sample.isFinite ? sample : 0
            let normalizedSample = decodingConfig.normalizeAudio ?
                max(-1.0, min(1.0, safeSample)) : safeSample

            switch targetBitDepth {
            case 16:
                let intValue = safeFloatToInt16(normalizedSample)
                pcmData.append(contentsOf: withUnsafeBytes(of: intValue) { Array($0) })
            case 32:
                let intValue = safeFloatToInt32(normalizedSample)
                pcmData.append(contentsOf: withUnsafeBytes(of: intValue) { Array($0) })
            default:
                throw NSError(domain: "AudioProcessing", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unsupported bit depth \(targetBitDepth)"])
            }
        }
    }
    
    // Only process normalized data if requested
    let normalizedData: [Float]? = includeNormalizedData ? 
        Array(UnsafeBufferPointer(start: floatData[0], count: Int(finalBuffer.frameLength))) :
        nil
    
    // Convert to base64 if requested
    let base64Data: String? = includeBase64Data ?
        pcmData.base64EncodedString() :
        nil
    
    return (pcmData: pcmData, floatData: normalizedData, base64Data: base64Data)
}

// Update the CRC32 function to use zlib's implementation
func calculateCRC32(data: Data) -> UInt32 {
    data.withUnsafeBytes { buffer in
        let ptr = buffer.baseAddress?.assumingMemoryBound(to: UInt8.self)
        return UInt32(crc32(0, ptr, UInt32(buffer.count)))
    }
}

func calculateCRC32(from floatArray: [Float], count: Int) -> UInt32 {
    return floatArray.withUnsafeBytes { floatBytes -> UInt32 in
        // Get raw pointer to the bytes with proper alignment
        let byteCount = count * MemoryLayout<Float>.size
        return UInt32(crc32(0, floatBytes.baseAddress, UInt32(byteCount)))
    }
}

func createWavHeader(pcmData: Data, sampleRate: Int, channels: Int, bitDepth: Int) -> Data {
    let headerSize = 44
    let totalDataLen = pcmData.count + headerSize - 8
    let bytesPerSample = bitDepth / 8
    let byteRate = sampleRate * channels * bytesPerSample
    let blockAlign = channels * bytesPerSample
    
    var header = Data(capacity: headerSize)
    
    // RIFF header
    header.append(contentsOf: "RIFF".data(using: .ascii)!)
    
    // Total data length
    header.append(UInt32(totalDataLen).littleEndian.data)
    
    // WAVE header
    header.append(contentsOf: "WAVE".data(using: .ascii)!)
    
    // 'fmt ' chunk
    header.append(contentsOf: "fmt ".data(using: .ascii)!)
    
    // 16 for PCM format
    header.append(UInt32(16).littleEndian.data)
    
    // Format = 1 for PCM
    header.append(UInt16(1).littleEndian.data)
    
    // Number of channels
    header.append(UInt16(channels).littleEndian.data)
    
    // Sample rate
    header.append(UInt32(sampleRate).littleEndian.data)
    
    // Byte rate
    header.append(UInt32(byteRate).littleEndian.data)
    
    // Block align
    header.append(UInt16(blockAlign).littleEndian.data)
    
    // Bits per sample
    header.append(UInt16(bitDepth).littleEndian.data)
    
    // 'data' chunk
    header.append(contentsOf: "data".data(using: .ascii)!)
    
    // Data length
    header.append(UInt32(pcmData.count).littleEndian.data)
    
    // Combine header and PCM data
    var wavData = header
    wavData.append(pcmData)
    
    return wavData
}

// Extension to help with binary data conversion
extension UInt16 {
    var data: Data {
        var value = self
        return Data(bytes: &value, count: MemoryLayout<UInt16>.size)
    }
}

extension UInt32 {
    var data: Data {
        var value = self
        return Data(bytes: &value, count: MemoryLayout<UInt32>.size)
    }
}
