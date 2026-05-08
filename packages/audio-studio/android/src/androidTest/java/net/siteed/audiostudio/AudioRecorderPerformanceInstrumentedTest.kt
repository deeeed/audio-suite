package net.siteed.audiostudio

import android.Manifest
import android.content.Context
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import expo.modules.kotlin.Promise
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.system.measureTimeMillis

/**
 * Performance tests for measuring stop recording times.
 */
@RunWith(AndroidJUnit4::class)
class AudioRecorderPerformanceInstrumentedTest {
    
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
    
    companion object {
        private const val TAG = "PerformanceTest"
    }
    
    // Test event sender to capture events
    private class TestEventSender : EventSender {
        override fun sendExpoEvent(eventName: String, params: android.os.Bundle) {
            // No-op for performance tests
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
            enablePhoneStateHandling = false,
            enableBackgroundAudio = false
        )
        
        // Clean up any existing audio files
        cleanupAudioFiles()
    }
    
    @After
    fun tearDown() {
        // Stop any ongoing recording
        if (audioRecorderManager.isRecording) {
            val promise = object : Promise {
                override fun resolve(value: Any?) {}
                override fun reject(code: String, message: String?, cause: Throwable?) {}
            }
            audioRecorderManager.stopRecording(promise)
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
    
    @Test
    fun measureStopTime_5seconds() {
        runPerformanceTest(5_000L, "5 second recording")
    }
    
    @Test
    fun measureStopTime_30seconds() {
        runPerformanceTest(30_000L, "30 second recording")
    }
    
    @Test
    fun measureStopTime_1minute() {
        runPerformanceTest(60_000L, "1 minute recording")
    }
    
    @Test
    fun measureStopTime_2minutes() {
        runPerformanceTest(120_000L, "2 minute recording")
    }
    
    @Test
    fun measureStopTime_5minutes() {
        assumeLongPerformanceTestsEnabled()
        runPerformanceTest(300_000L, "5 minute recording")
    }
    
    @Test
    fun measureStopTime_10minutes() {
        assumeLongPerformanceTestsEnabled()
        runPerformanceTest(600_000L, "10 minute recording")
    }
    
    @Test
    fun measureStopTime_15minutes() {
        assumeLongPerformanceTestsEnabled()
        runPerformanceTest(900_000L, "15 minute recording")
    }

    private fun assumeLongPerformanceTestsEnabled() {
        val enabled = InstrumentationRegistry.getArguments()
            .getString("runLongPerformanceTests")
            ?.equals("true", ignoreCase = true) == true

        assumeTrue(
            "Long physical-device performance benchmarks are opt-in. " +
                "Run with -Pandroid.testInstrumentationRunnerArguments.runLongPerformanceTests=true",
            enabled
        )
    }
    
    private fun runPerformanceTest(recordingDurationMs: Long, testName: String) {
        val recordingOptions = mapOf(
            "sampleRate" to 44100,
            "channels" to 1,
            "encoding" to "pcm_16bit",
            "interval" to 1000,
            "enableProcessing" to false,
            "showNotification" to false,
            "output" to mapOf(
                "primary" to mapOf("enabled" to true),
                "compressed" to mapOf("enabled" to false)
            )
        )
        
        // Start recording
        val startLatch = CountDownLatch(1)
        audioRecorderManager.startRecording(recordingOptions, object : Promise {
            override fun resolve(value: Any?) {
                startLatch.countDown()
            }
            override fun reject(code: String, message: String?, cause: Throwable?) {
                fail("Start recording failed: $message")
            }
        })
        
        assertTrue("Recording should start", startLatch.await(5, TimeUnit.SECONDS))
        assertTrue("Recording should be active", audioRecorderManager.isRecording)
        
        // Record for specified duration
        Thread.sleep(recordingDurationMs)
        
        // Measure stop time
        val stopLatch = CountDownLatch(1)
        var fileSize = 0L
        var stopResult: Map<String, Any>? = null
        
        val stopDuration = measureTimeMillis {
            audioRecorderManager.stopRecording(object : Promise {
                override fun resolve(value: Any?) {
                    when (value) {
                        is android.os.Bundle -> {
                            fileSize = value.getLong("size", 0)
                            stopResult = bundleToMap(value)
                        }
                        is Map<*, *> -> {
                            @Suppress("UNCHECKED_CAST")
                            stopResult = value as? Map<String, Any>
                            fileSize = (stopResult?.get("size") as? Long) ?: 0
                        }
                    }
                    stopLatch.countDown()
                }
                override fun reject(code: String, message: String?, cause: Throwable?) {
                    fail("Stop recording failed: $message")
                }
            })
            
            assertTrue("Stop should complete", stopLatch.await(10, TimeUnit.SECONDS))
        }
        
        // Log results
        val fileSizeMB = fileSize / (1024.0 * 1024.0)
        Log.i(TAG, """
            Performance Test: $testName
            - Recording Duration: ${recordingDurationMs}ms
            - Stop Duration: ${stopDuration}ms
            - File Size: ${"%.2f".format(fileSizeMB)}MB
            - Performance: ${if (stopDuration < getTargetTime(recordingDurationMs)) "PASS" else "FAIL"}
        """.trimIndent())
        
        println("""
            Performance Test: $testName
            - Recording Duration: ${recordingDurationMs}ms
            - Stop Duration: ${stopDuration}ms
            - File Size: ${"%.2f".format(fileSizeMB)}MB
            - Performance: ${if (stopDuration < getTargetTime(recordingDurationMs)) "PASS" else "FAIL"}
        """.trimIndent())
        
        assertFalse("Recording should not be active", audioRecorderManager.isRecording)
    }
    
    private fun getTargetTime(recordingDurationMs: Long): Long {
        return when {
            recordingDurationMs <= 5_000 -> 100
            recordingDurationMs <= 30_000 -> 150
            recordingDurationMs <= 60_000 -> 200
            recordingDurationMs <= 300_000 -> 500
            else -> 750
        }
    }
    
    private fun bundleToMap(bundle: android.os.Bundle): Map<String, Any> {
        val map = mutableMapOf<String, Any>()
        for (key in bundle.keySet()) {
            val value = bundle.get(key)
            when (value) {
                is android.os.Bundle -> map[key] = bundleToMap(value)
                else -> value?.let { map[key] = it }
            }
        }
        return map
    }
}
