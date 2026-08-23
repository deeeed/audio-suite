package net.siteed.sherpaonnx

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import junit.framework.TestCase.*
import kotlinx.coroutines.runBlocking
import net.siteed.sherpaonnx.utils.LightweightModelDownloader
import net.siteed.sherpaonnx.utils.ModelExtractionCache
import net.siteed.sherpaonnx.utils.createPromise
import net.siteed.sherpaonnx.utils.extractModelArchive
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.sin
import kotlin.random.Random
import net.siteed.sherpaonnx.utils.createTestReactContext

@RunWith(AndroidJUnit4::class)
class RealAsrFunctionalityTest {

    private lateinit var sherpaOnnxImpl: SherpaOnnxImpl
    private lateinit var reactContext: ReactApplicationContext
    private lateinit var context: android.content.Context
    private var downloadedModelPath: String? = null
    private var extractedModelPath: String? = null

    companion object {
        private const val SAMPLE_RATE = 16000
        private const val TONE_FREQUENCY = 440.0 // A4 note
        private const val SILENCE_THRESHOLD = 0.01f
        // Whisper's 118 MB archive took about 59 seconds on the validation Pixel 6a.
        // TTS uses 30 seconds for its 31 MB archive; ASR needs the larger allowance.
        private const val MODEL_EXTRACTION_TIMEOUT_SECONDS = 90L
    }

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        reactContext = createTestReactContext(context)
        sherpaOnnxImpl = SherpaOnnxImpl(reactContext)
        assertTrue("Sherpa ONNX JNI library should load", SherpaOnnxImpl.isLibraryLoaded)
        
