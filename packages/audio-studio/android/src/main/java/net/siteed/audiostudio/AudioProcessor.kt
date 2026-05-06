package net.siteed.audiostudio

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*
import android.util.Log
import java.io.File
import java.util.concurrent.atomic.AtomicLong
import kotlin.system.measureTimeMillis
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaCodec
import java.io.FileInputStream
import java.io.RandomAccessFile
import java.util.zip.CRC32
import net.siteed.audiostudio.LogUtils

data class DecodingConfig(
    val targetSampleRate: Int? = null,     // Optional target sample rate
    val targetChannels: Int? = null,       // Optional target number of channels
    val targetBitDepth: Int = 16,          // Default to 16-bit PCM
    val normalizeAudio: Boolean = false    // Whether to normalize audio levels
)

data class SpectrogramData(
    val spectrogram: Array<FloatArray>, // 2D array: [time, frequency]
    val timeStamps: FloatArray,         // Time (in seconds) for each frame
    val frequencies: FloatArray         // Frequencies (in Hz) for each mel bin
)

class AudioProcessor(private val filesDir: File) {
    companion object {
        const val DCT_SQRT_DIVISOR = 2.0
        private const val N_FFT = 1024
        private const val N_CHROMA = 12
        private const val CLASS_NAME = "AudioProcessor" // Add class name constant for logging

        private val uniqueIdCounter = AtomicLong(0L) // Keep as companion object property to maintain during pause/resume cycles

        fun resetUniqueIdCounter() {
            uniqueIdCounter.set(0L)
        }
    }

    data class AudioData(val data: ByteArray, val sampleRate: Int, val bitDepth: Int, val channels: Int, val durationMs: Long = 0)

    private var cumulativeMinAmplitude = Float.MAX_VALUE
    private var cumulativeMaxAmplitude = Float.NEGATIVE_INFINITY

    private fun loadAudioFile(filePath: String): AudioData? {
        try {
            val fileUri = filePath.removePrefix("file://")
            LogUtils.d(CLASS_NAME, "Processing WAV file: $fileUri")

            val file = File(fileUri).takeIf { it.exists() } ?: File(filesDir, File(fileUri).name).takeIf { it.exists() }
                ?: run {
                    LogUtils.e(CLASS_NAME, "File not found: $fileUri")
                    return null
                }

            val raf = RandomAccessFile(file, "r")
            val fileSize = raf.length()
            
            // Read RIFF header
            val riffHeader = ByteArray(4).apply { raf.readFully(this) }
            if (String(riffHeader) != "RIFF") {
                LogUtils.e(CLASS_NAME, "Invalid RIFF header")
                return null
            }

            // Read WAVE header
            val waveHeader = ByteArray(4).apply { raf.readFully(this) }
            if (String(waveHeader) != "WAVE") {
                LogUtils.e(CLASS_NAME, "Invalid WAVE header")
                return null
            }

            var fmtChunkFound = false
            var dataChunkFound = false
            var sampleRate = 0
            var channels = 0
            var bitDepth = 0
            var dataOffset = 0L
            var dataSize = 0L

            // Parse chunks
            while (raf.filePointer < fileSize - 8) {
                val chunkId = ByteArray(4).apply { raf.readFully(this) }.toString(Charsets.UTF_8)
                val chunkSizeBytes = ByteArray(4).apply { raf.readFully(this) }
                val chunkSize = ByteBuffer.wrap(chunkSizeBytes).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xFFFFFFFFL

                LogUtils.d(CLASS_NAME, "Found chunk: $chunkId ($chunkSize bytes)")

                when (chunkId) {
                    "fmt " -> {
                        if (chunkSize < 16) {
                            LogUtils.e(CLASS_NAME, "Invalid fmt chunk size")
                            return null
                        }
                        
                        val formatData = ByteArray(16)
                        raf.readFully(formatData)
                        val formatBuffer = ByteBuffer.wrap(formatData).order(ByteOrder.LITTLE_ENDIAN)
                        
                        val audioFormat = formatBuffer.short // Skip audio format
                        channels = formatBuffer.short.toInt() and 0xFFFF
                        sampleRate = formatBuffer.int
                        val byteRate = formatBuffer.int
                        val blockAlign = formatBuffer.short
                        bitDepth = formatBuffer.short.toInt() and 0xFFFF
                        
                        LogUtils.d(CLASS_NAME, "Raw format data: ${formatData.joinToString(", ")}")
                        LogUtils.d(CLASS_NAME, "Format chunk: audioFormat=$audioFormat, channels=$channels, sampleRate=$sampleRate, bitDepth=$bitDepth, byteRate=$byteRate, blockAlign=$blockAlign")
                        
                        if (bitDepth !in listOf(8, 16, 32)) {
                            LogUtils.e(CLASS_NAME, "Invalid bit depth: $bitDepth")
                            return null
                        }
                        
                        val remainingFmtBytes = chunkSize - 16
                        if (remainingFmtBytes > 0) {
                            raf.skipBytes(remainingFmtBytes.toInt())
                        }
                        fmtChunkFound = true
                    }
                    "data" -> {
                        dataOffset = raf.filePointer
                        dataSize = chunkSize
                        dataChunkFound = true
                        break
                    }
                    else -> {
                        // Skip unknown chunks
                        val skipBytes = chunkSize
                        if (skipBytes > 0) {
                            val actualSkip = minOf(skipBytes, fileSize - raf.filePointer)
                            raf.seek(raf.filePointer + actualSkip)
                        }
                    }
                }
            }

            if (!fmtChunkFound || !dataChunkFound) {
                LogUtils.e(CLASS_NAME, "Missing essential chunks (fmt=$fmtChunkFound, data=$dataChunkFound)")
                return null
            }

            // Calculate actual data size if it seems wrong
            if (dataSize <= 0 || dataSize > fileSize - dataOffset) {
                dataSize = fileSize - dataOffset
                LogUtils.d(CLASS_NAME, "Adjusted data size to: $dataSize")
            }

            LogUtils.d(CLASS_NAME, "Reading PCM data: offset=$dataOffset, size=$dataSize")
            
            val wavData = ByteArray(dataSize.toInt())
            raf.seek(dataOffset)
            raf.readFully(wavData)

            // Calculate duration in ms
            // Each sample is bitsPerSample/8 bytes, and we have 'channels' samples per frame
            val bytesPerFrame = channels * (bitDepth / 8)
            val numFrames = wavData.size / bytesPerFrame
            val durationMs = (numFrames * 1000L) / sampleRate

            LogUtils.d(CLASS_NAME, "WAV duration calculation: size=${wavData.size}, bytesPerFrame=$bytesPerFrame, numFrames=$numFrames, sampleRate=$sampleRate, duration=${durationMs}ms")

            return AudioData(
                data = wavData,
                sampleRate = sampleRate,
                channels = channels,
                bitDepth = bitDepth,
                durationMs = durationMs
            )
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to load WAV file: ${e.message}", e)
            return null
        }
    }

    /**
     * Processes the audio data and extracts features.
     * @param data The audio data in bytes.
     * @param config The recording configuration.
     * @return AudioAnalysisData containing the extracted features.
     */
    fun processAudioData(data: ByteArray, config: RecordingConfig): AudioAnalysisData {
        if (data.isEmpty()) {
            LogUtils.e(CLASS_NAME, "Received empty audio data")
            return AudioAnalysisData(
                segmentDurationMs = config.segmentDurationMs,
                durationMs = 0,
                bitDepth = 16,
                numberOfChannels = config.channels,
                sampleRate = config.sampleRate,
                samples = 0,
                dataPoints = emptyList(),
                amplitudeRange = AudioAnalysisData.AmplitudeRange(0f, 0f),
                rmsRange = AudioAnalysisData.AmplitudeRange(0f, 0f),
                extractionTimeMs = 0f,
            )
        }

        val sampleRate = config.sampleRate.toFloat()
        val bitDepth = when (config.encoding) {
            "pcm_8bit" -> 8
            "pcm_16bit" -> 16
            "pcm_32bit" -> 32
            else -> throw IllegalArgumentException("Unsupported encoding: ${config.encoding}")
        }
        val channelData = convertToFloatArray(data, bitDepth)
        val featureOptions = config.features

        val totalSamples = channelData.size
        // Update samplesPerSegment calculation to use proper formula
        val samplesPerSegment = ((config.segmentDurationMs / 1000.0) * sampleRate).toInt()
        val totalPoints = ceil(totalSamples.toDouble() / samplesPerSegment).toInt()
        
        LogUtils.d(CLASS_NAME, "Extracting waveform totalSize=${data.size} with $totalSamples samples --> $totalPoints points")
        LogUtils.d(CLASS_NAME, "segmentDuration: ${config.segmentDurationMs}ms, samplesPerSegment: $samplesPerSegment")

        // Remove expectedPoints calculation since it used pointsPerSecond
        val samplesPerPoint = ceil(channelData.size / totalPoints.toDouble()).toInt()
        LogUtils.d(CLASS_NAME, "Extracting waveform with samplesPerPoints=$samplesPerPoint")

        val dataPoints = mutableListOf<DataPoint>()
        var minAmplitude = Float.MAX_VALUE
        var maxAmplitude = Float.NEGATIVE_INFINITY
        var minRms = Float.MAX_VALUE
        var maxRms = Float.NEGATIVE_INFINITY
         // Calculate total duration in milliseconds based on sample rate and total samples
        val durationMs = (totalSamples.toFloat() / sampleRate * 1000).toInt()

        // Measure the time taken for audio processing
        val extractionTimeMs = measureTimeMillis {
            for (i in 0 until totalPoints) {
                val start = i * samplesPerSegment
                val end = min(start + samplesPerSegment, totalSamples)
                val segmentData = channelData.sliceArray(start until end)

                var sumSquares = 0f
                var zeroCrossings = 0
                var prevValue = 0f
                var localMinAmplitude = Float.MAX_VALUE
                var localMaxAmplitude = Float.MIN_VALUE

                for (value in segmentData) {
                    sumSquares += value * value
                    if (prevValue != 0f && value * prevValue < 0) zeroCrossings += 1
                    prevValue = value

                    val absValue = abs(value)
                    localMinAmplitude = min(localMinAmplitude, absValue)
                    localMaxAmplitude = max(localMaxAmplitude, absValue)
                }

                val features = computeFeatures(
                    segmentData = segmentData,
                    sampleRate = sampleRate,
                    sumSquares = sumSquares,
                    zeroCrossings = zeroCrossings,
                    segmentLength = segmentData.size,
                    featureOptions = featureOptions,
                    minAmplitude = localMinAmplitude,
                    maxAmplitude = localMaxAmplitude
                )
                val rms = features.rms
                val silent = rms < 0.01
                val dB = 20 * log10(rms.toDouble()).toFloat()
                minAmplitude = min(minAmplitude, localMinAmplitude)
                maxAmplitude = max(maxAmplitude, localMaxAmplitude)
                minRms = min(minRms, rms)
                maxRms = max(maxRms, rms)

                val bytesPerSample = bitDepth / 8
                val startPosition = start * bytesPerSample * config.channels
                val endPosition = end * bytesPerSample * config.channels

                // Update cumulative amplitude range
                cumulativeMinAmplitude = min(cumulativeMinAmplitude, localMinAmplitude)
                cumulativeMaxAmplitude = max(cumulativeMaxAmplitude, localMaxAmplitude)

                val dataPoint = DataPoint(
                    id = uniqueIdCounter.getAndIncrement(),
                    amplitude = localMaxAmplitude,  // Always use peak amplitude
                    rms = rms,                      // Always include RMS
                    dB = dB,
                    silent = silent,
                    features = features,
                    speech = SpeechFeatures(isActive = !silent),
                    startTime = startPosition / (sampleRate * bytesPerSample * config.channels),
                    endTime = endPosition / (sampleRate * bytesPerSample * config.channels),
                    startPosition = startPosition,
                    endPosition = endPosition,
                    samples = segmentData.size
                )

                dataPoints.add(dataPoint)
            }
        }

        return AudioAnalysisData(
            segmentDurationMs = config.segmentDurationMs,
            durationMs = durationMs,
            bitDepth = bitDepth,
            numberOfChannels = config.channels,
            sampleRate = config.sampleRate,  // Use config.sampleRate instead of sampleRate
            samples = totalSamples,          // Use totalSamples instead of samplesInRange
            dataPoints = dataPoints,
            amplitudeRange = AudioAnalysisData.AmplitudeRange(minAmplitude, maxAmplitude),
            rmsRange = AudioAnalysisData.AmplitudeRange(minRms, maxRms),
            extractionTimeMs = extractionTimeMs.toFloat()
        )
    }

