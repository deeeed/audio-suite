package net.siteed.audiostudio

import android.Manifest
import android.content.Context
import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import expo.modules.kotlin.Promise
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.sin

/**
 * Instrumented tests for AudioRecorderManager that test actual recording functionality.
 * These tests run on an Android device/emulator and require microphone permissions.
 */
@RunWith(AndroidJUnit4::class)
class AudioRecorderInstrumentedTest {
    
    @get:Rule
    val grantPermissionRule: GrantPermissionRule = GrantPermissionRule.grant(
        Manifest.permission.RECORD_AUDIO
    )
    
    private lateinit var context: Context
    private lateinit var filesDir: File
    private lateinit var audioRecorderManager: AudioRecorderManager
    private lateinit var testEventSender: TestEventSender
    private lateinit var permissionUtils: PermissionUtils
    private lateinit var audioDataEncoder: AudioDataEncoder
    
    // Test event sender to capture events
    private class TestEventSender : EventSender {
        val events = mutableListOf<Pair<String, Bundle>>()
        
        override fun sendExpoEvent(eventName: String, params: Bundle) {
            events.add(eventName to params)
        }
        
        fun clearEvents() {
            events.clear()
        }
        
        fun getEventsOfType(eventName: String): List<Bundle> {
            return events.filter { it.first == eventName }.map { it.second }
        }
    }
    
    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        filesDir = context.filesDir
        testEventSender = TestEventSender()
        permissionUtils = PermissionUtils(context)
        audioDataEncoder = AudioDataEncoder()
        
        // Initialize AudioRecorderManager
        audioRecorderManager = AudioRecorderManager.initialize(
            context = context,
            filesDir = filesDir,
            permissionUtils = permissionUtils,
            audioDataEncoder = audioDataEncoder,
            eventSender = testEventSender,
            enablePhoneStateHandling = false, // Disable for tests
            enableBackgroundAudio = false // Disable for tests
        )
        
