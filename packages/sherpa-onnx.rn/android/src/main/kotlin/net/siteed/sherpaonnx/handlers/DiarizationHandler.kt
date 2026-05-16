/**
 * Handler for Offline Speaker Diarization functionality
 */
package net.siteed.sherpaonnx.handlers

import android.os.Debug
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.k2fsa.sherpa.onnx.FastClusteringConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarization
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarizationCallback
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarizationConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationModelConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationPyannoteModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import net.siteed.sherpaonnx.SherpaOnnxImpl
import net.siteed.sherpaonnx.utils.AssetUtils
import net.siteed.sherpaonnx.utils.AudioExtractor
import java.io.File
import java.util.concurrent.Executors
import java.lang.Integer
import kotlin.math.max

class DiarizationHandler(private val reactContext: ReactApplicationContext) {

    private val executor = Executors.newSingleThreadExecutor()
    private var sd: OfflineSpeakerDiarization? = null

    companion object {
        private const val TAG = "SherpaOnnxDiarization"
    }

    fun initDiarization(config: ReadableMap, promise: Promise) {
        if (!SherpaOnnxImpl.isLibraryLoaded) {
            promise.reject("ERR_LIBRARY_NOT_LOADED", "Sherpa ONNX library is not loaded")
            return
        }

        executor.execute {
            try {
                Log.i(TAG, "===== DIARIZATION INITIALIZATION START =====")

                val segmentationModelDir = AssetUtils.cleanFilePath(config.getString("segmentationModelDir") ?: "")
                val embeddingModelFile = AssetUtils.cleanFilePath(config.getString("embeddingModelFile") ?: "")
                val numThreads = if (config.hasKey("numThreads")) config.getInt("numThreads") else 1
                val debug = if (config.hasKey("debug")) config.getBoolean("debug") else false
                val provider = config.getString("provider") ?: "cpu"
                val minDurationOn = if (config.hasKey("minDurationOn")) config.getDouble("minDurationOn").toFloat() else 0.3f
                val minDurationOff = if (config.hasKey("minDurationOff")) config.getDouble("minDurationOff").toFloat() else 0.5f
                val numClusters = if (config.hasKey("numClusters")) config.getInt("numClusters") else -1
                val threshold = if (config.hasKey("threshold")) config.getDouble("threshold").toFloat() else 0.5f

                val requestedSegmentationModelFile = if (config.hasKey("segmentationModelFile") && !config.isNull("segmentationModelFile")) {
                    AssetUtils.cleanFilePath(config.getString("segmentationModelFile") ?: "")
                } else {
                    ""
                }
                val segmentationModelPath = if (requestedSegmentationModelFile.isNotEmpty()) {
                    val requestedFile = File(requestedSegmentationModelFile)
                    if (requestedFile.isAbsolute) {
                        requestedFile.absolutePath
                    } else {
                        File(segmentationModelDir, requestedSegmentationModelFile).absolutePath
                    }
                } else {
                    // Quality default: use the full precision pyannote model.
                    // model.int8.onnx remains available by explicitly passing
                    // segmentationModelFile for size/speed tradeoff cases.
                    File(segmentationModelDir, "model.onnx").absolutePath
                }

                Log.i(TAG, "segmentationModelPath=$segmentationModelPath (exists: ${File(segmentationModelPath).exists()})")
                Log.i(TAG, "embeddingModelFile=$embeddingModelFile (exists: ${File(embeddingModelFile).exists()})")

                val diarizationConfig = OfflineSpeakerDiarizationConfig(
                    segmentation = OfflineSpeakerSegmentationModelConfig(
                        pyannote = OfflineSpeakerSegmentationPyannoteModelConfig(model = segmentationModelPath),
                        numThreads = numThreads,
                        debug = debug,
                        provider = provider,
                    ),
                    embedding = SpeakerEmbeddingExtractorConfig(
                        model = embeddingModelFile,
                        numThreads = numThreads,
                        debug = debug,
                        provider = provider,
                    ),
                    clustering = FastClusteringConfig(numClusters = numClusters, threshold = threshold),
                    minDurationOn = minDurationOn,
                    minDurationOff = minDurationOff,
                )

                sd = OfflineSpeakerDiarization(config = diarizationConfig)

                val sampleRate = sd!!.sampleRate()
                Log.i(TAG, "Diarization initialized, sampleRate=$sampleRate")

                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                resultMap.putInt("sampleRate", sampleRate)

                Log.i(TAG, "===== DIARIZATION INITIALIZATION COMPLETE =====")

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error initializing diarization: ${e.message}")
                e.printStackTrace()
                releaseResources()
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_DIARIZATION_INIT", "Failed to initialize diarization: ${e.message}")
                }
            }
        }
    }

    fun processDiarizationFile(filePath: String, numClusters: Int, threshold: Float, promise: Promise) {
        executor.execute {
            try {
                if (sd == null) throw Exception("Diarization is not initialized")

                val cleanedFilePath = AssetUtils.cleanFilePath(filePath)
                Log.i(TAG, "Processing file for diarization: $cleanedFilePath")
                val expectedSampleRate = sd!!.sampleRate()
                logMemorySnapshot("before-audio-extract")

                val audioData = AudioExtractor.extractAudioFromFile(
                    file = File(cleanedFilePath),
                    targetSampleRate = expectedSampleRate,
                )
                    ?: throw Exception("Failed to extract audio from file")

                Log.i(
                    TAG,
                    "Audio extracted: ${audioData.samples.size} samples at ${audioData.sampleRate}Hz (model expects ${expectedSampleRate}Hz)",
                )
                Log.i(
                    TAG,
                    "Audio duration prepared for diarization: ${audioData.samples.size.toDouble() / audioData.sampleRate.toDouble()}s",
                )
                logMemorySnapshot("after-audio-extract")

                // Update clustering config if non-default values passed
                if (numClusters != -1 || threshold != 0.5f) {
                    val updatedConfig = sd!!.config.copy(
                        clustering = FastClusteringConfig(numClusters = numClusters, threshold = threshold)
                    )
                    sd!!.setConfig(updatedConfig)
                }

                val startTime = System.currentTimeMillis()
                var lastProgressBucket = -1
                val progressBucketSize = 5
                val progressCallback = OfflineSpeakerDiarizationCallback { processedChunks, totalChunks, _ ->
                    val safeTotalChunks = max(totalChunks, 1)
                    val progressPercent = ((processedChunks * 100.0f) / safeTotalChunks.toFloat()).toInt()
                    val currentBucket = progressPercent / progressBucketSize
                    if (
                        processedChunks == 1 ||
                        processedChunks >= safeTotalChunks ||
                        currentBucket > lastProgressBucket
                    ) {
                        lastProgressBucket = currentBucket
                        val elapsedMs = System.currentTimeMillis() - startTime
                        Log.i(
                            TAG,
                            "Diarization progress: ${processedChunks}/${safeTotalChunks} chunks (${progressPercent}%) after ${elapsedMs}ms",
                        )
                        if (progressPercent >= 50 && progressPercent % 25 == 0) {
                            logMemorySnapshot("progress-${progressPercent}")
                        }
                    }
                    Integer.valueOf(0)
                }
                val segments = sd!!.processWithCallback(
                    samples = audioData.samples,
                    callback = progressCallback,
                )
                val durationMs = System.currentTimeMillis() - startTime

                Log.i(TAG, "Diarization complete: ${segments.size} segments in ${durationMs}ms")
                logMemorySnapshot("after-diarization")

                val segmentsArray = Arguments.createArray()
                val speakerSet = mutableSetOf<Int>()
                for (seg in segments) {
                    val segMap = Arguments.createMap()
                    segMap.putDouble("start", seg.start.toDouble())
                    segMap.putDouble("end", seg.end.toDouble())
                    segMap.putInt("speaker", seg.speaker)
                    segmentsArray.pushMap(segMap)
                    speakerSet.add(seg.speaker)
                }

                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                resultMap.putArray("segments", segmentsArray)
                resultMap.putInt("numSpeakers", speakerSet.size)
                resultMap.putInt("durationMs", durationMs.toInt())

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error processing diarization file: ${e.message}")
                e.printStackTrace()
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_DIARIZATION_PROCESS", "Failed to process diarization file: ${e.message}")
                }
            }
        }
    }

    fun processDiarizationFileWindow(
        filePath: String,
        startTimeMs: Double,
        durationMs: Double,
        numClusters: Int,
        threshold: Float,
        promise: Promise
    ) {
        executor.execute {
            try {
                if (sd == null) throw Exception("Diarization is not initialized")
                if (startTimeMs < 0.0) throw Exception("startTimeMs must be >= 0")
                if (durationMs <= 0.0) throw Exception("durationMs must be > 0")

                val cleanedFilePath = AssetUtils.cleanFilePath(filePath)
                val startTimeUs = (startTimeMs * 1000.0).toLong()
                val durationUs = (durationMs * 1000.0).toLong()
                val expectedSampleRate = sd!!.sampleRate()

                Log.i(
                    TAG,
                    "Processing diarization window: file=$cleanedFilePath startMs=$startTimeMs durationMs=$durationMs",
                )
                logMemorySnapshot("window-before-audio-extract")

                val audioData = AudioExtractor.extractAudioWindowFromFile(
                    file = File(cleanedFilePath),
                    startTimeUs = startTimeUs,
                    maxDurationUs = durationUs,
                    targetSampleRate = expectedSampleRate,
                )
                    ?: throw Exception("Failed to extract audio window from file")

                Log.i(
                    TAG,
                    "Audio window extracted: ${audioData.samples.size} samples at ${audioData.sampleRate}Hz",
                )
                logMemorySnapshot("window-after-audio-extract")

                val shouldOverrideClustering = numClusters != -1 || threshold != 0.5f
                val previousConfig = sd!!.config
                if (shouldOverrideClustering) {
                    val updatedConfig = previousConfig.copy(
                        clustering = FastClusteringConfig(numClusters = numClusters, threshold = threshold)
                    )
                    sd!!.setConfig(updatedConfig)
                }

                val startedAt = System.currentTimeMillis()
                val segments = try {
                    sd!!.processWithCallback(
                        samples = audioData.samples,
                        callback = OfflineSpeakerDiarizationCallback { _, _, _ -> Integer.valueOf(0) },
                    )
                } finally {
                    if (shouldOverrideClustering) {
                        sd!!.setConfig(previousConfig)
                    }
                }
                val processDurationMs = System.currentTimeMillis() - startedAt
                val offsetSeconds = startTimeMs / 1000.0

                Log.i(TAG, "Diarization window complete: ${segments.size} segments in ${processDurationMs}ms")
                logMemorySnapshot("window-after-diarization")

                val segmentsArray = Arguments.createArray()
                val speakerSet = mutableSetOf<Int>()
                for (seg in segments) {
                    val segMap = Arguments.createMap()
                    segMap.putDouble("start", seg.start.toDouble() + offsetSeconds)
                    segMap.putDouble("end", seg.end.toDouble() + offsetSeconds)
                    segMap.putInt("speaker", seg.speaker)
                    segmentsArray.pushMap(segMap)
                    speakerSet.add(seg.speaker)
                }

                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                resultMap.putArray("segments", segmentsArray)
                resultMap.putInt("numSpeakers", speakerSet.size)
                resultMap.putInt("durationMs", processDurationMs.toInt())
                resultMap.putDouble("startTimeMs", startTimeMs)
                resultMap.putDouble("windowDurationMs", durationMs)
                resultMap.putInt("sampleRate", audioData.sampleRate)
                resultMap.putInt("samples", audioData.samples.size)

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error processing diarization file window: ${e.message}")
                e.printStackTrace()
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_DIARIZATION_PROCESS_WINDOW", "Failed to process diarization file window: ${e.message}")
                }
            }
        }
    }

    fun releaseDiarization(promise: Promise) {
        executor.execute {
            try {
                releaseResources()
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("released", true)
                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error releasing diarization: ${e.message}")
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_DIARIZATION_RELEASE", "Failed to release diarization: ${e.message}")
                }
            }
        }
    }

    private fun releaseResources() {
        try {
            sd?.release()
            sd = null
            Log.i(TAG, "Diarization resources released")
        } catch (e: Exception) {
            Log.e(TAG, "Error in releaseResources: ${e.message}")
        }
    }

    private fun logMemorySnapshot(stage: String) {
        val runtime = Runtime.getRuntime()
        val javaUsedBytes = runtime.totalMemory() - runtime.freeMemory()
        val javaMaxBytes = runtime.maxMemory()
        val nativeBytes = Debug.getNativeHeapAllocatedSize()
        Log.i(
            TAG,
            "Memory[$stage]: javaUsedMb=${javaUsedBytes / (1024 * 1024)} javaMaxMb=${javaMaxBytes / (1024 * 1024)} nativeMb=${nativeBytes / (1024 * 1024)}",
        )
    }
}
