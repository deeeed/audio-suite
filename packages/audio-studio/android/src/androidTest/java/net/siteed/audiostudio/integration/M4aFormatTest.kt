package net.siteed.audiostudio.integration

import android.Manifest
import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import expo.modules.kotlin.Promise
import net.siteed.audiostudio.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class M4aFormatTest {
    
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
        override fun sendExpoEvent(eventName: String, params: android.os.Bundle) {
            // No-op for tests
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
            stopRecordingSync()
        }
        
        // Clean up
        AudioRecorderManager.destroy()
        cleanupAudioFiles()
    }
    
    private fun cleanupAudioFiles() {
        filesDir.listFiles()?.forEach { file ->
            if (file.name.endsWith(".wav") || file.name.endsWith(".aac") || 
                file.name.endsWith(".m4a") || file.name.endsWith(".opus")) {
                file.delete()
            }
        }
    }

    @Test
    fun testAacFormat_producesM4aByDefault() {
        // Skip test if API level is too low for compressed recording
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) {
            println("Skipping M4A test - requires API 29+, current API: ${android.os.Build.VERSION.SDK_INT}")
            return
        }
        
        // Given
        val recordingOptions = mapOf(
            "sampleRate" to 44100,
            "channels" to 1,
            "encoding" to "pcm_16bit",
            "interval" to 100,
            "showNotification" to false,
            "output" to mapOf(
                "primary" to mapOf("enabled" to false),
                "compressed" to mapOf(
                    "enabled" to true,
                    "format" to "aac"
                    // preferRawStream not specified = defaults to false = M4A
                )
            )
        )

        // When - Record for 1 second
        startRecordingSync(recordingOptions)
        Thread.sleep(1000)
        val result = stopRecordingSync()

        // Then
        val compression = when (val comp = result["compression"]) {
            is android.os.Bundle -> bundleToMap(comp)
            is Map<*, *> -> comp
            else -> null
        }
        
        val compressedUri = compression?.get("compressedFileUri") as? String
        assertNotNull("Compressed file URI should not be null", compressedUri)
        
        val file = when {
            compressedUri!!.startsWith("file://") -> File(java.net.URI(compressedUri))
            compressedUri.startsWith("file:") -> File(java.net.URI(compressedUri))
            else -> File(compressedUri)
        }
        
        assertTrue("File should exist", file.exists())
        assertTrue("File should have .m4a extension", file.name.endsWith(".m4a"))
        
        // Verify it's actually an M4A file
        verifyM4aFormat(file)
    }

    @Test
    fun testAacFormat_withPreferRawStream_producesAac() {
        // Skip test if API level is too low for compressed recording
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) {
            println("Skipping raw AAC test - requires API 29+, current API: ${android.os.Build.VERSION.SDK_INT}")
            return
        }
        
        // Given
        val recordingOptions = mapOf(
            "sampleRate" to 44100,
            "channels" to 1,
            "encoding" to "pcm_16bit",
            "interval" to 100,
            "showNotification" to false,
            "output" to mapOf(
                "primary" to mapOf("enabled" to false),
                "compressed" to mapOf(
                    "enabled" to true,
                    "format" to "aac",
                    "preferRawStream" to true  // NEW: Request raw AAC stream
                )
            )
        )

        // When - Record for 1 second
        startRecordingSync(recordingOptions)
        Thread.sleep(1000)
        val result = stopRecordingSync()

        // Then
        val compression = when (val comp = result["compression"]) {
            is android.os.Bundle -> bundleToMap(comp)
            is Map<*, *> -> comp
            else -> null
        }
        
        val compressedUri = compression?.get("compressedFileUri") as? String
        assertNotNull("Compressed file URI should not be null", compressedUri)
        
        val file = when {
            compressedUri!!.startsWith("file://") -> File(java.net.URI(compressedUri))
            compressedUri.startsWith("file:") -> File(java.net.URI(compressedUri))
            else -> File(compressedUri)
        }
        
        assertTrue("File should exist", file.exists())
        assertTrue("File should have .aac extension", file.name.endsWith(".aac"))
        
        // Verify it's actually an AAC ADTS file
        verifyAacAdtsFormat(file)
    }

    @Test
    fun testOpusFormat_producesOpus() {
        // Skip test if API level is too low for Opus recording
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) {
            println("Skipping Opus test - requires API 29+, current API: ${android.os.Build.VERSION.SDK_INT}")
            return
        }
        
        // Given
        val recordingOptions = mapOf(
            "sampleRate" to 48000,
            "channels" to 1,
            "encoding" to "pcm_16bit",
            "interval" to 100,
            "showNotification" to false,
            "output" to mapOf(
                "primary" to mapOf("enabled" to false),
                "compressed" to mapOf(
                    "enabled" to true,
                    "format" to "opus"
                )
            )
        )

        // When - Record for 1 second
        startRecordingSync(recordingOptions)
        Thread.sleep(1000)
        val result = stopRecordingSync()

        // Then
        val compression = when (val comp = result["compression"]) {
            is android.os.Bundle -> bundleToMap(comp)
            is Map<*, *> -> comp
            else -> null
        }
        
        val compressedUri = compression?.get("compressedFileUri") as? String
        assertNotNull("Compressed file URI should not be null", compressedUri)
        
        val file = when {
            compressedUri!!.startsWith("file://") -> File(java.net.URI(compressedUri))
            compressedUri.startsWith("file:") -> File(java.net.URI(compressedUri))
            else -> File(compressedUri)
        }
        
        assertTrue("File should exist", file.exists())
        assertTrue("File should have .opus extension", file.name.endsWith(".opus"))
    }

    // Helper methods from existing tests
    private fun startRecordingSync(recordingOptions: Map<String, Any?>): Map<String, Any?> {
        val startLatch = CountDownLatch(1)
        var recordingResult: Map<String, Any?>? = null
        
        audioRecorderManager.startRecording(recordingOptions, object : Promise {
            override fun resolve(value: Any?) {
                when (value) {
                    is android.os.Bundle -> recordingResult = bundleToMap(value)
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
            
            override fun reject(code: String?, message: String?, cause: Throwable?) {
                fail("Recording start failed: $code - $message")
            }
        })
        
        assertTrue("Recording should start within 2 seconds", startLatch.await(2, TimeUnit.SECONDS))
        return recordingResult ?: throw AssertionError("Recording result should not be null")
    }
    
    private fun stopRecordingSync(): Map<String, Any?> {
        val stopLatch = CountDownLatch(1)
        var stopResult: Map<String, Any?>? = null
        
        audioRecorderManager.stopRecording(object : Promise {
            override fun resolve(value: Any?) {
                when (value) {
                    is android.os.Bundle -> stopResult = bundleToMap(value)
                    is Map<*, *> -> {
                        @Suppress("UNCHECKED_CAST")
                        stopResult = value as? Map<String, Any>
                    }
                    else -> {
                        fail("Unexpected stop result type: ${value?.javaClass?.name}")
                    }
                }
                stopLatch.countDown()
            }
            
            override fun reject(code: String?, message: String?, cause: Throwable?) {
                fail("Recording stop failed: $code - $message")
            }
        })
        
        assertTrue("Recording should stop within 2 seconds", stopLatch.await(2, TimeUnit.SECONDS))
        return stopResult ?: throw AssertionError("Stop result should not be null")
    }
    
    private fun bundleToMap(bundle: android.os.Bundle): Map<String, Any?> {
        val map = mutableMapOf<String, Any?>()
        for (key in bundle.keySet()) {
            map[key] = bundle.get(key)
        }
        return map
    }

    private fun verifyM4aFormat(file: File) {
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(file.absolutePath)
            assertTrue("Should have at least one track", extractor.trackCount > 0)
            
            val format = extractor.getTrackFormat(0)
            val mimeType = format.getString(MediaFormat.KEY_MIME)
            
            // Debug output
            println("Detected MIME type: $mimeType")
            
            // For M4A files, the MIME type should be audio/mp4 or contain aac
            val isValidM4aMimeType = mimeType?.let { mime ->
                mime.contains("mp4", ignoreCase = true) || 
                mime.contains("aac", ignoreCase = true) ||
                mime.contains("audio/", ignoreCase = true)
            } ?: false
            
            assertTrue("MIME type should be valid for M4A format, got: $mimeType", isValidM4aMimeType)
            
            // Read file header to verify MP4 container
            val header = file.inputStream().use { it.readNBytes(20) }
            val headerString = String(header, Charsets.ISO_8859_1)
            val hasFtyp = headerString.contains("ftyp")
            assertTrue("File should contain ftyp box (MP4 container)", hasFtyp)
        } finally {
            extractor.release()
        }
    }

    private fun verifyAacAdtsFormat(file: File) {
        // ADTS header starts with 0xFFF
        val header = file.inputStream().use { it.readNBytes(2) }
        val syncWord = ((header[0].toInt() and 0xFF) shl 4) or ((header[1].toInt() and 0xF0) shr 4)
        assertEquals("ADTS sync word should be 0xFFF", 0xFFF, syncWord)
    }
}