        // Download and extract the lightweight ASR model
        runBlocking {
            downloadAndExtractModel()
        }
    }

    @After
    fun tearDown() {
        // Clean up ASR resources
        releaseAsr()
        
        // Clean up test audio files
        cleanupTestAudioFiles()
    }

    private suspend fun downloadAndExtractModel() {
        // For ASR, we'll use the Whisper Tiny model
        val model = LightweightModelDownloader.TestModel.WHISPER_TINY
        val targetDir = File(context.cacheDir, "extracted-models/${model.modelName}")
        val modelDir = File(targetDir, "sherpa-onnx-whisper-tiny.en")
        val cache = ModelExtractionCache(
            targetDir = targetDir,
            requiredFiles = listOf(
                File(modelDir, "tiny.en-encoder.onnx"),
                File(modelDir, "tiny.en-decoder.onnx"),
                File(modelDir, "tiny.en-tokens.txt")
            )
        )
        if (cache.isComplete()) {
            extractedModelPath = targetDir.absolutePath
            println("Using extracted ASR model: ${targetDir.absolutePath}")
            return
        }

        println("Downloading ASR model: ${model.modelName}")
        val modelFile = LightweightModelDownloader.downloadModel(
            context = context,
            model = model,
            progressListener = object : LightweightModelDownloader.DownloadProgressListener {
                override fun onProgress(bytesDownloaded: Long, totalBytes: Long, percentComplete: Int) {
                    if (percentComplete % 20 == 0) {
                        println("Download progress: $percentComplete%")
                    }
                }
                
                override fun onComplete(modelFile: File) {
                    println("Download complete: ${modelFile.absolutePath}")
                    downloadedModelPath = modelFile.absolutePath
                }
                
                override fun onError(error: Exception) {
                    println("Download error: ${error.message}")
                }
            }
        )
        
        println("Extracting model to: ${targetDir.absolutePath}")
        val extraction = extractModelArchive(
            sherpaOnnxImpl = sherpaOnnxImpl,
            sourcePath = modelFile.absolutePath,
            cache = cache,
            timeoutSeconds = MODEL_EXTRACTION_TIMEOUT_SECONDS
        )

        assertTrue("Extraction should complete: ${extraction.error}", extraction.completed)
        assertNull("Extraction failed: ${extraction.error}", extraction.error)
        assertTrue("Extraction should succeed", extraction.success)
        extractedModelPath = targetDir.absolutePath
        println("Extraction successful")
    }

    @Test
    fun testAsrInitialization() {
        assertNotNull("Model should be extracted", extractedModelPath)
        
        val latch = CountDownLatch(1)
        var initResult: ReadableMap? = null
        var error: String? = null
        
        val config = Arguments.createMap().apply {
            putString("modelDir", "$extractedModelPath/sherpa-onnx-whisper-tiny.en")
            putString("modelType", "whisper")
            putInt("numThreads", 2)
            putString("decodingMethod", "greedy_search")
            putBoolean("debug", true)
            putString("provider", "cpu")
            
            // Model files for Whisper
            val modelFiles = Arguments.createMap().apply {
                // The archive prefixes every file with the model name.
                putString("encoder", "tiny.en-encoder.onnx")
                putString("decoder", "tiny.en-decoder.onnx")
                putString("tokens", "tiny.en-tokens.txt")
            }
            putMap("modelFiles", modelFiles)
        }
        
        sherpaOnnxImpl.initAsr(config, createPromise(
            onResolve = { result ->
                initResult = result as? ReadableMap
                latch.countDown()
            },
            onReject = { _, message, _ ->
                error = message
                latch.countDown()
            }
        ))
        
        assertTrue("ASR init should complete", latch.await(15, TimeUnit.SECONDS))
        
        assertNull("Should not have error: $error", error)
        assertNotNull("Should have init result", initResult)
        assertTrue("Init should be successful", initResult?.getBoolean("success") ?: false)
        
        val sampleRate = initResult?.getInt("sampleRate") ?: 0
        val modelType = initResult?.getString("modelType")
        
        println("ASR initialized with sampleRate=$sampleRate, modelType=$modelType")
        assertEquals("Sample rate should be 16000 for Whisper", SAMPLE_RATE, sampleRate)
        assertEquals("Model type should be whisper", "whisper", modelType)
    }

    @Test
    fun testAsrWithGeneratedAudio() {
        initializeAsr()
        
        // Test 1: Recognize silence
        println("\nTest 1: Recognizing silence")
        val silentSamples = generateSilence(2.0) // 2 seconds of silence
        val silenceResult = recognizeSamples(silentSamples)
        assertNotNull("Should get result for silence", silenceResult)
        val silenceText = silenceResult?.getString("text") ?: ""
        println("Silence recognition result: '$silenceText'")
        assertTrue("Silence should produce empty or minimal text", silenceText.trim().length < 10)
        
        // Test 2: Recognize tone (should not produce speech)
        println("\nTest 2: Recognizing pure tone")
        val toneSamples = generateTone(2.0, TONE_FREQUENCY) // 2 seconds of 440Hz tone
        val toneResult = recognizeSamples(toneSamples)
        assertNotNull("Should get result for tone", toneResult)
        val toneText = toneResult?.getString("text") ?: ""
        println("Tone recognition result: '$toneText'")
        
        // Test 3: Recognize noise
        println("\nTest 3: Recognizing noise")
        val noiseSamples = generateNoise(2.0) // 2 seconds of noise
        val noiseResult = recognizeSamples(noiseSamples)
        assertNotNull("Should get result for noise", noiseResult)
        val noiseText = noiseResult?.getString("text") ?: ""
        println("Noise recognition result: '$noiseText'")
    }

    @Test
    fun testAsrFromFile() {
        initializeAsr()
        
        // Create test audio files
        val testFiles = listOf(
            "silence.wav" to generateSilence(1.0),
            "tone.wav" to generateTone(1.0, TONE_FREQUENCY),
            "noise.wav" to generateNoise(1.0)
        )
        
        testFiles.forEach { (filename, samples) ->
            println("\nTesting ASR from file: $filename")
            
            // Save samples to WAV file
            val audioFile = File(context.cacheDir, filename)
            saveAsWav(samples, audioFile)
            assertTrue("Audio file should exist", audioFile.exists())
            println("Created audio file: ${audioFile.absolutePath} (${audioFile.length()} bytes)")
            
            // Recognize from file
            val latch = CountDownLatch(1)
            var recognizeResult: ReadableMap? = null
            var error: String? = null
            
            sherpaOnnxImpl.recognizeFromFile(audioFile.absolutePath, createPromise(
                onResolve = { result ->
                    recognizeResult = result as? ReadableMap
                    latch.countDown()
                },
                onReject = { _, message, _ ->
                    error = message
                    latch.countDown()
                }
            ))
            
            assertTrue("Recognition should complete", latch.await(10, TimeUnit.SECONDS))
            
            assertNull("Should not have error: $error", error)
            assertNotNull("Should have recognition result", recognizeResult)
            assertTrue("Recognition should be successful", recognizeResult?.getBoolean("success") ?: false)
            
            val text = recognizeResult?.getString("text") ?: ""
            
            println("Recognition result for $filename:")
            println("  Text: '$text'")
        }
    }

    @Test
    fun testAsrPerformance() {
        initializeAsr()
        
        // Test recognition performance with different audio lengths
        val durations = listOf(0.5, 1.0, 2.0, 5.0) // seconds
        
        durations.forEach { duration ->
            println("\nTesting ASR performance for ${duration}s audio")
            
            val samples = generateMixedAudio(duration)
            
            val startTime = System.currentTimeMillis()
            val result = recognizeSamples(samples)
            val endTime = System.currentTimeMillis()
            
            val processingTime = endTime - startTime
            val realTimeFactor = processingTime / (duration * 1000)
            
            assertNotNull("Should get result", result)
            assertTrue("Should be successful", result?.getBoolean("success") ?: false)
            
            println("Performance metrics:")
            println("  Audio duration: ${duration}s")
            println("  Processing time: ${processingTime}ms")
            println("  Real-time factor: ${String.format("%.2f", realTimeFactor)}x")
            println("  Samples processed: ${samples.size}")
            
            // Processing should be reasonably fast (less than 2x real-time for small models)
            assertTrue("Processing should be less than 3x real-time", realTimeFactor < 3.0)
        }
    }

    @Test
    fun testAsrMemoryManagement() {
        // Test multiple recognition cycles
        repeat(5) { cycle ->
            println("\nMemory test cycle ${cycle + 1}")
            
            val memoryBefore = getMemoryUsage()
            println("Memory before: ${memoryBefore.usedMB}MB used")
            
            // Initialize ASR
            initializeAsr()
            
            // Perform multiple recognitions
            repeat(3) {
                val samples = generateNoise(1.0)
                recognizeSamples(samples)
            }
            
            val memoryAfterRecognition = getMemoryUsage()
            println("Memory after recognition: ${memoryAfterRecognition.usedMB}MB used")
            
            // Release ASR
            releaseAsr()
            
            // Force garbage collection
            System.gc()
            Thread.sleep(500)
            
            val memoryAfter = getMemoryUsage()
            println("Memory after release: ${memoryAfter.usedMB}MB used")
            
            val memoryIncrease = memoryAfter.usedMB - memoryBefore.usedMB
            println("Memory increase: ${memoryIncrease}MB")
            
            assertTrue("Memory increase should be less than 20MB", memoryIncrease < 20)
        }
    }

    @Test
    fun testAsrErrorHandling() {
        // Test 1: Recognize without initialization
        println("\nTest 1: Recognize without initialization")
        val samples = generateSilence(1.0)
        val samplesArray = Arguments.createArray().apply {
            samples.forEach { pushDouble(it.toDouble()) }
        }
        
        var latch = CountDownLatch(1)
        var result: ReadableMap? = null
        var errorCode: String? = null
        var errorMessage: String? = null
        
        sherpaOnnxImpl.recognizeFromSamples(SAMPLE_RATE, samplesArray, createPromise(
            onResolve = { value ->
                result = value as? ReadableMap
                latch.countDown()
            },
            onReject = { code, message, _ ->
                errorCode = code
                errorMessage = message
                latch.countDown()
            }
        ))
        
        assertTrue("Uninitialized recognition should complete", latch.await(5, TimeUnit.SECONDS))
        assertNull("Uninitialized recognition should not resolve", result)
        assertEquals(
            "Unexpected uninitialized ASR error: $errorMessage",
            "ERR_ASR_RECOGNIZE",
            errorCode
        )
        assertTrue(
            "Expected the uninitialized branch, got: $errorMessage",
            errorMessage?.contains("Offline ASR is not initialized") == true
        )
        
        // Test 2: Recognize from non-existent file
        initializeAsr()
        
        println("\nTest 2: Recognize from non-existent file")
        latch = CountDownLatch(1)
        result = null
        errorCode = null
        errorMessage = null
        
        sherpaOnnxImpl.recognizeFromFile("/non/existent/file.wav", createPromise(
            onResolve = { value ->
                result = value as? ReadableMap
                latch.countDown()
            },
            onReject = { code, message, _ ->
                errorCode = code
                errorMessage = message
                latch.countDown()
            }
        ))
        
        assertTrue("Missing-file recognition should complete", latch.await(5, TimeUnit.SECONDS))
        assertNull("Missing-file recognition should not resolve", result)
        assertEquals(
            "Unexpected missing-file ASR error: $errorMessage",
            "ERR_ASR_RECOGNIZE",
            errorCode
        )
        assertTrue(
            "Expected the missing-file branch, got: $errorMessage",
            errorMessage?.contains("Failed to recognize speech from file") == true
        )
    }

    // Helper functions
    
    private fun initializeAsr() {
        val latch = CountDownLatch(1)
        var success = false
        
        val config = Arguments.createMap().apply {
            putString("modelDir", "$extractedModelPath/sherpa-onnx-whisper-tiny.en")
            putString("modelType", "whisper")
            putInt("numThreads", 2)
            putString("decodingMethod", "greedy_search")
            putBoolean("debug", false)
            putString("provider", "cpu")
            
            val modelFiles = Arguments.createMap().apply {
                // The archive prefixes every file with the model name.
                putString("encoder", "tiny.en-encoder.onnx")
                putString("decoder", "tiny.en-decoder.onnx")
                putString("tokens", "tiny.en-tokens.txt")
            }
            putMap("modelFiles", modelFiles)
        }
        
        sherpaOnnxImpl.initAsr(config, createPromise(
            onResolve = { result ->
                val map = result as? ReadableMap
                success = map?.getBoolean("success") ?: false
                latch.countDown()
            },
            onReject = { _, _, _ ->
                latch.countDown()
            }
        ))
        
        assertTrue("ASR init should complete", latch.await(15, TimeUnit.SECONDS))
        assertTrue("ASR init should succeed", success)
    }
    
    private fun recognizeSamples(samples: FloatArray): ReadableMap? {
        val latch = CountDownLatch(1)
        var result: ReadableMap? = null
        
        // Convert float array to ReadableArray
        val samplesArray = Arguments.createArray().apply {
            samples.forEach { pushDouble(it.toDouble()) }
        }
        
        sherpaOnnxImpl.recognizeFromSamples(SAMPLE_RATE, samplesArray, createPromise(
            onResolve = { res ->
                result = res as? ReadableMap
                latch.countDown()
            },
            onReject = { _, _, _ ->
                latch.countDown()
            }
        ))
        
        latch.await(10, TimeUnit.SECONDS)
        return result
    }
    
    private fun releaseAsr() {
        val latch = CountDownLatch(1)
        
        sherpaOnnxImpl.releaseAsr(createPromise(
            onResolve = { _ ->
                latch.countDown()
            },
            onReject = { _, _, _ ->
                latch.countDown()
            }
        ))
        
        latch.await(5, TimeUnit.SECONDS)
    }
    
    // Audio generation functions
    
    private fun generateSilence(durationSeconds: Double): FloatArray {
        val numSamples = (SAMPLE_RATE * durationSeconds).toInt()
        return FloatArray(numSamples) { 0.0f }
    }
    
    private fun generateTone(durationSeconds: Double, frequency: Double): FloatArray {
        val numSamples = (SAMPLE_RATE * durationSeconds).toInt()
        return FloatArray(numSamples) { i ->
            (0.3 * sin(2.0 * Math.PI * frequency * i / SAMPLE_RATE)).toFloat()
        }
    }
    
    private fun generateNoise(durationSeconds: Double): FloatArray {
        val numSamples = (SAMPLE_RATE * durationSeconds).toInt()
        val random = Random(42) // Fixed seed for reproducibility
        return FloatArray(numSamples) { 
            (random.nextFloat() - 0.5f) * 0.2f // Low amplitude noise
        }
    }
    
    private fun generateMixedAudio(durationSeconds: Double): FloatArray {
        val numSamples = (SAMPLE_RATE * durationSeconds).toInt()
        val samples = FloatArray(numSamples)
        
        // Mix of silence, tone, and noise
        val segmentLength = numSamples / 3
        
        // First third: silence
        for (i in 0 until segmentLength) {
            samples[i] = 0.0f
        }
        
        // Second third: tone
        for (i in segmentLength until 2 * segmentLength) {
            samples[i] = (0.3 * sin(2.0 * Math.PI * TONE_FREQUENCY * i / SAMPLE_RATE)).toFloat()
        }
        
        // Last third: noise
        val random = Random(42)
        for (i in 2 * segmentLength until numSamples) {
            samples[i] = (random.nextFloat() - 0.5f) * 0.2f
        }
        
        return samples
    }
    
    private fun saveAsWav(samples: FloatArray, file: File) {
        // Simple WAV file writer
        FileOutputStream(file).use { fos ->
            // Convert float samples to 16-bit PCM
            val pcmData = ByteArray(samples.size * 2)
            val buffer = ByteBuffer.wrap(pcmData).order(ByteOrder.LITTLE_ENDIAN)
            
            samples.forEach { sample ->
                val pcmValue = (sample * 32767).toInt().coerceIn(-32768, 32767).toShort()
                buffer.putShort(pcmValue)
            }
            
            // Write WAV header
            val dataSize = pcmData.size
            val fileSize = dataSize + 36
            
            fos.write("RIFF".toByteArray())
            fos.write(intToBytes(fileSize))
            fos.write("WAVE".toByteArray())
            fos.write("fmt ".toByteArray())
            fos.write(intToBytes(16)) // Subchunk1Size
            fos.write(shortToBytes(1)) // AudioFormat (PCM)
            fos.write(shortToBytes(1)) // NumChannels
            fos.write(intToBytes(SAMPLE_RATE)) // SampleRate
            fos.write(intToBytes(SAMPLE_RATE * 2)) // ByteRate
            fos.write(shortToBytes(2)) // BlockAlign
            fos.write(shortToBytes(16)) // BitsPerSample
            fos.write("data".toByteArray())
            fos.write(intToBytes(dataSize))
            fos.write(pcmData)
        }
    }
    
    private fun intToBytes(value: Int): ByteArray {
        return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(value).array()
    }
    
    private fun shortToBytes(value: Int): ByteArray {
        return ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN).putShort(value.toShort()).array()
    }
    
    private fun cleanupTestAudioFiles() {
        val testFiles = listOf("silence.wav", "tone.wav", "noise.wav")
        testFiles.forEach { filename ->
            File(context.cacheDir, filename).delete()
        }
    }
    
    private fun getMemoryUsage(): MemoryInfo {
        val runtime = Runtime.getRuntime()
        val usedMB = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024
        return MemoryInfo(usedMB)
    }
    
    data class MemoryInfo(val usedMB: Long)
}
