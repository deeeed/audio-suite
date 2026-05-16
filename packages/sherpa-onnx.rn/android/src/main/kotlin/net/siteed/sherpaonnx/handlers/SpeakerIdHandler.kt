/**
 * Handler for Speaker Identification functionality
 */
package net.siteed.sherpaonnx.handlers

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingManager
import com.k2fsa.sherpa.onnx.OnlineStream
import net.siteed.sherpaonnx.SherpaOnnxImpl
import net.siteed.sherpaonnx.utils.AssetUtils
import net.siteed.sherpaonnx.utils.AudioExtractor
import java.io.File
import java.util.concurrent.Executors

class SpeakerIdHandler(private val reactContext: ReactApplicationContext) {

    private val executor = Executors.newSingleThreadExecutor()
    private var speakerExtractor: SpeakerEmbeddingExtractor? = null
    private var speakerManager: SpeakerEmbeddingManager? = null
    private var stream: OnlineStream? = null

    companion object {
        private const val TAG = "SherpaOnnxSpeakerId"
    }

    /**
     * Initialize speaker identification with the provided model configuration
     */
    fun init(modelConfig: ReadableMap, promise: Promise) {
        if (!SherpaOnnxImpl.isLibraryLoaded) {
            promise.reject("ERR_LIBRARY_NOT_LOADED", "Sherpa ONNX library is not loaded")
            return
        }

        executor.execute {
            try {
                Log.i(TAG, "===== SPEAKER ID INITIALIZATION START =====")
                Log.i(TAG, "Received model config: ${modelConfig.toHashMap()}")

                // Extract paths from config
                val modelDir = AssetUtils.cleanFilePath(modelConfig.getString("modelDir") ?: "")
                val modelFile = modelConfig.getString("modelFile") ?: "model.onnx"
                val numThreads = if (modelConfig.hasKey("numThreads")) modelConfig.getInt("numThreads") else 1
                val debug = if (modelConfig.hasKey("debug")) modelConfig.getBoolean("debug") else false
                val provider = modelConfig.getString("provider") ?: "cpu"

                // Build file paths and validate
                val modelPath = File(modelDir, modelFile).absolutePath

                // Log file existence
                Log.i(TAG, "Model file: $modelPath (exists: ${File(modelPath).exists()})")

                // Create speaker embedding extractor config
                val config = SpeakerEmbeddingExtractorConfig(
                    model = modelPath,
                    numThreads = numThreads,
                    debug = debug,
                    provider = provider
                )

                Log.i(TAG, "Initializing with config: model=$modelPath")

                // Initialize speaker embedding extractor
                speakerExtractor = SpeakerEmbeddingExtractor(null, config)

                // Check initialization
                if (speakerExtractor == null) {
                    throw Exception("Failed to initialize speaker embedding extractor")
                }

                // Create initial stream and initialize manager
                stream = speakerExtractor?.createStream()

                // Check stream creation
                if (stream == null) {
                    throw Exception("Failed to create speaker ID stream")
                }

                // Initialize speaker manager
                val embeddingDim = speakerExtractor?.dim() ?: 0
                speakerManager = SpeakerEmbeddingManager(embeddingDim)

                Log.i(TAG, "Speaker ID initialized successfully with embedding dimension: $embeddingDim")

                // Return success result
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                resultMap.putInt("embeddingDim", embeddingDim)

                Log.i(TAG, "===== SPEAKER ID INITIALIZATION COMPLETE =====")

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error initializing speaker ID: ${e.message}")
                e.printStackTrace()

                // Release resources in case of error
                releaseResources()

                Log.i(TAG, "===== SPEAKER ID INITIALIZATION FAILED =====")

                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_SPEAKER_ID_INIT", "Failed to initialize speaker ID: ${e.message}")
                }
            }
        }
    }

    /**
     * Process audio samples to extract speaker embedding
     */
    fun processAudioSamples(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        executor.execute {
            try {
                if (speakerExtractor == null || stream == null) {
                    throw Exception("Speaker ID is not initialized")
                }

                // Convert ReadableArray to FloatArray
                val samples = FloatArray(audioBuffer.size())
                for (i in 0 until audioBuffer.size()) {
                    samples[i] = audioBuffer.getDouble(i).toFloat()
                }

                // Accept waveform
                stream?.acceptWaveform(samples, sampleRate)

                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                resultMap.putInt("samplesProcessed", samples.size)

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error processing audio samples: ${e.message}")

                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_SPEAKER_ID_PROCESS", "Failed to process audio samples: ${e.message}")
                }
            }
        }
    }

    /**
     * Compute speaker embedding from processed audio
     */
    fun computeEmbedding(promise: Promise) {
        executor.execute {
            try {
                if (speakerExtractor == null || stream == null) {
                    throw Exception("Speaker ID is not initialized")
                }

                // Check if we have enough data to compute embedding
                if (!speakerExtractor!!.isReady(stream!!)) {
                    val resultMap = Arguments.createMap()
                    resultMap.putBoolean("success", false)
                    resultMap.putString("error", "Not enough audio data to compute embedding")
                    reactContext.runOnUiQueueThread {
                        promise.resolve(resultMap)
                    }
                    return@execute
                }

                // Compute embedding
                val startTime = System.currentTimeMillis()
                val embedding = speakerExtractor!!.compute(stream!!)
                val endTime = System.currentTimeMillis()

                // Convert embedding to JS array
                val embeddingArray = Arguments.createArray()
                for (value in embedding) {
                    embeddingArray.pushDouble(value.toDouble())
                }

                // Create new stream for next compute operation
                stream?.release()
                stream = speakerExtractor?.createStream()

                // Return results
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                resultMap.putInt("durationMs", (endTime - startTime).toInt())
                resultMap.putArray("embedding", embeddingArray)
                resultMap.putInt("embeddingDim", embedding.size)

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error computing speaker embedding: ${e.message}")

                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_SPEAKER_ID_COMPUTE", "Failed to compute speaker embedding: ${e.message}")
                }
            }
        }
    }

    /**
     * Register a speaker with the given name and embedding
     */
    fun registerSpeaker(name: String, embedding: ReadableArray, promise: Promise) {
        executor.execute {
            try {
                if (speakerManager == null) {
                    throw Exception("Speaker ID is not initialized")
                }

                // Convert ReadableArray to FloatArray
                val embeddingArray = FloatArray(embedding.size())
                for (i in 0 until embedding.size()) {
                    embeddingArray[i] = embedding.getDouble(i).toFloat()
                }

                // Add to speaker manager
                val added = speakerManager!!.add(name, embeddingArray)

                // Return results
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", added)
                if (added) {
                    resultMap.putString("message", "Speaker '$name' registered successfully")
                } else {
                    resultMap.putString("error", "Failed to register speaker '$name'")
                }

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error registering speaker: ${e.message}")

                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_SPEAKER_ID_REGISTER", "Failed to register speaker: ${e.message}")
                }
            }
        }
    }

    /**
     * Remove a speaker from the database
     */
    fun removeSpeaker(name: String, promise: Promise) {
        executor.execute {
            try {
                if (speakerManager == null) {
                    throw Exception("Speaker ID is not initialized")
                }

                // Check if speaker exists
                val exists = speakerManager!!.contains(name)
                if (!exists) {
                    val resultMap = Arguments.createMap()
                    resultMap.putBoolean("success", false)
                    resultMap.putString("error", "Speaker '$name' not found in database")
                    reactContext.runOnUiQueueThread {
                        promise.resolve(resultMap)
                    }
                    return@execute
                }

                // Remove from speaker manager
                val removed = speakerManager!!.remove(name)

                // Return results
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", removed)
                if (removed) {
                    resultMap.putString("message", "Speaker '$name' removed successfully")
                } else {
                    resultMap.putString("error", "Failed to remove speaker '$name'")
                }

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error removing speaker: ${e.message}")

                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_SPEAKER_ID_REMOVE", "Failed to remove speaker: ${e.message}")
                }
            }
        }
    }

    /**
     * Get all registered speakers
     */
    fun getSpeakers(promise: Promise) {
        executor.execute {
            try {
                if (speakerManager == null) {
                    throw Exception("Speaker ID is not initialized")
                }

                // Get speaker names
                val speakerNames = speakerManager!!.allSpeakerNames()
                val speakerCount = speakerManager!!.numSpeakers()

                // Convert to JS array
                val speakersArray = Arguments.createArray()
                for (name in speakerNames) {
                    speakersArray.pushString(name)
                }

                // Return results
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                resultMap.putArray("speakers", speakersArray)
                resultMap.putInt("count", speakerCount)

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error getting speakers: ${e.message}")

                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_SPEAKER_ID_GET_SPEAKERS", "Failed to get speakers: ${e.message}")
                }
            }
        }
    }

    /**
     * Identify a speaker based on embedding
     */
    fun identifySpeaker(embedding: ReadableArray, threshold: Float, promise: Promise) {
        Log.i(TAG, "identifySpeaker called with threshold: $threshold")
        executor.execute {
            Log.i(TAG, "Starting speaker identification in background thread")
            try {
                if (speakerManager == null) {
                    Log.e(TAG, "Speaker manager is null - not initialized")
                    throw Exception("Speaker ID is not initialized")
                }

                // Convert ReadableArray to FloatArray
                val embeddingArray = FloatArray(embedding.size())
                for (i in 0 until embedding.size()) {
                    embeddingArray[i] = embedding.getDouble(i).toFloat()
                }

                // Search for matching speaker
                Log.i(TAG, "Searching for matching speaker")
                val speakerName = speakerManager!!.search(embeddingArray, threshold)
                Log.i(TAG, "Search result: ${if (speakerName.isNotEmpty()) "Found: $speakerName" else "No match found"}")

                // Return results
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                resultMap.putString("speakerName", speakerName)
                resultMap.putBoolean("identified", speakerName.isNotEmpty())

                Log.i(TAG, "Sending identification result back to JS")
                reactContext.runOnUiQueueThread {
                    Log.i(TAG, "On UI thread: resolving promise with identification result")
                    promise.resolve(resultMap)
                    Log.i(TAG, "Promise resolved")
                }
                Log.i(TAG, "Speaker identification completed successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Error identifying speaker: ${e.message}")

                reactContext.runOnUiQueueThread {
                    Log.e(TAG, "On UI thread: rejecting promise with error")
                    promise.reject("ERR_SPEAKER_ID_IDENTIFY", "Failed to identify speaker: ${e.message}")
                    Log.e(TAG, "Promise rejected")
                }
                Log.e(TAG, "Speaker identification failed with exception")
            }
            Log.i(TAG, "Exiting background thread for speaker identification")
        }
        Log.i(TAG, "identifySpeaker method exited - processing continues in background")
    }

    /**
     * Verify if the embedding matches a specific speaker
     */
    fun verifySpeaker(name: String, embedding: ReadableArray, threshold: Float, promise: Promise) {
        executor.execute {
            try {
                if (speakerManager == null) {
                    throw Exception("Speaker ID is not initialized")
                }

                // Check if speaker exists
                val exists = speakerManager!!.contains(name)
                if (!exists) {
                    val resultMap = Arguments.createMap()
                    resultMap.putBoolean("success", false)
                    resultMap.putString("error", "Speaker '$name' not found in database")
                    reactContext.runOnUiQueueThread {
                        promise.resolve(resultMap)
                    }
                    return@execute
                }

                // Convert ReadableArray to FloatArray
                val embeddingArray = FloatArray(embedding.size())
                for (i in 0 until embedding.size()) {
                    embeddingArray[i] = embedding.getDouble(i).toFloat()
                }

                // Verify speaker
                val verified = speakerManager!!.verify(name, embeddingArray, threshold)

                // Return results
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                resultMap.putBoolean("verified", verified)

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error verifying speaker: ${e.message}")

                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_SPEAKER_ID_VERIFY", "Failed to verify speaker: ${e.message}")
                }
            }
        }
    }

    /**
     * Process audio file to create embedding
     */
    fun processAudioFile(filePath: String, promise: Promise) {
        Log.i(TAG, "processAudioFile called with path: $filePath")
        executor.execute {
            Log.i(TAG, "Starting audio file processing in background thread")
            try {
                if (speakerExtractor == null) {
                    Log.e(TAG, "Speaker extractor is null - not initialized")
                    throw Exception("Speaker ID is not initialized")
                }

                // Clean the file path to remove any file:/ or file:// prefixes
                val cleanedFilePath = AssetUtils.cleanFilePath(filePath)
                Log.i(TAG, "Processing audio file for speaker ID: $cleanedFilePath")

                // Extract audio from file
                Log.i(TAG, "Starting audio extraction from file")
                val audioData = AudioExtractor.extractAudioFromFile(File(cleanedFilePath))

                if (audioData == null) {
                    Log.e(TAG, "Audio extraction failed - got null result")
                    throw Exception("Failed to extract audio from file")
                }

                Log.i(TAG, "Audio extracted successfully: ${audioData.samples.size} samples at ${audioData.sampleRate}Hz")

                // Create a new stream
                Log.i(TAG, "Creating audio stream")
                val newStream = speakerExtractor?.createStream()
                if (newStream == null) {
                    Log.e(TAG, "Failed to create speaker ID stream")
                    throw Exception("Failed to create audio stream")
                }

                // Process audio
                Log.i(TAG, "Feeding audio samples to stream")
                newStream.acceptWaveform(audioData.samples, audioData.sampleRate)

                // Check if we have enough data
                Log.i(TAG, "Checking if we have enough audio data")
                val isReady = speakerExtractor!!.isReady(newStream)
                Log.i(TAG, "Stream is ready: $isReady")

                if (!isReady) {
                    val resultMap = Arguments.createMap()
                    resultMap.putBoolean("success", false)
                    resultMap.putString("error", "Not enough audio data to compute embedding")
                    Log.i(TAG, "Not enough audio data, returning error to JS")
                    reactContext.runOnUiQueueThread {
                        promise.resolve(resultMap)
                    }
                    return@execute
                }

                // Compute embedding
                Log.i(TAG, "Starting embedding computation")
                val startTime = System.currentTimeMillis()
                val embedding = speakerExtractor!!.compute(newStream)
                val endTime = System.currentTimeMillis()
                Log.i(TAG, "Embedding computed in ${endTime - startTime}ms, dimension: ${embedding.size}")

                // Release stream
                Log.i(TAG, "Releasing stream")
                newStream.release()

                // Convert embedding to JS array
                Log.i(TAG, "Converting embedding to JS array")
                val embeddingArray = Arguments.createArray()
                for (value in embedding) {
                    embeddingArray.pushDouble(value.toDouble())
                }

                // Return results
                Log.i(TAG, "Preparing result map")
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                resultMap.putInt("durationMs", (endTime - startTime).toInt())
                resultMap.putArray("embedding", embeddingArray)
                resultMap.putInt("embeddingDim", embedding.size)
                resultMap.putInt("sampleRate", audioData.sampleRate)
                resultMap.putInt("samples", audioData.samples.size)

                Log.i(TAG, "Sending result back to JS")
                reactContext.runOnUiQueueThread {
                    Log.i(TAG, "On UI thread: resolving promise with embedding result")
                    promise.resolve(resultMap)
                    Log.i(TAG, "Promise resolved")
                }
                Log.i(TAG, "Audio processing completed successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Error processing audio file for speaker ID: ${e.message}")
                e.printStackTrace()

                reactContext.runOnUiQueueThread {
                    Log.e(TAG, "On UI thread: rejecting promise with error")
                    promise.reject("ERR_SPEAKER_ID_PROCESS_FILE", "Failed to process audio file: ${e.message}")
                    Log.e(TAG, "Promise rejected")
                }
                Log.e(TAG, "Audio processing failed with exception")
            }
            Log.i(TAG, "Exiting background thread for audio processing")
        }
        Log.i(TAG, "processAudioFile method exited - processing continues in background")
    }

    /**
     * Process an audio file window to create a speaker embedding without decoding the full file.
     */
    fun processAudioFileWindow(filePath: String, startTimeMs: Double, durationMs: Double, promise: Promise) {
        Log.i(TAG, "processAudioFileWindow called with path: $filePath startMs=$startTimeMs durationMs=$durationMs")
        executor.execute {
            try {
                if (speakerExtractor == null) {
                    throw Exception("Speaker ID is not initialized")
                }
                if (startTimeMs < 0.0) throw Exception("startTimeMs must be >= 0")
                if (durationMs <= 0.0) throw Exception("durationMs must be > 0")

                val cleanedFilePath = AssetUtils.cleanFilePath(filePath)
                val audioData = AudioExtractor.extractAudioWindowFromFile(
                    file = File(cleanedFilePath),
                    startTimeUs = (startTimeMs * 1000.0).toLong().coerceAtLeast(0L),
                    maxDurationUs = (durationMs * 1000.0).toLong().coerceAtLeast(0L),
                    targetSampleRate = 16_000,
                ) ?: throw Exception("Failed to extract audio window from file")

                val newStream = speakerExtractor?.createStream()
                    ?: throw Exception("Failed to create audio stream")
                newStream.acceptWaveform(audioData.samples, audioData.sampleRate)
                newStream.inputFinished()

                if (!speakerExtractor!!.isReady(newStream)) {
                    newStream.release()
                    val resultMap = Arguments.createMap()
                    resultMap.putBoolean("success", false)
                    resultMap.putInt("durationMs", 0)
                    resultMap.putArray("embedding", Arguments.createArray())
                    resultMap.putInt("embeddingDim", 0)
                    resultMap.putInt("sampleRate", audioData.sampleRate)
                    resultMap.putInt("samples", audioData.samples.size)
                    resultMap.putDouble("startTimeMs", startTimeMs)
                    resultMap.putDouble("windowDurationMs", durationMs)
                    resultMap.putString("error", "Not enough audio data to compute embedding")
                    reactContext.runOnUiQueueThread {
                        promise.resolve(resultMap)
                    }
                    return@execute
                }

                val startTime = System.currentTimeMillis()
                val embedding = speakerExtractor!!.compute(newStream)
                val endTime = System.currentTimeMillis()
                newStream.release()

                val embeddingArray = Arguments.createArray()
                for (value in embedding) {
                    embeddingArray.pushDouble(value.toDouble())
                }

                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                resultMap.putInt("durationMs", (endTime - startTime).toInt())
                resultMap.putArray("embedding", embeddingArray)
                resultMap.putInt("embeddingDim", embedding.size)
                resultMap.putInt("sampleRate", audioData.sampleRate)
                resultMap.putInt("samples", audioData.samples.size)
                resultMap.putDouble("startTimeMs", startTimeMs)
                resultMap.putDouble("windowDurationMs", durationMs)

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error processing audio file window for speaker ID: ${e.message}")
                e.printStackTrace()

                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_SPEAKER_ID_PROCESS_FILE_WINDOW", "Failed to process audio file window: ${e.message}")
                }
            }
        }
    }

    /**
     * Release all resources
     */
    fun release(promise: Promise) {
        executor.execute {
            try {
                Log.i(TAG, "Releasing Speaker ID resources")
                releaseResources()

                val resultMap = Arguments.createMap()
                resultMap.putBoolean("released", true)

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error releasing Speaker ID resources: ${e.message}")

                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_SPEAKER_ID_RELEASE", "Failed to release Speaker ID resources: ${e.message}")
                }
            }
        }
    }

    /**
     * Helper method to release resources
     */
    private fun releaseResources() {
        try {
            stream?.release()
            stream = null

            speakerManager?.release()
            speakerManager = null

            speakerExtractor?.release()
            speakerExtractor = null

            Log.i(TAG, "Speaker ID resources released")
        } catch (e: Exception) {
            Log.e(TAG, "Error in releaseResources: ${e.message}")
        }
    }
}