        // Clean up any existing audio files
        cleanupAudioFiles()
    }
    
    @After
    fun tearDown() {
        // Stop any ongoing recording
        if (audioRecorderManager.isRecording) {
            stopRecordingSync()
        }
        
        // Clean up
        AudioRecorderManager.destroy()
        cleanupAudioFiles()
    }
    
    private fun cleanupAudioFiles() {
        filesDir.listFiles()?.forEach { file ->
            if (file.name.endsWith(".wav") || file.name.endsWith(".aac") || file.name.endsWith(".opus")) {
                file.delete()
            }
        }
    }
    
    // ========== Basic Recording Tests ==========
    
    @Test
    fun testBasicRecording_createsWavFile() {
        // Given
        val recordingOptions = mapOf(
            "sampleRate" to 16000,
            "channels" to 1,
            "encoding" to "pcm_16bit",
            "interval" to 100,
            "enableProcessing" to false,
            "showNotification" to false
        )
        
        // When - Start recording
        val startLatch = CountDownLatch(1)
        var recordingResult: Map<String, Any>? = null
        
        audioRecorderManager.startRecording(recordingOptions, object : Promise {
            override fun resolve(value: Any?) {
                when (value) {
                    is Bundle -> recordingResult = bundleToMap(value)
                    is Map<*, *> -> {
                        @Suppress("UNCHECKED_CAST")
                        recordingResult = value as? Map<String, Any>
                    }
                    else -> {
                        fail("Unexpected start result type: ${value?.javaClass?.name}")
                    }
                }
                startLatch.countDown()
            }
            
            override fun reject(code: String, message: String?, cause: Throwable?) {
                fail("Recording start failed: $code - $message")
            }
        })
        
        assertTrue("Recording should start within 2 seconds", startLatch.await(2, TimeUnit.SECONDS))
        assertNotNull("Recording result should not be null", recordingResult)
        
        // Record for 2 seconds
        Thread.sleep(2000)
        
        // Verify we received audio data events
        val audioEvents = testEventSender.getEventsOfType(Constants.AUDIO_EVENT_NAME)
        assertTrue("Should have received audio data events", audioEvents.isNotEmpty())
        
        // Stop recording
        val stopResult = stopRecordingSync()
        assertNotNull("Stop result should not be null", stopResult)
        
        // Verify the file was created
        val fileUri = stopResult["fileUri"] as? String
        assertNotNull("File URI should not be null", fileUri)
        
        // Convert URI string to File - handle both file:// URIs and plain paths
        val audioFile = when {
            fileUri!!.startsWith("file://") -> File(java.net.URI(fileUri))
            fileUri.startsWith("file:") -> File(java.net.URI(fileUri))
            else -> File(fileUri)
        }
        
        assertTrue("Audio file should exist at ${audioFile.absolutePath}", audioFile.exists())
        assertTrue("Audio file should have content", audioFile.length() > 44) // WAV header is 44 bytes
        
        // Verify file is a valid WAV
        val wavHeader = audioFile.inputStream().use { it.readNBytes(44) }
        assertEquals("Should have RIFF header", "RIFF", String(wavHeader.sliceArray(0..3)))
        assertEquals("Should have WAVE format", "WAVE", String(wavHeader.sliceArray(8..11)))
    }
    
    @Test
    fun testRecordingWithAnalysis_generatesFeatures() {
        // Given
        val recordingOptions = mapOf(
            "sampleRate" to 16000,
            "channels" to 1,
            "encoding" to "pcm_16bit",
            "interval" to 100,
            "intervalAnalysis" to 500,
            "enableProcessing" to true,
            "showNotification" to false,
            "features" to mapOf(
                "rms" to true,
                "zcr" to true,
                "energy" to true
            )
        )
        
        // When - Start recording
        startRecordingSync(recordingOptions)
        
        // Record for 2 seconds to ensure we get analysis events
        Thread.sleep(2000)
        
        // Then - Verify analysis events
        val analysisEvents = testEventSender.getEventsOfType(Constants.AUDIO_ANALYSIS_EVENT_NAME)
        assertTrue("Should have received analysis events", analysisEvents.isNotEmpty())
        
        val firstAnalysis = analysisEvents.first()
        // Analysis data contains dataPoints array
        assertTrue("Should have dataPoints", firstAnalysis.containsKey("dataPoints"))
        val dataPoints = firstAnalysis.get("dataPoints") as? Array<*>
        assertNotNull("DataPoints should not be null", dataPoints)
        assertTrue("Should have at least one data point", dataPoints!!.isNotEmpty())
        
        // Check the first data point
        val firstDataPoint = dataPoints[0] as? Bundle
        assertNotNull("First data point should be a Bundle", firstDataPoint)
        assertTrue("Data point should have rms", firstDataPoint!!.containsKey("rms"))
        assertTrue("Data point should have features", firstDataPoint.containsKey("features"))
        
        // Check features in the data point
        val features = firstDataPoint.get("features") as? Bundle
        assertNotNull("Features should not be null", features)
        assertTrue("Features should have rms", features!!.containsKey("rms"))
        assertTrue("Features should have zcr", features.containsKey("zcr"))
        assertTrue("Features should have energy", features.containsKey("energy"))
        
        // Stop recording
        stopRecordingSync()
    }
    
    @Test
    fun testPauseResumeRecording() {
        // Given
        val recordingOptions = mapOf(
            "sampleRate" to 16000,
            "channels" to 1,
            "encoding" to "pcm_16bit",
            "interval" to 100,
            "showNotification" to false
        )
        
        // Start recording
        startRecordingSync(recordingOptions)
        Thread.sleep(1000)
        
        // Clear events before pause
        testEventSender.clearEvents()
        
        // When - Pause recording
        val pauseLatch = CountDownLatch(1)
        audioRecorderManager.pauseRecording(object : Promise {
            override fun resolve(value: Any?) {
                pauseLatch.countDown()
            }
            
            override fun reject(code: String, message: String?, cause: Throwable?) {
                fail("Pause failed: $code - $message")
            }
        })
        
        assertTrue("Pause should complete within 1 second", pauseLatch.await(1, TimeUnit.SECONDS))
        
        // Give some time for any pending events to be processed
        Thread.sleep(200)
        
        // Clear events after pause to ensure we only check new events
        testEventSender.clearEvents()
        
        // Wait to verify no new audio events during pause
        Thread.sleep(500)
        val eventsDuringPause = testEventSender.getEventsOfType(Constants.AUDIO_EVENT_NAME)
        assertTrue("Should not receive audio events while paused", eventsDuringPause.isEmpty())
        
        // Resume recording
        val resumeLatch = CountDownLatch(1)
        audioRecorderManager.resumeRecording(object : Promise {
            override fun resolve(value: Any?) {
                resumeLatch.countDown()
            }
            
            override fun reject(code: String, message: String?, cause: Throwable?) {
                fail("Resume failed: $code - $message")
            }
        })
        
        assertTrue("Resume should complete within 1 second", resumeLatch.await(1, TimeUnit.SECONDS))
        
        // Verify audio events resume
        Thread.sleep(500)
        val eventsAfterResume = testEventSender.getEventsOfType(Constants.AUDIO_EVENT_NAME)
        assertTrue("Should receive audio events after resume", eventsAfterResume.isNotEmpty())
        
        // Stop recording
        stopRecordingSync()
    }
    
    @Test
    fun testCompressedRecording_createsAacFile() {
        // Skip test if API level is too low for compressed recording
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) {
            println("Skipping compressed recording test - requires API 29+, current API: ${android.os.Build.VERSION.SDK_INT}")
            return
        }
        
        // Given
        val recordingOptions = mapOf(
            "sampleRate" to 44100,
            "channels" to 2,
            "encoding" to "pcm_16bit",
            "interval" to 100,
            "showNotification" to false,
            "output" to mapOf(
                "compressed" to mapOf(
                    "enabled" to true,
                    "format" to "aac",
                    "bitrate" to 128000
                )
            )
        )
        
        // When - Record for 2 seconds
        startRecordingSync(recordingOptions)
        Thread.sleep(2000)
        val result = stopRecordingSync()
        
        // Debug: Print the result to understand its structure
        println("Stop recording result keys: ${result.keys}")
        println("Stop recording result: $result")
        
        // Then - Verify both files exist
        val wavUri = result["fileUri"] as? String
        assertNotNull("WAV file URI should exist", wavUri)
        
        // Check if compression info exists
        val compression = when (val comp = result["compression"]) {
            is Bundle -> bundleToMap(comp)
            is Map<*, *> -> comp
            else -> null
        }
        
        // The compressed file URI is inside the compression bundle
        val compressedUri = compression?.get("compressedFileUri") as? String
        
        // For debugging - print what we got
        println("Compression info: $compression")
        
        assertNotNull("Compression info should exist", compression)
        assertNotNull("Compressed file URI should exist in compression info", compressedUri)
        
        // Convert URI strings to Files
        val wavFile = when {
            wavUri!!.startsWith("file://") -> File(java.net.URI(wavUri))
            wavUri.startsWith("file:") -> File(java.net.URI(wavUri))
            else -> File(wavUri)
        }
        
        val aacFile = when {
            compressedUri!!.startsWith("file://") -> File(java.net.URI(compressedUri))
            compressedUri.startsWith("file:") -> File(java.net.URI(compressedUri))
            else -> File(compressedUri)
        }
        
        assertTrue("WAV file should exist at ${wavFile.absolutePath}", wavFile.exists())
        assertTrue("AAC file should exist at ${aacFile.absolutePath}", aacFile.exists())
        assertTrue("AAC file should have content", aacFile.length() > 0)
        assertTrue("AAC file should be smaller than WAV", aacFile.length() < wavFile.length())
    }
    
    @Test
    fun testGeneratedToneAnalysis_verifiesAudioContentFeatures() {
        // Speaker-to-microphone loopback is device/environment dependent and flaky:
        // volume, routing, echo cancellation, and physical placement can all turn a
        // valid recorder run into near-silence. Keep recorder coverage in the
        // lifecycle/file tests above, validate the physical mic path via the
        // playground CDP/manual recorder flow, and verify tone analysis here
        // with deterministic PCM.
        val sampleRate = 44100
        val tonePcm = generateTonePcm(
            frequency = 1000.0,
            durationMs = 1000,
            sampleRate = sampleRate
        )

        val audioProcessor = AudioProcessor(filesDir)
        val config = RecordingConfig(
            sampleRate = sampleRate,
            channels = 1,
            encoding = "pcm_16bit",
            features = mapOf(
                "rms" to true,
                "energy" to true,
                "spectralCentroid" to true
            )
        )
        
        val analysis = audioProcessor.processAudioData(tonePcm, config)
        
        val dataPoints = analysis.dataPoints
        assertTrue("Should have data points", dataPoints.isNotEmpty())
        
        val avgRms = dataPoints.map { it.rms }.average()
        assertTrue("Average RMS should indicate deterministic tone energy", avgRms > 0.01)
        
        val firstPointWithFeatures = dataPoints.firstOrNull { it.features != null }
        assertNotNull("Should have at least one data point with features", firstPointWithFeatures)
        
        // The spectral centroid of a 1kHz tone should be around 1000Hz
        val spectralCentroids = dataPoints.mapNotNull { it.features?.spectralCentroid }.filter { it > 0 }
        assertTrue("Should have spectral centroid values", spectralCentroids.isNotEmpty())
        val avgSpectralCentroid = spectralCentroids.average()
        
        // Log the actual value for debugging
        println("Average spectral centroid: $avgSpectralCentroid Hz")
        
        assertTrue(
            "Spectral centroid should indicate tonal content (was $avgSpectralCentroid Hz)",
            avgSpectralCentroid > 700 && avgSpectralCentroid < 1300
        )
    }
    
    // ========== Helper Methods ==========
    
    private fun startRecordingSync(options: Map<String, Any>) {
        val latch = CountDownLatch(1)
        audioRecorderManager.startRecording(options, object : Promise {
            override fun resolve(value: Any?) {
                latch.countDown()
            }
            
            override fun reject(code: String, message: String?, cause: Throwable?) {
                fail("Recording start failed: $code - $message")
            }
        })
        
        assertTrue("Recording should start within 2 seconds", latch.await(2, TimeUnit.SECONDS))
    }
    
    private fun stopRecordingSync(): Map<String, Any> {
        val latch = CountDownLatch(1)
        var result: Map<String, Any>? = null
        
        audioRecorderManager.stopRecording(object : Promise {
            override fun resolve(value: Any?) {
                when (value) {
                    is Bundle -> {
                        // Convert Bundle to Map
                        result = bundleToMap(value)
                    }
                    is Map<*, *> -> {
                        @Suppress("UNCHECKED_CAST")
                        result = value as? Map<String, Any>
                    }
                    else -> {
                        fail("Unexpected result type: ${value?.javaClass?.name}")
                    }
                }
                latch.countDown()
            }
            
            override fun reject(code: String, message: String?, cause: Throwable?) {
                fail("Recording stop failed: $code - $message")
            }
        })
        
        assertTrue("Recording should stop within 2 seconds", latch.await(2, TimeUnit.SECONDS))
        return result ?: throw AssertionError("Stop recording returned null result")
    }
    
    private fun bundleToMap(bundle: Bundle): Map<String, Any> {
        val map = mutableMapOf<String, Any>()
        for (key in bundle.keySet()) {
            when (val value = bundle.get(key)) {
                is Bundle -> map[key] = bundleToMap(value)
                null -> { /* skip null values */ }
                else -> map[key] = value
            }
        }
        return map
    }
    
    private fun generateTonePcm(frequency: Double, durationMs: Int, sampleRate: Int): ByteArray {
        val numSamples = (sampleRate * durationMs / 1000.0).toInt()
        val buffer = ByteBuffer.allocate(numSamples * 2).order(ByteOrder.LITTLE_ENDIAN)

        for (i in 0 until numSamples) {
            val angle = 2.0 * Math.PI * i * frequency / sampleRate
            buffer.putShort((sin(angle) * Short.MAX_VALUE * 0.5).toInt().toShort())
        }

        return buffer.array()
    }
}