    fun resetCumulativeAmplitudeRange() {
        cumulativeMinAmplitude = Float.MAX_VALUE
        cumulativeMaxAmplitude = Float.MIN_VALUE
    }

    /**
     * Converts the audio data to a float array.
     * @param data The audio data in bytes.
     * @param bitDepth The bit depth of the audio data.
     * @return The converted float array.
     */
    private fun convertToFloatArray(data: ByteArray, bitDepth: Int): FloatArray {
        return when (bitDepth) {
            16 -> {
                val buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                val array = ShortArray(buffer.remaining())
                buffer.get(array)
                array.map { it / 32768.0f }.toFloatArray()
            }
            8 -> data.map { (it.toInt() - 128) / 128.0f }.toFloatArray()
            32 -> {
                val buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).asIntBuffer()
                val array = IntArray(buffer.remaining())
                buffer.get(array)
                array.map { it / Int.MAX_VALUE.toFloat() }.toFloatArray()
            }
            else -> throw IllegalArgumentException("Unsupported bit depth: $bitDepth")
        }
    }

    /**
     * Computes the features of the audio data.
     * @param segmentData The segment data.
     * @param sampleRate The sample rate of the audio data.
     * @param minAmplitude The minimum amplitude.
     * @param maxAmplitude The maximum amplitude.
     * @param sumSquares The sum of squares.
     * @param zeroCrossings The zero crossings.
     * @param segmentLength The length of the segment.
     * @param featureOptions The feature options to compute.
     * @return The computed features.
     */
    private fun computeFeatures(
        segmentData: FloatArray,
        sampleRate: Float,
        minAmplitude: Float,
        maxAmplitude: Float,
        sumSquares: Float,
        zeroCrossings: Int,
        segmentLength: Int,
        featureOptions: Map<String, Boolean>
    ): Features {
        val rms = sqrt(sumSquares / segmentLength)
        val energy = if (featureOptions["energy"] == true) sumSquares else 0f
        val zcr = if (featureOptions["zcr"] == true) zeroCrossings / segmentLength.toFloat() else 0f

        // Determine if we need the C++ audio features (single JNI call for spectral + MFCC + chroma)
        val needSpectral = featureOptions["spectralCentroid"] == true ||
                          featureOptions["spectralFlatness"] == true ||
                          featureOptions["spectralRolloff"] == true ||
                          featureOptions["spectralBandwidth"] == true
        val needMfcc = featureOptions["mfcc"] == true
        val needChroma = featureOptions["chromagram"] == true

        // Single C++ call for all FFT-based features
        var spectralCentroid = 0f
        var spectralFlatness = 0f
        var spectralRolloff = 0f
        var spectralBandwidth = 0f
        var mfcc: List<Float> = emptyList()
        var chroma: List<Float> = emptyList()

        if (needSpectral || needMfcc || needChroma) {
            try {
                val cppResult = AudioFeaturesNative.computeFrame(
                    segmentData,
                    sampleRate.toInt(),
                    N_FFT,
                    13,   // nMfcc
                    26,   // nMelFilters
                    needMfcc,
                    needChroma
                )
                if (needSpectral) {
                    spectralCentroid = (cppResult["spectralCentroid"] as? Float) ?: 0f
                    spectralFlatness = (cppResult["spectralFlatness"] as? Float) ?: 0f
                    spectralRolloff = (cppResult["spectralRolloff"] as? Float) ?: 0f
                    spectralBandwidth = (cppResult["spectralBandwidth"] as? Float) ?: 0f
                }
                if (needMfcc) {
                    mfcc = (cppResult["mfcc"] as? FloatArray)?.toList() ?: emptyList()
                }
                if (needChroma) {
                    chroma = (cppResult["chromagram"] as? FloatArray)?.toList() ?: emptyList()
                }
            } catch (e: Exception) {
                LogUtils.e(CLASS_NAME, "Failed to compute C++ audio features: ${e.message}", e)
            }
        }

        val melSpectrogram = try {
            if (featureOptions["melSpectrogram"] == true) computeMelSpectrogram(segmentData, sampleRate) else emptyList()
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to compute mel spectrogram: ${e.message}", e)
            emptyList()
        }

        val tempo = try {
            if (featureOptions["tempo"] == true) extractTempo(segmentData, sampleRate) else 0f
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to extract tempo: ${e.message}", e)
            0f
        }

        val hnr = try {
            if (featureOptions["hnr"] == true) extractHNR(segmentData) else 0f
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to extract HNR: ${e.message}", e)
            0f
        }

        val spectralContrast = try {
            if (featureOptions["spectralContrast"] == true) computeSpectralContrast(segmentData, sampleRate) else emptyList()
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to compute spectral contrast: ${e.message}", e)
            emptyList()
        }

        val tonnetz = try {
            if (featureOptions["tonnetz"] == true) computeTonnetz(segmentData, sampleRate) else emptyList()
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to compute tonnetz: ${e.message}", e)
            emptyList()
        }

        val pitch = if (featureOptions["pitch"] == true) estimatePitch(segmentData, sampleRate) else 0.0f

        val crc32Value = if (featureOptions["crc32"] == true) {
            val byteBuffer = ByteBuffer.allocate(segmentData.size * 4)
                .order(ByteOrder.LITTLE_ENDIAN)
            segmentData.forEach { value ->
                byteBuffer.putFloat(value)
            }

            val crc32 = CRC32()
            crc32.update(byteBuffer.array())
            crc32.value
        } else null

        return Features(
            energy = energy,
            mfcc = mfcc,
            rms = rms,
            minAmplitude = minAmplitude,
            maxAmplitude = maxAmplitude,
            zcr = zcr,
            spectralCentroid = spectralCentroid,
            spectralFlatness = spectralFlatness,
            spectralRolloff = spectralRolloff,
            spectralBandwidth = spectralBandwidth,
            tempo = tempo,
            hnr = hnr,
            melSpectrogram = melSpectrogram,
            chromagram = chroma,
            spectralContrast = spectralContrast,
            tonnetz = tonnetz,
            pitch = pitch,
            crc32 = crc32Value
        )
    }

    private fun extractTempo(segmentData: FloatArray, sampleRate: Float): Float {
        val hopLength = 512
        val frameLength = 2048
        
        // Compute onset strength signal using spectral flux
        val onsetEnvelope = mutableListOf<Float>()
        var previousSpectrum = FloatArray(frameLength / 2)
        
        // Process frames with spectral flux
        for (i in 0 until segmentData.size - frameLength step hopLength) {
            val frame = segmentData.slice(i until minOf(i + frameLength, segmentData.size)).toFloatArray()
            val fft = FFT(frameLength)
            val fftData = frame.copyOf(frameLength)
            fft.realForward(fftData)
            
            // Compute magnitude spectrum
            val magnitudes = FloatArray(frameLength / 2)
            for (j in magnitudes.indices) {
                val re = fftData[2 * j]
                val im = if (2 * j + 1 < fftData.size) fftData[2 * j + 1] else 0f
                magnitudes[j] = sqrt(re * re + im * im)
            }
            
            // Calculate spectral flux (sum of positive differences)
            var flux = 0f
            for (j in magnitudes.indices) {
                flux += maxOf(magnitudes[j] - previousSpectrum[j], 0f)
            }
            onsetEnvelope.add(flux)
            previousSpectrum = magnitudes
        }
        
        // Find peaks in onset envelope
        val peaks = mutableListOf<Int>()
        for (i in 1 until onsetEnvelope.size - 1) {
            if (onsetEnvelope[i] > onsetEnvelope[i-1] && onsetEnvelope[i] > onsetEnvelope[i+1]) {
                peaks.add(i)
            }
        }
        
        // Calculate tempo from peak intervals
        return if (peaks.size > 1) {
            val intervals = peaks.zipWithNext { a, b -> b - a }
            val averageInterval = intervals.average().toFloat()
            60f * sampleRate / (hopLength * averageInterval)
        } else {
            120f // Default tempo if no clear peaks found
        }
    }

    private fun extractSpectralFeatures(samples: FloatArray, sampleRate: Float): SpectralFeatures {
        // FFT requires a fixed-size buffer (N_FFT). If our input is larger,
        // we'll analyze just the first N_FFT samples to prevent buffer overflow.
        // This is a common practice in audio analysis where we process chunks
        // of consistent size rather than variable-length segments.
        val windowed = if (samples.size > N_FFT) {
            // If samples are larger than FFT size, take the first N_FFT samples
            applyHannWindow(samples.copyOf(N_FFT))
        } else {
            applyHannWindow(samples)
        }
        
        // Create padded array for FFT, ensuring we don't exceed N_FFT size
        // Zero padding is automatic since FloatArray initializes with zeros
        val paddedSamples = FloatArray(N_FFT).also { padded ->
            windowed.copyInto(padded, 0, 0, minOf(windowed.size, N_FFT))
        }

        // Perform FFT
        val fft = FFT(N_FFT)
        fft.realForward(paddedSamples)

        // Calculate magnitude spectrum (only need first half due to symmetry)
        // Add 1 to include both DC (0 Hz) and Nyquist frequency components
        val magnitudeSpectrum = FloatArray(N_FFT / 2 + 1)
        for (i in 0 until N_FFT / 2) {  // Since we're only going up to N_FFT/2, the check is unnecessary
            val re = paddedSamples[2 * i]
            val im = paddedSamples[2 * i + 1]  // This will always be within bounds
            magnitudeSpectrum[i] = sqrt(re * re + im * im)
        }
        // Handle Nyquist frequency component separately
        magnitudeSpectrum[N_FFT / 2] = abs(paddedSamples[1])

        // Compute power spectrum for spectral flatness
        val powerSpectrum = magnitudeSpectrum.map { it * it }.toFloatArray()

        // Compute spectral features
        val centroid = computeSpectralCentroid(magnitudeSpectrum, sampleRate)
        val flatness = computeSpectralFlatness(powerSpectrum)
        val rollOff = computeSpectralRollOff(magnitudeSpectrum, sampleRate)
        val bandwidth = computeSpectralBandwidth(magnitudeSpectrum, sampleRate, centroid)

        return SpectralFeatures(
            centroid = centroid,
            flatness = flatness,
            rollOff = rollOff,
            bandwidth = bandwidth
        )
    }

    private fun computeSpectralCentroid(magnitudeSpectrum: FloatArray, sampleRate: Float): Float {
        val sum = magnitudeSpectrum.sum()
        if (sum == 0f) return 0f
        
        val weightedSum = magnitudeSpectrum.mapIndexed { index, value -> 
            index * (sampleRate / N_FFT) * value 
        }.sum()
        
        return weightedSum / sum
    }

    private fun computeSpectralFlatness(powerSpectrum: FloatArray): Float {
        // Calculate geometric mean using log-space to avoid numerical issues
        var sumLogValues = 0.0f
        for (value in powerSpectrum) {
            sumLogValues += ln(value + 1e-10f) // Add small epsilon to avoid log(0)
        }
        val geometricMean = exp(sumLogValues / powerSpectrum.size)
        
        // Calculate arithmetic mean
        val arithmeticMean = powerSpectrum.sum() / powerSpectrum.size
        
        return if (arithmeticMean != 0f) geometricMean / arithmeticMean else 0f
    }

    private fun computeSpectralRollOff(magnitudeSpectrum: FloatArray, sampleRate: Float): Float {
        val totalEnergy = magnitudeSpectrum.sum()
        var cumulativeEnergy = 0f
        val rollOffThreshold = totalEnergy * 0.85f
        
        for ((index, value) in magnitudeSpectrum.withIndex()) {
            cumulativeEnergy += value
            if (cumulativeEnergy >= rollOffThreshold) {
                return index * (sampleRate / N_FFT)
            }
        }
        
        return 0f
    }

    private fun computeSpectralBandwidth(
        magnitudeSpectrum: FloatArray, 
        sampleRate: Float,
        centroid: Float
    ): Float {
        val sum = magnitudeSpectrum.sum()
        if (sum == 0f) return 0f
        
        // Match iOS frequency calculation
        val weightedSum = magnitudeSpectrum.mapIndexed { index, value -> 
            val freq = index * sampleRate / (2 * magnitudeSpectrum.size)
            value * (freq - centroid).pow(2)
        }.sum()
        
        return sqrt(weightedSum / sum)
    }

    private data class SpectralFeatures(
        val centroid: Float = 0f,
        val flatness: Float = 0f,
        val rollOff: Float = 0f,
        val bandwidth: Float = 0f
    )

    /**
     * Resets the segment data.
     * @param sumSquaresUpdater Function to reset sum of squares.
     * @param zeroCrossingsUpdater Function to reset zero crossings.
     * @param localMinAmplitudeUpdater Function to reset local min amplitude.
     * @param localMaxAmplitudeUpdater Function to reset local max amplitude.
     * @param segmentData The segment data list to reset.
     */
    private fun resetSegmentData(
        sumSquaresUpdater: (Float) -> Unit,
        zeroCrossingsUpdater: (Int) -> Unit,
        localMinAmplitudeUpdater: (Float) -> Unit,
        localMaxAmplitudeUpdater: (Float) -> Unit,
        segmentData: MutableList<Float>
    ) {
        sumSquaresUpdater(0f)
        zeroCrossingsUpdater(0)
        localMinAmplitudeUpdater(Float.MAX_VALUE)
        localMaxAmplitudeUpdater(Float.MIN_VALUE)
        segmentData.clear()
    }

    /**
     * Computes the MFCC (Mel-Frequency Cepstral Coefficients) from the audio data.
     */
    private fun computeMFCC(samples: FloatArray, sampleRate: Float): List<Float> {
        val (powerSpectrum, _) = prepareFFT(samples, sampleRate)
        val melFilters = computeMelFilterbank(
            numFilters = 26,
            powerSpectrumSize = powerSpectrum.size,
            sampleRate = sampleRate
        )

        if (melFilters.any { it.size != powerSpectrum.size }) {
            LogUtils.e(CLASS_NAME, "Mel filter size (${melFilters[0].size}) does not match power spectrum size (${powerSpectrum.size})")
            return emptyList()
        }

        val melEnergies = FloatArray(26) { i ->
            var energy = 0f
            for (j in powerSpectrum.indices) {
                energy += powerSpectrum[j] * melFilters[i][j]
            }
            ln(maxOf(energy, 1e-10f))
        }

        val mfcc = FloatArray(13) { i ->
            var sum = 0f
            for (j in melEnergies.indices) {
                sum += melEnergies[j] * cos(PI * i * (2 * j + 1) / (2 * 26)).toFloat()
            }
            sum * sqrt(2f / 26)
        }

        return mfcc.toList()
    }

    /**
     * Computes the Mel filter bank.
     * @param numFilters The number of Mel filters.
     * @param powerSpectrumSize The size of the power spectrum.
     * @param sampleRate The sample rate of the audio data.
     * @return A list of Mel filters.
     */
    private fun computeMelFilterbank(numFilters: Int, powerSpectrumSize: Int, sampleRate: Float): Array<FloatArray> {
        val fMin = 0f
        val fMax = sampleRate / 2

        // Convert Hz to Mel
        val melMin = hzToMel(fMin)
        val melMax = hzToMel(fMax)

        // Create equally spaced points in Mel scale
        val melPoints = FloatArray(numFilters + 2)
        val melStep = (melMax - melMin) / (numFilters + 1)
        for (i in melPoints.indices) {
            melPoints[i] = melMin + i * melStep
        }

        // Convert back to Hz
        val hzPoints = melPoints.map { melToHz(it) }

        // Convert to FFT bin numbers, clamping to valid range
        val bins = hzPoints.map { minOf((it * powerSpectrumSize / sampleRate).roundToInt(), powerSpectrumSize - 1) }.toList()

        // Create the filterbank matrix with size matching powerSpectrumSize
        val filterbank = Array(numFilters) { FloatArray(powerSpectrumSize) { 0f } }

        // Ensure safe access to bins by limiting the loop and checking boundaries
        for (i in 0 until numFilters) {
            if (i + 2 < bins.size) { // Check to prevent out-of-bounds access
                val startBin = bins[i]
                val centerBin = bins[i + 1]
                val endBin = bins[i + 2]

                // Left slope (ascending triangle)
                if (centerBin > startBin) {
                    for (j in startBin until centerBin) {
                        filterbank[i][j] = (j - startBin).toFloat() / (centerBin - startBin).toFloat()
                    }
                }
                // Right slope (descending triangle)
                if (endBin > centerBin) {
                    for (j in centerBin until endBin) {
                        filterbank[i][j] = (endBin - j).toFloat() / (endBin - centerBin).toFloat()
                    }
                }
            }
        }

        return filterbank
    }

    /**
     * Computes the Discrete Cosine Transform (DCT) of the log energies.
     * @param logEnergies The log energies.
     * @param numCoefficients The number of coefficients to compute.
     * @return A list of MFCC coefficients.
     */
    private fun computeDCT(logEnergies: List<Float>, numCoefficients: Int): List<Float> {
        val n = logEnergies.size
        val dct = FloatArray(numCoefficients)

        for (i in 0 until numCoefficients) {
            var sum = 0.0
            for (j in logEnergies.indices) {
                sum += logEnergies[j] * cos(PI * i * (j + 0.5) / n)
            }
            dct[i] = (sum / sqrt(DCT_SQRT_DIVISOR * n)).toFloat()
        }

        return dct.toList()
    }

    /**
     * Extracts the HNR (Harmonics-to-Noise Ratio) from the audio data.
     * @param segmentData The segment data.
     * @return The HNR.
     */
    private fun extractHNR(segmentData: FloatArray): Float {
        val frameSize = segmentData.size
        val autocorrelation = FloatArray(frameSize)

        // Compute the autocorrelation of the segment data
        for (i in segmentData.indices) {
            var sum = 0f
            for (j in 0 until frameSize - i) {
                sum += segmentData[j] * segmentData[j + i]
            }
            autocorrelation[i] = sum
        }

        // Find peaks with minimum prominence
        val maxAutocorrelation = autocorrelation.maxOrNull() ?: 0f
        val peaks = findPeaks(autocorrelation, minProminence = 0.1f * maxAutocorrelation)
        
        if (peaks.isNotEmpty()) {
            val firstPeakIndex = peaks.firstOrNull { it > 0 } ?: 0
            val harmonicEnergy = autocorrelation[firstPeakIndex]
            val noiseEnergy = autocorrelation[0] - harmonicEnergy
            if (noiseEnergy > 0) {
                return 10 * log10(harmonicEnergy / noiseEnergy)
            }
        }
        
        return 0f
    }

    private fun findPeaks(data: FloatArray, minProminence: Float): List<Int> {
        val peaks = mutableListOf<Int>()
        for (i in 1 until data.size - 1) {
            if (data[i] > data[i - 1] && data[i] > data[i + 1]) {
                val prominence = data[i] - maxOf(data[i - 1], data[i + 1])
                if (prominence >= minProminence) {
                    peaks.add(i)
                }
            }
        }
        return peaks
    }

    fun loadAudioFromAnyFormat(fileUri: String, decodingConfig: DecodingConfig? = null): AudioData? {
        val cleanUri = fileUri.removePrefix("file://")
        val file = File(cleanUri).takeIf { it.exists() } ?: File(filesDir, File(cleanUri).name).takeIf { it.exists() }
            ?: run {
                LogUtils.e(CLASS_NAME, "File not found in any location: $cleanUri")
                return null
            }

        // First try MediaExtractor
        val extractor = MediaExtractor()
        try {
            LogUtils.d(CLASS_NAME, "Attempting MediaExtractor with path: ${file.absolutePath}")
            extractor.setDataSource(file.absolutePath)
            
            // Find the first audio track
            val audioTrackIndex = (0 until extractor.trackCount)
                .find { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
            
            if (audioTrackIndex != null) {
                val format = extractor.getTrackFormat(audioTrackIndex)
                extractor.selectTrack(audioTrackIndex)

                // Get original audio properties
                val originalSampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                val originalChannels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                val totalDurationUs = try {
                    format.getLong(MediaFormat.KEY_DURATION)
                } catch (e: Exception) {
                    (format.getString(MediaFormat.KEY_DURATION) ?: "-1").toLong()
                }
                LogUtils.d(CLASS_NAME, "Raw duration from format: ${totalDurationUs}us")
                
                val totalDurationMs = totalDurationUs / 1000
                LogUtils.d(CLASS_NAME, "Final duration: ${totalDurationMs}ms")

                // Process using MediaExtractor
                val pcmData = decodeAudioToPCM(extractor, format)
                val processedData = if (decodingConfig != null) {
                    processAudio(
                        pcmData,
                        originalSampleRate,
                        decodingConfig.targetSampleRate,
                        originalChannels,
                        decodingConfig.targetChannels,
                        decodingConfig.normalizeAudio
                    )
                } else {
                    pcmData
                }

                return AudioData(
                    data = processedData,
                    sampleRate = decodingConfig?.targetSampleRate ?: originalSampleRate,
                    bitDepth = decodingConfig?.targetBitDepth ?: 16,
                    channels = decodingConfig?.targetChannels ?: originalChannels,
                    durationMs = totalDurationMs  // Pass through the duration
                )
            }
        } catch (e: Exception) {
            LogUtils.d(CLASS_NAME, "MediaExtractor failed, attempting WAV parser: ${e.message}")
        } finally {
            extractor.release()
        }

        // If MediaExtractor failed and file is WAV, try WAV parser
        if (file.name.lowercase().endsWith(".wav")) {
            LogUtils.d(CLASS_NAME, "Falling back to WAV parser")
            return loadAudioFile(file.absolutePath)?.let { wavData ->
                if (decodingConfig != null) {
                    val processedData = processAudio(
                        wavData.data,
                        wavData.sampleRate,
                        decodingConfig.targetSampleRate,
                        wavData.channels,
                        decodingConfig.targetChannels,
                        decodingConfig.normalizeAudio
                    )
                    AudioData(
                        data = processedData,
                        sampleRate = decodingConfig.targetSampleRate ?: wavData.sampleRate,
                        bitDepth = decodingConfig.targetBitDepth,
                        channels = decodingConfig.targetChannels ?: wavData.channels,
                        durationMs = wavData.durationMs  // Pass through the duration
                    )
                } else {
                    wavData
                }
            }
        }

        LogUtils.e(CLASS_NAME, "Failed to process audio file with both MediaExtractor and WAV parser")
        return null
    }

    private fun decodeAudioToPCM(extractor: MediaExtractor, format: MediaFormat): ByteArray {
        var decoder: MediaCodec? = null
        
        try {
            decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            decoder.configure(format, null, null, 0)
            decoder.start()

            val info = MediaCodec.BufferInfo()
            val pcmData = mutableListOf<Byte>()

            var isEOS = false
            while (!isEOS) {
                val inputBufferId = decoder.dequeueInputBuffer(10000)
                if (inputBufferId >= 0) {
                    val inputBuffer = decoder.getInputBuffer(inputBufferId)!!
                    val sampleSize = extractor.readSampleData(inputBuffer, 0)

                    if (sampleSize < 0) {
                        decoder.queueInputBuffer(inputBufferId, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        isEOS = true
                    } else {
                        decoder.queueInputBuffer(inputBufferId, 0, sampleSize, extractor.sampleTime, 0)
                        extractor.advance()
                    }
                }

                val outputBufferId = decoder.dequeueOutputBuffer(info, 10000)
                if (outputBufferId >= 0) {
                    val outputBuffer = decoder.getOutputBuffer(outputBufferId)!!
                    val chunk = ByteArray(info.size)
                    outputBuffer.get(chunk)
                    pcmData.addAll(chunk.toList())
                    decoder.releaseOutputBuffer(outputBufferId, false)
                }
            }

            return pcmData.toByteArray()
        } finally {
            try {
                decoder?.stop()
            } catch (e: Exception) {
                LogUtils.w(CLASS_NAME, "Error stopping decoder: ${e.message}")
            }
            try {
                decoder?.release()
            } catch (e: Exception) {
                LogUtils.w(CLASS_NAME, "Error releasing decoder: ${e.message}")
            }
        }
    }

    private fun resampleAudio(
        pcmData: ByteArray,
        originalSampleRate: Int,
        targetSampleRate: Int,
        originalChannels: Int
    ): ByteArray {
        // Convert byte array to short array (16-bit samples)
        val shortArray = ShortArray(pcmData.size / 2)
        ByteBuffer.wrap(pcmData).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(shortArray)

        // Convert to mono if needed
        val monoShortArray = if (originalChannels > 1) {
            convertToMono(shortArray, originalChannels)
        } else {
            shortArray
        }

        // Resample
        val resampleRatio = targetSampleRate.toDouble() / originalSampleRate
        val newLength = (monoShortArray.size * resampleRatio).toInt()
        val resampledArray = ShortArray(newLength)

        for (i in resampledArray.indices) {
            val originalIndex = (i / resampleRatio).toInt()
            val nextIndex = minOf(originalIndex + 1, monoShortArray.size - 1)
            val fraction = (i / resampleRatio) - originalIndex

            // Linear interpolation
            val sample = linearInterpolate(
                monoShortArray[originalIndex].toDouble(),
                monoShortArray[nextIndex].toDouble(),
                fraction
            ).toInt().toShort()

            resampledArray[i] = sample
        }

        // Convert back to byte array
        val resultBuffer = ByteBuffer.allocate(resampledArray.size * 2)
        resultBuffer.order(ByteOrder.LITTLE_ENDIAN)
        resultBuffer.asShortBuffer().put(resampledArray)
        return resultBuffer.array()
    }

    private fun convertToMono(stereoData: ShortArray, channels: Int): ShortArray {
        val monoLength = stereoData.size / channels
        val monoData = ShortArray(monoLength)

        for (i in 0 until monoLength) {
            var sum = 0
            for (ch in 0 until channels) {
                sum += stereoData[i * channels + ch]
            }
            monoData[i] = (sum / channels).toShort()
        }

        return monoData
    }

    private fun linearInterpolate(a: Double, b: Double, fraction: Double): Double {
        return a + fraction * (b - a)
    }

    fun processAudio(
        pcmData: ByteArray,
        originalSampleRate: Int,
        targetSampleRate: Int?,
        originalChannels: Int,
        targetChannels: Int?,
        normalize: Boolean
    ): ByteArray {
        var processedData = pcmData

        // Only resample if target sample rate is explicitly specified and different
        if (targetSampleRate != null && originalSampleRate != targetSampleRate) {
            processedData = resampleAudio(processedData, originalSampleRate, targetSampleRate, originalChannels)
        }

        // Only convert channels if target channels is explicitly specified and different
        if (targetChannels != null && originalChannels != targetChannels) {
            processedData = convertChannels(processedData, originalChannels, targetChannels)
        }

        // Only normalize if explicitly requested
        if (normalize) {
            processedData = normalizeAudio(processedData)
        }

        return processedData
    }

    private fun normalizeAudio(pcmData: ByteArray): ByteArray {
        val shorts = ShortArray(pcmData.size / 2)
        ByteBuffer.wrap(pcmData).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(shorts)

        // Find maximum amplitude
        var maxAmplitude = 0
        for (sample in shorts) {
            maxAmplitude = maxOf(maxAmplitude, abs(sample.toInt()))
        }

        // Normalize if we found a non-zero maximum
        if (maxAmplitude > 0) {
            val normalizationFactor = Short.MAX_VALUE.toFloat() / maxAmplitude
            for (i in shorts.indices) {
                shorts[i] = (shorts[i] * normalizationFactor).toInt().toShort()
            }
        }

        // Convert back to bytes
        val resultBuffer = ByteBuffer.allocate(shorts.size * 2)
        resultBuffer.order(ByteOrder.LITTLE_ENDIAN)
        resultBuffer.asShortBuffer().put(shorts)
        return resultBuffer.array()
    }

    private fun convertChannels(pcmData: ByteArray, originalChannels: Int, targetChannels: Int): ByteArray {
        // Use the correct implementation from AudioFormatUtils
        // Assuming 16-bit audio (which is the default for most audio processing)
        return AudioFormatUtils.convertChannels(pcmData, originalChannels, targetChannels, 16)
    }

    private fun debugWavHeader(file: File) {
        try {
            val bytes = ByteArray(44) // Standard WAV header size
            RandomAccessFile(file, "r").use { raf ->
                raf.readFully(bytes)
            }
            
            LogUtils.d(CLASS_NAME, "WAV Header Bytes: ${bytes.joinToString(", ") { String.format("%02X", it) }}")
            LogUtils.d(CLASS_NAME, "ASCII: ${bytes.map { it.toInt().toChar() }.joinToString("")}")
            
            val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            LogUtils.d(CLASS_NAME, """
                RIFF header: ${String(bytes, 0, 4)}
                File size: ${buffer.getInt(4)}
                WAVE header: ${String(bytes, 8, 4)}
                fmt  header: ${String(bytes, 12, 4)}
                Chunk size: ${buffer.getInt(16)}
                Audio format: ${buffer.getShort(20)}
                Channels: ${buffer.getShort(22)}
                Sample rate: ${buffer.getInt(24)}
                Byte rate: ${buffer.getInt(28)}
                Block align: ${buffer.getShort(32)}
                Bits per sample: ${buffer.getShort(34)}
            """.trimIndent())
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to debug WAV header: ${e.message}", e)
        }
    }

    fun generatePreviewBars(
        audioData: AudioData,
        numberOfBars: Int,
        startTimeMs: Long? = null,
        endTimeMs: Long? = null,
        silenceRmsThreshold: Float = 0.01f
    ): Map<String, Any> {
        val totalDurationMs = audioData.durationMs
        val requestedBars = numberOfBars.coerceAtLeast(1)

        if (startTimeMs != null) {
            require(startTimeMs >= 0) { "startTimeMs must be non-negative, got: $startTimeMs" }
            require(startTimeMs <= totalDurationMs) { "startTimeMs ($startTimeMs) is beyond audio duration ($totalDurationMs)" }
        }
        if (endTimeMs != null) {
            require(endTimeMs >= 0) { "endTimeMs must be non-negative, got: $endTimeMs" }
            if (startTimeMs != null) {
                require(startTimeMs < endTimeMs) { "startTimeMs ($startTimeMs) must be less than endTimeMs ($endTimeMs)" }
            }
        }

        val effectiveStartMs = startTimeMs ?: 0L
        val effectiveEndMs = (endTimeMs ?: totalDurationMs).coerceAtMost(totalDurationMs)
        val durationMs = (effectiveEndMs - effectiveStartMs).coerceAtLeast(1L)
        val bytesPerSample = (audioData.bitDepth / 8).coerceAtLeast(1)
        val bytesPerFrame = (bytesPerSample * audioData.channels).coerceAtLeast(1)
        val totalFrames = audioData.data.size / bytesPerFrame
        val startFrameIndex = ((effectiveStartMs * audioData.sampleRate) / 1000)
            .toInt()
            .coerceIn(0, totalFrames)
        val endFrameIndex = ((effectiveEndMs * audioData.sampleRate) / 1000)
            .toInt()
            .coerceIn(startFrameIndex, totalFrames)
        val framesInRange = endFrameIndex - startFrameIndex
        require(framesInRange > 0) { "Invalid sample range: contains no samples" }

        val framesPerBar = (framesInRange / requestedBars).coerceAtLeast(1)
        val bars = mutableListOf<Map<String, Any>>()
        var minAmplitude = Float.MAX_VALUE
        var maxAmplitude = Float.NEGATIVE_INFINITY
        var minRms = Float.MAX_VALUE
        var maxRms = Float.NEGATIVE_INFINITY

        val extractionTimeMs = measureTimeMillis {
            for (i in 0 until requestedBars) {
                val barStartFrame = startFrameIndex + (i * framesPerBar)
                val barEndFrame = minOf(startFrameIndex + ((i + 1) * framesPerBar), endFrameIndex)
                if (barStartFrame >= barEndFrame) break

                val barStartByte = barStartFrame * bytesPerFrame
                val barEndByte = minOf(barEndFrame * bytesPerFrame, audioData.data.size)
                val segmentBytes = audioData.data.sliceArray(barStartByte until barEndByte)
                val segmentData = when (audioData.bitDepth) {
                    16 -> convert16BitPcmToFloat(segmentBytes)
                    32 -> convert32BitPcmToFloat(segmentBytes)
                    else -> convert8BitPcmToFloat(segmentBytes)
                }
                if (segmentData.isEmpty()) continue

                val rms = sqrt(segmentData.map { it * it }.average().toFloat())
                val amplitude = segmentData.maxOf { abs(it) }
                minAmplitude = minOf(minAmplitude, amplitude)
                maxAmplitude = maxOf(maxAmplitude, amplitude)
                minRms = minOf(minRms, rms)
                maxRms = maxOf(maxRms, rms)

                val startBarTimeMs = ((barStartFrame - startFrameIndex).toDouble() / framesInRange.toDouble() * durationMs).toLong()
                val endBarTimeMs = ((barEndFrame - startFrameIndex).toDouble() / framesInRange.toDouble() * durationMs).toLong()
                bars.add(mapOf(
                    "id" to i,
                    "amplitude" to amplitude.coerceIn(0f, 1f),
                    "rms" to rms.coerceIn(0f, 1f),
                    "silent" to (rms < silenceRmsThreshold),
                    "startTimeMs" to startBarTimeMs,
                    "endTimeMs" to endBarTimeMs.coerceAtLeast(startBarTimeMs)
                ))
            }
        }

        if (bars.isEmpty()) {
            throw IllegalStateException("No preview bars were generated")
        }

        return mapOf(
            "bars" to bars,
            "durationMs" to durationMs.toInt(),
            "sampleRate" to audioData.sampleRate,
            "numberOfChannels" to audioData.channels,
            "bitDepth" to audioData.bitDepth,
            "samples" to framesInRange,
            "requestedNumberOfBars" to requestedBars,
            "barDurationMs" to (durationMs.toDouble() / bars.size.toDouble()),
            "amplitudeRange" to mapOf("min" to minAmplitude, "max" to maxAmplitude),
            "rmsRange" to mapOf("min" to minRms, "max" to maxRms),
            "extractionTimeMs" to extractionTimeMs.toFloat()
        )
    }

    fun generatePreview(
        audioData: AudioData,
        numberOfPoints: Int,
        startTimeMs: Long? = null,
        endTimeMs: Long? = null,
        config: RecordingConfig
    ): AudioAnalysisData {
        val totalDurationMs = audioData.durationMs
        
        LogUtils.d(CLASS_NAME, "Total audio duration: ${totalDurationMs}ms")
        
        // Validate time range
        if (startTimeMs != null) {
            require(startTimeMs >= 0) { "startTime must be non-negative, got: $startTimeMs" }
            require(startTimeMs <= totalDurationMs) { "startTime ($startTimeMs) is beyond audio duration ($totalDurationMs)" }
        }
        
        if (endTimeMs != null) {
            require(endTimeMs >= 0) { "endTime must be non-negative, got: $endTimeMs" }
            if (endTimeMs > totalDurationMs) {
                LogUtils.w(CLASS_NAME, "endTime ($endTimeMs) is beyond audio duration ($totalDurationMs), clamping to duration")
            }
            if (startTimeMs != null) {
                require(startTimeMs < endTimeMs) { "startTime ($startTimeMs) must be less than endTime ($endTimeMs)" }
            }
        }
        
        // Calculate effective range
        val effectiveStartMs = startTimeMs ?: 0L
        val effectiveEndMs = (endTimeMs ?: totalDurationMs).coerceAtMost(totalDurationMs)
        val durationMs = effectiveEndMs - effectiveStartMs
        
        LogUtils.d(CLASS_NAME, "Preview range: ${effectiveStartMs}ms to ${effectiveEndMs}ms (${durationMs}ms)")
        
        // Calculate sample range
        val startSampleIndex = ((effectiveStartMs * audioData.sampleRate) / 1000).toInt()
        val endSampleIndex = ((effectiveEndMs * audioData.sampleRate) / 1000).toInt().coerceAtMost(audioData.data.size)
        val samplesInRange = endSampleIndex - startSampleIndex
        
        if (samplesInRange <= 0) {
            throw IllegalArgumentException("Invalid sample range: contains no samples")
        }
        
        val samplesPerPoint = (samplesInRange / numberOfPoints).coerceAtLeast(1)
        val pointsPerSecond = numberOfPoints.toDouble() / (durationMs.toDouble() / 1000.0)
        
        val dataPoints = mutableListOf<DataPoint>()
        var minAmplitude = Float.MAX_VALUE
        var maxAmplitude = Float.MIN_VALUE
        var minRms = Float.MAX_VALUE      // Add minRms
        var maxRms = Float.MIN_VALUE      // Add maxRms
        
        val extractionTimeMs = measureTimeMillis {
            for (i in 0 until numberOfPoints) {
                val pointStartSample = startSampleIndex + (i * samplesPerPoint)
                val pointEndSample = minOf(startSampleIndex + ((i + 1) * samplesPerPoint), endSampleIndex)
                
                if (pointStartSample >= pointEndSample) break
                
                try {
                    val segmentBytes = audioData.data.sliceArray(pointStartSample until pointEndSample)
                    
                    // Convert PCM bytes to float samples with proper bit depth handling
                    val segmentData = when (audioData.bitDepth) {
                        16 -> convert16BitPcmToFloat(segmentBytes)
                        32 -> convert32BitPcmToFloat(segmentBytes)
                        else -> convert8BitPcmToFloat(segmentBytes)
                    }
                    
                    // Calculate time points based on actual sample rate
                    val startTimePoint = ((pointStartSample * 1000L) / (audioData.sampleRate * audioData.channels)).toFloat()
                    val endTimePoint = ((pointEndSample * 1000L) / (audioData.sampleRate * audioData.channels)).toFloat()
                    
                    val rms = sqrt(segmentData.map { it * it }.average().toFloat())
                    val amplitude = segmentData.maxOf { abs(it) }  // Always use peak amplitude
                    
                    minAmplitude = minOf(minAmplitude, amplitude)
                    maxAmplitude = maxOf(maxAmplitude, amplitude)
                    minRms = minOf(minRms, rms)
                    maxRms = maxOf(maxRms, rms)
                    
                    dataPoints.add(DataPoint(
                        id = i.toLong(),
                        amplitude = amplitude,  // Peak amplitude
                        rms = rms,             // RMS value
                        dB = 20 * log10(amplitude.toDouble()).toFloat(),
                        silent = amplitude < 0.01,
                        features = null,
                        speech = null,
                        startTime = startTimePoint,
                        endTime = endTimePoint,
                        startPosition = pointStartSample,
                        endPosition = pointEndSample,
                        samples = segmentData.size
                    ))
                } catch (e: Exception) {
                    LogUtils.e(CLASS_NAME, "Error processing segment $i: ${e.message}")
                    throw IllegalStateException("Failed to process audio segment: ${e.message}", e)
                }
            }
        }
        
        if (dataPoints.isEmpty()) {
            throw IllegalStateException("No data points were generated")
        }
        
        return AudioAnalysisData(
            segmentDurationMs = config.segmentDurationMs,
            durationMs = durationMs.toInt(),
            bitDepth = audioData.bitDepth,
            numberOfChannels = audioData.channels,
            sampleRate = audioData.sampleRate,
            samples = samplesInRange,
            dataPoints = dataPoints,
            amplitudeRange = AudioAnalysisData.AmplitudeRange(minAmplitude, maxAmplitude),
            rmsRange = AudioAnalysisData.AmplitudeRange(minRms, maxRms),
            extractionTimeMs = extractionTimeMs.toFloat()
        )
    }

    // Add these conversion helpers
    private fun convert16BitPcmToFloat(bytes: ByteArray): FloatArray {
        val shorts = ShortArray(bytes.size / 2)
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(shorts)
        return shorts.map { it.toFloat() / Short.MAX_VALUE }.toFloatArray()
    }

    private fun convert32BitPcmToFloat(bytes: ByteArray): FloatArray {
        val ints = IntArray(bytes.size / 4)
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asIntBuffer().get(ints)
        return ints.map { it.toFloat() / Int.MAX_VALUE }.toFloatArray()
    }

    private fun convert8BitPcmToFloat(bytes: ByteArray): FloatArray {
        return bytes.map { (it.toInt() - 128).toFloat() / 127f }.toFloatArray()
    }

    fun loadAudioRange(fileUri: String, startTimeMs: Long, endTimeMs: Long, config: DecodingConfig? = null): AudioData? {
        try {
            // Use default config if none provided
            val effectiveConfig = config ?: DecodingConfig(
                targetSampleRate = null,
                targetChannels = null,
                targetBitDepth = 16,
                normalizeAudio = false
            )

            // First check if it's a WAV file by extension
            val isWavByExtension = fileUri.lowercase().endsWith(".wav")
            
            // Then verify WAV header if needed
            val headerSize = if (isWavByExtension) {
                getWavHeaderSize(fileUri)
            } else null
            
            // If it's a WAV file (by extension and header verification)
            return if (isWavByExtension && headerSize != null) {
                LogUtils.d(CLASS_NAME, "Loading WAV range with header size: $headerSize bytes")
                loadWavRange(fileUri, startTimeMs, endTimeMs, effectiveConfig, headerSize)
            } else {
                if (isWavByExtension) {
                    LogUtils.w(CLASS_NAME, "File has .wav extension but invalid header, falling back to compressed loader")
                }
                LogUtils.d(CLASS_NAME, "Loading compressed audio range")
                loadCompressedAudioRange(fileUri, startTimeMs, endTimeMs, effectiveConfig)
            }
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to load audio range: ${e.message}", e)
            return null
        }
    }

    private fun loadWavRange(
        fileUri: String,
        startTimeMs: Long,
        endTimeMs: Long,
        config: DecodingConfig,
        headerSize: Int
    ): AudioData? {
        try {
            val file = File(fileUri.removePrefix("file://")).takeIf { it.exists() }
                ?: File(filesDir, File(fileUri).name).takeIf { it.exists() }
                ?: throw IllegalArgumentException("File not found: $fileUri")

            // Use existing method to get audio format
            val format = getAudioFormat(fileUri) ?: throw IllegalArgumentException("Could not determine audio format")
            
            val bytesPerSecond = format.sampleRate * format.channels * (format.bitDepth / 8)
            val startByteOffset = ((startTimeMs * bytesPerSecond) / 1000).toInt()
            val endByteOffset = ((endTimeMs * bytesPerSecond) / 1000).toInt()
            
            val startByte = headerSize + startByteOffset
            val endByte = headerSize + endByteOffset

            LogUtils.d(CLASS_NAME, """
                Loading WAV range:
                - headerSize: $headerSize
                - startByte: $startByte
                - endByte: $endByte
                - bytesPerSecond: $bytesPerSecond
            """.trimIndent())

            var audioDataBytes = ByteArray((endByte - startByte).coerceAtLeast(0))
            FileInputStream(file).use { fis ->
                fis.skip(startByte.toLong())
                fis.read(audioDataBytes)
            }

            // Apply bit depth conversion if needed
            var effectiveBitDepth = format.bitDepth
            if (config.targetBitDepth != format.bitDepth) {
                audioDataBytes = AudioFormatUtils.convertBitDepth(
                    audioDataBytes,
                    format.bitDepth,
                    config.targetBitDepth
                )
                effectiveBitDepth = config.targetBitDepth
                LogUtils.d(CLASS_NAME, "Converted bit depth from ${format.bitDepth} to ${config.targetBitDepth}")
            }

            return AudioData(
                data = audioDataBytes,
                sampleRate = format.sampleRate,
                channels = format.channels,
                bitDepth = effectiveBitDepth,
                durationMs = endTimeMs - startTimeMs
            )
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to load WAV range: ${e.message}", e)
            return null
        }
    }

    private fun loadCompressedAudioRange(
        fileUri: String,
        startTimeMs: Long,
        endTimeMs: Long,
        config: DecodingConfig
    ): AudioData? {
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        
        try {
            extractor.setDataSource(fileUri.removePrefix("file://"))
            val format = extractor.getTrackFormat(0)
            extractor.selectTrack(0)

            val originalSampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            val originalChannels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            val totalDurationUs = try {
                format.getLong(MediaFormat.KEY_DURATION)
            } catch (e: Exception) {
                (format.getString(MediaFormat.KEY_DURATION) ?: "-1").toLong()
            }
            LogUtils.d(CLASS_NAME, "Raw duration from format: ${totalDurationUs}us")
            
            val totalDurationMs = totalDurationUs / 1000
            LogUtils.d(CLASS_NAME, "Final duration: ${totalDurationMs}ms")

            // Calculate valid time range
            val validStartMs = startTimeMs.coerceIn(0, totalDurationMs) ?: 0
            val validEndMs = endTimeMs.coerceIn(validStartMs, totalDurationMs) ?: totalDurationMs
            val effectiveDurationMs = validEndMs - validStartMs

            // Initialize decoder
            decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            decoder.configure(format, null, null, 0)
            decoder.start()

            // Seek to start position if needed
            if (validStartMs > 0) {
                extractor.seekTo(validStartMs * 1000, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
            }

            // Calculate buffer sizes
            val targetSampleRate = config.targetSampleRate ?: originalSampleRate
            val targetChannels = config.targetChannels ?: originalChannels
            val targetBitDepth = config.targetBitDepth ?: 16
            val bytesPerSample = targetBitDepth / 8
            val samplesPerSecond = targetSampleRate * targetChannels
            val totalBytes = (effectiveDurationMs * samplesPerSecond * bytesPerSample) / 1000

            LogUtils.d(CLASS_NAME, """
                Loading audio range:
                - start: ${validStartMs}ms
                - end: ${validEndMs}ms
                - duration: ${effectiveDurationMs}ms
                - bytes: $totalBytes
                - format: ${targetSampleRate}Hz, $targetChannels channels, $targetBitDepth-bit
            """.trimIndent())

            val outputBuffer = ByteBuffer.allocate(totalBytes.toInt())
            val bufferInfo = MediaCodec.BufferInfo()
            var isEOS = false
            
            while (!isEOS) {
                // Handle input
                val inputBufferId = decoder.dequeueInputBuffer(10000)
                if (inputBufferId >= 0) {
                    val inputBuffer = decoder.getInputBuffer(inputBufferId)!!
                    val sampleSize = extractor.readSampleData(inputBuffer, 0)
                    
                    when {
                        sampleSize < 0 -> {
                            decoder.queueInputBuffer(inputBufferId, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            isEOS = true
                        }
                        extractor.sampleTime > validEndMs * 1000 -> {
                            decoder.queueInputBuffer(inputBufferId, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            isEOS = true
                        }
                        else -> {
                            decoder.queueInputBuffer(inputBufferId, 0, sampleSize, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }

                // Handle output
                val outputBufferId = decoder.dequeueOutputBuffer(bufferInfo, 10000)
                if (outputBufferId >= 0) {
                    val decodedBuffer = decoder.getOutputBuffer(outputBufferId)!!
                    if (bufferInfo.size > 0) {
                        // Set buffer position and limit based on the decoded data
                        decodedBuffer.position(bufferInfo.offset)
                        decodedBuffer.limit(bufferInfo.offset + bufferInfo.size)
                        
                        // Copy decoded data to our output buffer
                        outputBuffer.put(decodedBuffer)
                    }
                    decoder.releaseOutputBuffer(outputBufferId, false)
                    
                    // Check if we've reached the end
                    if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        isEOS = true
                    }
                }
            }

            // Prepare the final byte array
            outputBuffer.flip()
            val audioData = ByteArray(outputBuffer.remaining())
            outputBuffer.get(audioData)

            return AudioData(
                data = audioData,
                sampleRate = targetSampleRate,
                channels = targetChannels,
                bitDepth = targetBitDepth,
                durationMs = endTimeMs - startTimeMs  // Use the actual time range
            ).also {
                LogUtils.d(CLASS_NAME, "Loaded compressed audio with duration: ${effectiveDurationMs}ms")
            }
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to load compressed audio range: ${e.message}", e)
            return null
        } finally {
            decoder?.stop()
            decoder?.release()
            extractor.release()
        }
    }

    // Future audio editing methods
    fun trimAudio(
        fileUri: String,
        startTimeMs: Long,
        endTimeMs: Long,
        config: DecodingConfig? = null,
        outputFileName: String? = null
    ): AudioData? {
        try {
            // Load the specified range
            val audioData = loadAudioRange(fileUri, startTimeMs, endTimeMs, config ?: DecodingConfig())
                ?: return null
            
            // Generate output filename if not provided
            val outputFile = if (outputFileName != null) {
                File(filesDir, outputFileName)
            } else {
                val timestamp = System.currentTimeMillis()
                File(filesDir, "trimmed_${timestamp}.wav")
            }
            
            val durationMs = (endTimeMs - startTimeMs).toInt()
            
            LogUtils.d(CLASS_NAME, """
                Trimming audio:
                - start: ${startTimeMs}ms
                - end: ${endTimeMs}ms
                - duration: ${durationMs}ms
                - output: ${outputFile.name}
            """.trimIndent())

            // Write WAV header
            RandomAccessFile(outputFile, "rw").use { raf ->
                // RIFF header
                raf.write("RIFF".toByteArray())
                val fileSize = audioData.data.size + 36 // File size minus RIFF header
                raf.writeInt(fileSize)
                raf.write("WAVE".toByteArray())

                // fmt chunk
                raf.write("fmt ".toByteArray())
                raf.writeInt(16) // Subchunk1Size (16 for PCM)
                val formatBytes = ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN)
                formatBytes.putShort(1) // AudioFormat (1 for PCM)
                raf.write(formatBytes.array())

                val channelsBytes = ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN)
                channelsBytes.putShort(audioData.channels.toShort())
                raf.write(channelsBytes.array())

                val sampleRateBytes = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN)
                sampleRateBytes.putInt(audioData.sampleRate)
                raf.write(sampleRateBytes.array())
                
                val byteRate = audioData.sampleRate * audioData.channels * (audioData.bitDepth / 8)
                raf.writeInt(byteRate) // ByteRate
                
                val blockAlign = audioData.channels * (audioData.bitDepth / 8)
                raf.writeShort(blockAlign) // BlockAlign
                raf.writeShort(audioData.bitDepth) // BitsPerSample

                // data chunk
                raf.write("data".toByteArray())
                raf.writeInt(audioData.data.size) // Subchunk2Size
                
                // Write audio data
                raf.write(audioData.data)
            }

            // Debug WAV header to verify
            debugWavHeader(outputFile)

            // Return the trimmed audio data
            return AudioData(
                data = audioData.data,
                sampleRate = audioData.sampleRate,
                channels = audioData.channels,
                bitDepth = audioData.bitDepth
            )
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to trim audio: ${e.message}", e)
            return null
        }
    }

    fun removeSection(
        fileUri: String,
        startTimeMs: Long,
        endTimeMs: Long,
        config: DecodingConfig? = null
    ): AudioData? {
        // TODO: Implement removing a section by concatenating before and after ranges
        // This will use loadAudioRange to get two sections and join them
        return null
    }

    fun joinAudioSections(
        sections: List<AudioData>,
        config: DecodingConfig? = null
    ): AudioData? {
        // TODO: Implement joining multiple audio sections
        // This will be used by removeSection and other future editing features
        return null
    }

    // Helper method for future editing features
    private fun convertAudioFormat(
        audioData: AudioData,
        targetSampleRate: Int? = null,
        targetChannels: Int? = null,
        targetBitDepth: Int? = null
    ): AudioData {
        // TODO: Implement audio format conversion
        // This will help ensure consistent format when joining sections
        return audioData
    }

    // Add new function to process entire file
    fun processEntireFile(audioData: AudioData): Features {
        val samples = convertToFloatArray(audioData.data, audioData.bitDepth)
        
        // Compute basic features for the entire file
        val sumSquares = samples.sumOf { it * it.toDouble() }.toFloat()
        val segmentLength = samples.size
        val zeroCrossings = countZeroCrossings(samples)
        val minAmplitude = samples.minOrNull() ?: 0f
        val maxAmplitude = samples.maxOrNull() ?: 0f
        
        // Use existing computeFeatures with the entire file as one segment
        return computeFeatures(
            segmentData = samples,
            sampleRate = audioData.sampleRate.toFloat(),
            sumSquares = sumSquares,
            zeroCrossings = zeroCrossings,
            segmentLength = segmentLength,
            minAmplitude = minAmplitude,
            maxAmplitude = maxAmplitude,
            featureOptions = mapOf() // Dont compute complex features
        )
    }

    private fun countZeroCrossings(data: FloatArray): Int {
        var crossings = 0
        for (i in 1 until data.size) {
            if (data[i - 1] * data[i] < 0) crossings++
        }
        return crossings
    }

    private fun hzToMel(hz: Float): Float {
        return 2595f * log10(1f + hz / 700f)
    }

    private fun melToHz(mel: Float): Float {
        return 700f * (10f.pow(mel / 2595f) - 1f)
    }

    private fun applyHannWindow(samples: FloatArray): FloatArray {
        val output = FloatArray(samples.size)
        for (i in samples.indices) {
            val multiplier = 0.5f * (1f - cos(2f * PI.toFloat() * i / (samples.size - 1)))
            output[i] = samples[i] * multiplier
        }
        return output
    }

    // Generate a Hann window of a specific size (new, avoids modifying applyHannWindow)
    private fun generateHannWindow(size: Int): FloatArray {
        return FloatArray(size) { i ->
            0.5f * (1f - cos(2f * PI.toFloat() * i / (size - 1)))
        }
    }

    // Main function to extract mel spectrogram (uses shared C++ implementation via JNI)
    fun extractMelSpectrogram(
        audioData: AudioData,
        windowSizeMs: Float = 25f, // Default 25ms window
        hopLengthMs: Float = 10f, // Default 10ms hop
        nMels: Int = 128,         // Number of mel bins
        fftLength: Int = 2048,    // FFT size
        fMin: Float = 0f,         // Minimum frequency
        fMax: Float = audioData.sampleRate.toFloat() / 2, // Nyquist frequency
        windowType: String = "hann",
        logScaling: Boolean = true, // Apply log scaling
        normalize: Boolean = false  // Normalize output
    ): SpectrogramData {
        val sampleRate = audioData.sampleRate.toFloat()
        val samples = convertToFloatArray(audioData.data, audioData.bitDepth)

        // Convert ms to samples
        val windowSizeSamples = (windowSizeMs * sampleRate / 1000).toInt()
        val hopLengthSamples = (hopLengthMs * sampleRate / 1000).toInt()

        val windowTypeInt = when (windowType.lowercase()) {
            "hann" -> 0
            "hamming" -> 1
            else -> throw IllegalArgumentException("Unsupported windowType: $windowType")
        }

        // Call shared C++ implementation via JNI
        val melSpectrogram = MelSpectrogramNative.compute(
            samples = samples,
            sampleRate = sampleRate.toInt(),
            fftLength = fftLength,
            windowSizeSamples = windowSizeSamples,
            hopLengthSamples = hopLengthSamples,
            nMels = nMels,
            fMin = fMin,
            fMax = fMax,
            windowType = windowTypeInt,
            logScale = logScaling,
            normalize = normalize
        )

        // Compute timestamps and frequencies for metadata
        val numFrames = melSpectrogram.size
        val timeStamps = FloatArray(numFrames) { it * hopLengthMs / 1000f }
        val frequencies = melFrequencies(nMels, fMin, fMax)

        return SpectrogramData(melSpectrogram, timeStamps, frequencies)
    }

    // Compute Short-Time Fourier Transform
    private fun computeSTFT(
        samples: FloatArray,
        fftLength: Int,
        windowSize: Int,
        hopLength: Int,
        window: FloatArray
    ): Array<FloatArray> {
        val fft = FFT(fftLength)
        val numFrames = ((samples.size - windowSize) / hopLength) + 1
        val stft = Array(numFrames) { FloatArray(fftLength / 2 + 1) }

        for (frameIdx in 0 until numFrames) {
            val start = frameIdx * hopLength
            val end = minOf(start + windowSize, samples.size)
            val frame = FloatArray(fftLength) { 0f }

            // Extract and window the frame
            for (i in start until end) {
                frame[i - start] = samples[i] * window[i - start]
            }

            // Compute FFT and power spectrum
            val fftResult = fft.processSegment(frame)
            for (i in 0 until fftLength / 2 + 1) {
                // Check bounds before accessing array elements
                val real = if (2 * i < fftResult.size) fftResult[2 * i] else 0f
                val imag = if (2 * i + 1 < fftResult.size) fftResult[2 * i + 1] else 0f
                stft[frameIdx][i] = real * real + imag * imag
            }
        }
        return stft
    }

    // Apply mel filterbank to STFT
    private fun applyMelFilterbank(
        stft: Array<FloatArray>,
        sampleRate: Float,
        nMels: Int,
        fftLength: Int,
        fMin: Float,
        fMax: Float
    ): Array<FloatArray> {
        val numFrames = stft.size
        val numBins = stft[0].size
        val melFilters = createMelFilterbank(sampleRate, fftLength, nMels, fMin, fMax)
        val melSpectrogram = Array(numFrames) { FloatArray(nMels) }

        for (frame in 0 until numFrames) {
            for (melBin in 0 until nMels) {
                var sum = 0f
                for (bin in 0 until numBins) {
                    sum += stft[frame][bin] * melFilters[melBin][bin]
                }
                melSpectrogram[frame][melBin] = sum
            }
        }
        return melSpectrogram
    }

    // Create mel filterbank matrix
    private fun createMelFilterbank(
        sampleRate: Float,
        fftLength: Int,
        nMels: Int,
        fMin: Float,
        fMax: Float
    ): Array<FloatArray> {
        val freqs = FloatArray(fftLength / 2 + 1) { it * sampleRate / fftLength }
        val melPoints = melFrequencies(nMels + 2, fMin, fMax)
        val melFilters = Array(nMels) { FloatArray(fftLength / 2 + 1) }

        for (melIdx in 0 until nMels) {
            val fLow = melPoints[melIdx]
            val fCenter = melPoints[melIdx + 1]
            val fHigh = melPoints[melIdx + 2]

            for (bin in freqs.indices) {
                val freq = freqs[bin]
                melFilters[melIdx][bin] = when {
                    freq < fLow || freq > fHigh -> 0f
                    freq <= fCenter -> (freq - fLow) / (fCenter - fLow)
                    else -> (fHigh - freq) / (fHigh - fCenter)
                }
            }
        }
        return melFilters
    }

    // Generate mel-spaced frequencies
    private fun melFrequencies(nMels: Int, fMin: Float, fMax: Float): FloatArray {
        val melMin = hzToMel(fMin)
        val melMax = hzToMel(fMax)
        val melPoints = FloatArray(nMels) { i ->
            val mel = melMin + i * (melMax - melMin) / (nMels - 1)
            melToHz(mel)
        }
        return melPoints
    }

    private fun computeMelSpectrogram(samples: FloatArray, sampleRate: Float): List<Float> {
        val nMels = 128
        val fftLength = 2048
        val windowSize = minOf(samples.size, fftLength)
        val hopLength = windowSize  // single frame

        MelSpectrogramNative.init(
            sampleRate = sampleRate.toInt(),
            fftLength = fftLength,
            windowSizeSamples = windowSize,
            hopLengthSamples = hopLength,
            nMels = nMels,
            fMin = 0f,
            fMax = sampleRate / 2f,
            windowType = 0  // Hann
        )

        val melOutput = FloatArray(nMels)
        val success = MelSpectrogramNative.computeFrame(samples, melOutput)
        return if (success) melOutput.toList() else emptyList()
    }

    private fun computeChroma(samples: FloatArray, sampleRate: Float): List<Float> {
        val (_, magnitudeSpectrum) = prepareFFT(samples, sampleRate)
        val chroma = FloatArray(N_CHROMA) { 0f }
        val freqsPerBin = sampleRate / N_FFT
        
        for (i in 0 until N_FFT / 2) {
            val freq = i * freqsPerBin
            if (freq > 0) {
                val pitchClass = (12 * log2(freq / 440.0) % 12).toInt()
                if (pitchClass in 0..11) {
                    val magnitude = sqrt(magnitudeSpectrum[2 * i] * magnitudeSpectrum[2 * i] + 
                        (if (2 * i + 1 < magnitudeSpectrum.size) magnitudeSpectrum[2 * i + 1] else 0f) * 
                        magnitudeSpectrum[2 * i + 1])
                    chroma[pitchClass] += magnitude
                }
            }
        }
        
        return chroma.toList()
    }

    private fun computeSpectralContrast(samples: FloatArray, sampleRate: Float): List<Float> {
        val (_, magnitudeSpectrum) = prepareFFT(samples, sampleRate)
        // ... rest of spectral contrast computation using magnitudeSpectrum ...
        // Implementation depends on your specific requirements
        return emptyList() // Placeholder
    }

    private fun computeTonnetz(samples: FloatArray, sampleRate: Float): List<Float> {
        // First compute chroma features
        val chroma = computeChroma(samples, sampleRate)
        
        // Tonnetz transformation matrix (6x12)
        val tonnetzMatrix = arrayOf(
            floatArrayOf(1f, 0f, 0f, 0f, 1f, 0f, 0f, 1f, 0f, 0f, 0f, 0f), // Perfect fifth
            floatArrayOf(0f, 1f, 0f, 0f, 0f, 1f, 0f, 0f, 1f, 0f, 0f, 0f, 0f), // Minor third
            floatArrayOf(0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f, 0f, 1f, 0f, 0f), // Major third
            floatArrayOf(0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f, 0f, 1f, 0f), // Perfect fifth
            floatArrayOf(0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 0f, 1f, 0f), // Minor third
            floatArrayOf(1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f, 0f)  // Major third
        )
        
        // Compute tonnetz features
        val tonnetz = mutableListOf<Float>()
        for (row in tonnetzMatrix) {
            var sum = 0f
            for (i in row.indices) {
                sum += row[i] * (chroma.getOrNull(i) ?: 0f)
            }
            tonnetz.add(sum)
        }
        
        return tonnetz
    }

    private fun nextPowerOfTwo(n: Int): Int {
        var value = 1
        while (value < n) {
            value *= 2
        }
        return value
    }

    private fun estimatePitch(segment: FloatArray, sampleRate: Float): Float {
        if (segment.size < 2) return 0.0f

        // Apply Hann window
        val windowed = applyHannWindow(segment)

        // Pad for FFT - ensure length is power of 2 and sufficient for autocorrelation
        val fftLength = nextPowerOfTwo(segment.size * 2)
        val padded = FloatArray(fftLength) // Initialize with zeros
        windowed.copyInto(padded) // Copy windowed data into padded array

        // Perform forward FFT
        val fft = FFT(fftLength)
        try {
            fft.realForward(padded)
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "FFT forward transform failed: ${e.message}")
            return 0.0f
        }

        // Compute power spectrum
        val powerSpectrum = FloatArray(fftLength)
        try {
            // Handle DC and Nyquist components separately
            powerSpectrum[0] = padded[0] * padded[0]
            powerSpectrum[fftLength/2] = padded[1] * padded[1]
            
            // Handle remaining frequencies
            for (i in 1 until fftLength/2) {
                val re = padded[2 * i]
                val im = padded[2 * i + 1]
                powerSpectrum[i] = re * re + im * im
                powerSpectrum[fftLength - i] = powerSpectrum[i] // Mirror for inverse FFT
            }
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Power spectrum computation failed: ${e.message}")
            return 0.0f
        }

        // Inverse FFT to get autocorrelation
        val autocorrelation = FloatArray(fftLength)
        try {
            fft.realInverse(powerSpectrum, autocorrelation)
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "FFT inverse transform failed: ${e.message}")
            return 0.0f
        }

        // Normalize autocorrelation
        val normFactor = 1.0f / autocorrelation[0] // Normalize by zero-lag autocorrelation
        for (i in autocorrelation.indices) {
            autocorrelation[i] *= normFactor
        }

        // Find the first peak within pitch range (50-500 Hz)
        val minLag = (sampleRate / 500.0f).toInt().coerceAtLeast(1)
        val maxLag = (sampleRate / 50.0f).toInt().coerceAtMost(autocorrelation.size - 1)
        
        var maxCorr = -1.0f
        var pitchLag = 0
        
        // Add peak picking criteria
        val threshold = 0.3f // Correlation threshold
        var isPeak = false
        
        for (lag in minLag..maxLag) {
            if (lag > 0 && lag < autocorrelation.size - 1) {
                // Check if this point is a peak
                isPeak = autocorrelation[lag] > autocorrelation[lag - 1] && 
                        autocorrelation[lag] > autocorrelation[lag + 1] &&
                        autocorrelation[lag] > threshold
                
                if (isPeak && autocorrelation[lag] > maxCorr) {
                    maxCorr = autocorrelation[lag]
                    pitchLag = lag
                }
            }
        }

        return if (pitchLag > 0) sampleRate / pitchLag else 0.0f
    }

    /**
     * Prepares FFT by applying Hann window, padding, and computing both power and magnitude spectra.
     * @param samples Input audio samples
     * @param sampleRate Sampling rate in Hz
     * @param fftLength FFT size (must be power of 2)
     * @return Pair of power spectrum and magnitude spectrum
     */
    private fun prepareFFT(samples: FloatArray, sampleRate: Float, fftLength: Int = nextPowerOfTwo(samples.size.coerceAtLeast(2048))): Pair<FloatArray, FloatArray> {
        val windowed = applyHannWindow(samples)
        val padded = windowed.copyOf(fftLength)
        val fft = FFT(fftLength)
        fft.realForward(padded)

        val magnitudeSpectrum = FloatArray(fftLength / 2 + 1)
        for (i in 0 until fftLength / 2) {
            val re = padded[2 * i]
            val im = padded[2 * i + 1]
            magnitudeSpectrum[i] = sqrt(re * re + im * im)
        }
        magnitudeSpectrum[fftLength / 2] = abs(padded[1])

        val powerSpectrum = magnitudeSpectrum.map { it * it }.toFloatArray()
        return Pair(powerSpectrum, magnitudeSpectrum)
    }

    data class AudioFormat(
        val sampleRate: Int,
        val channels: Int,
        val bitDepth: Int
    )

    fun getAudioFormat(fileUri: String): AudioFormat? {
        val cleanUri = fileUri.removePrefix("file://")
        val file = File(cleanUri).takeIf { it.exists() } ?: File(filesDir, File(cleanUri).name).takeIf { it.exists() }
            ?: run {
                LogUtils.e(CLASS_NAME, "File not found: $cleanUri")
                return null
            }

        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(file.absolutePath)
            val format = extractor.getTrackFormat(0)
            return AudioFormat(
                sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE),
                channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT),
                bitDepth = 16  // Most compressed formats decode to 16-bit PCM
            )
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to get audio format: ${e.message}", e)
            return null
        } finally {
            extractor.release()
        }
    }

    /**
     * Gets the size of the audio file header.
     * For WAV files, this includes the RIFF header and all metadata chunks before the data chunk.
     * For other formats, this will return null as header size handling is format-specific.
     *
     * @param fileUri The URI of the audio file to analyze
     * @return The size of the header in bytes, or null if:
     *         - The file is not a WAV file
     *         - The file cannot be read
     *         - The file format is invalid
     *         - The data chunk cannot be found
     *
     * WAV File Structure:
     * - RIFF header (12 bytes)
     *   - "RIFF" identifier (4 bytes)
     *   - File size (4 bytes)
     *   - "WAVE" identifier (4 bytes)
     * - Format chunk ("fmt ") (24 bytes typically)
     * - Optional metadata chunks (variable size)
     *   - LIST (metadata like artist, title)
     *   - JUNK (padding)
     *   - fact (additional format info)
     *   - cue  (cue points)
     * - Data chunk
     *   - "data" identifier (4 bytes)
     *   - Chunk size (4 bytes)
     *   - Actual audio data
     */
    fun getWavHeaderSize(fileUri: String): Int? {
        val cleanUri = fileUri.removePrefix("file://")
        val file = File(cleanUri).takeIf { it.exists() } ?: File(filesDir, File(cleanUri).name).takeIf { it.exists() }
            ?: run {
                LogUtils.e(CLASS_NAME, "File not found: $cleanUri")
                return null
            }

        try {
            val inputStream = FileInputStream(file)
            val buffer = ByteArray(12)  // Read RIFF header and chunk size
            
            // Read RIFF header
            if (inputStream.read(buffer) != 12) {
                LogUtils.e(CLASS_NAME, "Failed to read RIFF header")
                return null
            }
            
            // Verify RIFF header
            if (String(buffer, 0, 4) != "RIFF" || String(buffer, 8, 4) != "WAVE") {
                LogUtils.e(CLASS_NAME, "Invalid WAV file format")
                return null
            }
            
            var headerSize = 12
            var chunkSize: Int
            
            // Read chunks until we find the data chunk
            while (true) {
                if (inputStream.read(buffer, 0, 8) != 8) {
                    LogUtils.e(CLASS_NAME, "Unexpected end of file while reading chunks")
                    break
                }
                
                chunkSize = (buffer[7].toInt() and 0xFF shl 24) or
                           (buffer[6].toInt() and 0xFF shl 16) or
                           (buffer[5].toInt() and 0xFF shl 8) or
                           (buffer[4].toInt() and 0xFF)
                
                val chunkId = String(buffer, 0, 4)
                LogUtils.d(CLASS_NAME, "Found chunk: $chunkId, size: $chunkSize")
                
                if (chunkId == "data") {
                    headerSize += 8  // Add chunk header size
                    LogUtils.d(CLASS_NAME, "Found data chunk at offset: $headerSize")
                    break
                }
                
                headerSize += 8 + chunkSize  // Add chunk header and data size
                inputStream.skip(chunkSize.toLong())  // Skip chunk data
            }
            
            inputStream.close()
            LogUtils.d(CLASS_NAME, "Total WAV header size: $headerSize bytes")
            return headerSize
            
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Error calculating WAV header size: ${e.message}", e)
            return null
        }
    }

    /**
     * Decodes a specific time range of an audio file directly to PCM data
     * This is more efficient than decoding the entire file when only a portion is needed
     */
    fun decodeAudioRangeToPCM(fileUri: String, startTimeMs: Long, endTimeMs: Long): AudioData? {
        val extractor = MediaExtractor()
        var decoder: android.media.MediaCodec? = null
        
        try {
            extractor.setDataSource(fileUri)
            val trackIndex = (0 until extractor.trackCount).find { 
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true 
            } ?: return null
            
            extractor.selectTrack(trackIndex)
            val format = extractor.getTrackFormat(trackIndex)
            
            val sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            val channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            decoder = android.media.MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            decoder.configure(format, null, null, 0)
            decoder.start()

            extractor.seekTo(startTimeMs * 1000, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            val pcmData = mutableListOf<Byte>()
            val bufferInfo = android.media.MediaCodec.BufferInfo()
            var isEOS = false
            var firstBufferTimeUs: Long? = null

            while (!isEOS) {
                val inputBufferId = decoder.dequeueInputBuffer(10000)
                if (inputBufferId >= 0) {
                    val inputBuffer = decoder.getInputBuffer(inputBufferId)!!
                    val sampleSize = extractor.readSampleData(inputBuffer, 0)
                    if (sampleSize < 0 || extractor.sampleTime > endTimeMs * 1000) {
                        decoder.queueInputBuffer(inputBufferId, 0, 0, 0, android.media.MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        isEOS = true
                    } else {
                        decoder.queueInputBuffer(inputBufferId, 0, sampleSize, extractor.sampleTime, 0)
                        extractor.advance()
                    }
                }

                val outputBufferId = decoder.dequeueOutputBuffer(bufferInfo, 10000)
                if (outputBufferId >= 0) {
                    val outputBuffer = decoder.getOutputBuffer(outputBufferId)!!
                    if (firstBufferTimeUs == null) firstBufferTimeUs = bufferInfo.presentationTimeUs
                    val chunk = ByteArray(bufferInfo.size)
                    outputBuffer.get(chunk)
                    pcmData.addAll(chunk.toList())
                    decoder.releaseOutputBuffer(outputBufferId, false)
                }
            }

            // If we didn't get any data or first buffer time, return null
            if (pcmData.isEmpty() || firstBufferTimeUs == null) {
                return null
            }

            // Trim PCM data to exact time range
            val bytesPerSample = 2 // 16-bit PCM
            val bytesPerFrame = bytesPerSample * channels
            val samplesPerSecond = sampleRate * channels
            val dt = 1_000_000.0 / sampleRate // Time per sample in microseconds
            
            val allSamples = java.nio.ByteBuffer.wrap(pcmData.toByteArray()).order(java.nio.ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            val totalSamples = allSamples.capacity()
            
            // Calculate sample indices for the exact time range
            val startSample = ((startTimeMs * 1000 - firstBufferTimeUs) / dt).toInt().coerceIn(0, totalSamples)
            val endSample = ((endTimeMs * 1000 - firstBufferTimeUs) / dt).toInt().coerceIn(startSample, totalSamples)
            
            // Create a new ShortBuffer view starting at the correct position
            allSamples.position(startSample)
            val trimmedSamples = ShortArray(endSample - startSample)
            for (i in trimmedSamples.indices) {
                trimmedSamples[i] = allSamples.get()
            }
            
            // Convert ShortArray to ByteArray
            val trimmedBytes = ByteArray(trimmedSamples.size * 2)
            val byteBuffer = java.nio.ByteBuffer.wrap(trimmedBytes).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            val shortBuffer = byteBuffer.asShortBuffer()
            shortBuffer.put(trimmedSamples)

            return AudioData(
                data = trimmedBytes,
                sampleRate = sampleRate,
                channels = channels,
                bitDepth = 16, // MediaCodec typically decodes to 16-bit PCM
                durationMs = endTimeMs - startTimeMs
            )
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to decode audio range: ${e.message}", e)
            return null
        } finally {
            try {
                decoder?.stop()
                decoder?.release()
            } catch (e: Exception) {
                LogUtils.w(CLASS_NAME, "Error releasing decoder: ${e.message}")
            }
            
            try {
                extractor.release()
            } catch (e: Exception) {
                LogUtils.w(CLASS_NAME, "Error releasing extractor: ${e.message}")
            }
        }
    }
}
