package net.siteed.audiostudio

import android.Manifest
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import expo.modules.kotlin.Promise
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * Device-only regression skeleton for compressed Opus range decode. It records a
 * short Opus-only file, then verifies the range loader reports metadata and byte
 * length from final target-converted PCM rather than source decoder output.
 */
@RunWith(AndroidJUnit4::class)
class OpusRangeDecodeRegressionInstrumentedTest {
    @get:Rule
    val grantPermissionRule: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.RECORD_AUDIO)

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val filesDir = context.filesDir
    private lateinit var audioRecorderManager: AudioRecorderManager

    @Before
    fun setUp() {
        assumeTrue("Opus MediaCodec recording requires Android Q+", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
        audioRecorderManager = AudioRecorderManager.initialize(
            context = context,
            filesDir = filesDir,
            permissionUtils = PermissionUtils(context),
            audioDataEncoder = AudioDataEncoder(),
            eventSender = object : EventSender {
                override fun sendExpoEvent(eventName: String, params: android.os.Bundle): Boolean = true
            },
            enablePhoneStateHandling = false,
            enableBackgroundAudio = false
        )
        cleanupGeneratedAudio()
    }

    @After
    fun tearDown() {
        if (::audioRecorderManager.isInitialized && audioRecorderManager.isRecording) {
            runCatching { stopRecordingSync() }
        }
        AudioRecorderManager.destroy()
        cleanupGeneratedAudio()
    }

    @Test
    fun loadAudioRange_returnsTargetPcmMetadataForGeneratedOpusRecording() {
        startRecordingSync(
            mapOf(
                "sampleRate" to 48_000,
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
        )
        Thread.sleep(RECORDING_DURATION_MS + 250L)
        val opusFile = resolveCompressedFile(stopRecordingSync())

        val audioData = AudioProcessor(filesDir).loadAudioRange(
            fileUri = opusFile.absolutePath,
            startTimeMs = 0,
            endTimeMs = REQUESTED_RANGE_MS,
            config = DecodingConfig(
                targetSampleRate = TARGET_SAMPLE_RATE,
                targetChannels = TARGET_CHANNELS,
                targetBitDepth = TARGET_BIT_DEPTH,
                normalizeAudio = false
            )
        )

        val decoded = requireNotNull(audioData) { "Opus range should decode without BufferOverflowException" }
        assertEquals("sampleRate should describe final converted PCM", TARGET_SAMPLE_RATE, decoded.sampleRate)
        assertEquals("channels should describe final converted PCM", TARGET_CHANNELS, decoded.channels)
        assertEquals("bitDepth should describe final converted PCM", TARGET_BIT_DEPTH, decoded.bitDepth)

        val expectedBytes = TARGET_SAMPLE_RATE * TARGET_CHANNELS * (TARGET_BIT_DEPTH / 8) * REQUESTED_RANGE_MS / 1_000
        val toleranceBytes = TARGET_SAMPLE_RATE * TARGET_CHANNELS * (TARGET_BIT_DEPTH / 8) / 2
        assertTrue(
            "final PCM byte length should be near requested target duration: expected=$expectedBytes actual=${decoded.data.size}",
            abs(decoded.data.size - expectedBytes) <= toleranceBytes
        )
    }

    private fun startRecordingSync(recordingOptions: Map<String, Any?>) {
        val latch = CountDownLatch(1)
        var rejected: String? = null
        audioRecorderManager.startRecording(recordingOptions, object : Promise {
            override fun resolve(value: Any?) {
                latch.countDown()
            }

            override fun reject(code: String?, message: String?, cause: Throwable?) {
                rejected = "$code - $message"
                latch.countDown()
            }
        })
        assertTrue("Recording should start within 2 seconds", latch.await(2, TimeUnit.SECONDS))
        rejected?.let { throw AssertionError("Recording start failed: $it") }
    }

    private fun stopRecordingSync(): Map<String, Any?> {
        val latch = CountDownLatch(1)
        var result: Map<String, Any?>? = null
        var rejected: String? = null
        audioRecorderManager.stopRecording(object : Promise {
            override fun resolve(value: Any?) {
                result = when (value) {
                    is android.os.Bundle -> bundleToMap(value)
                    is Map<*, *> -> value.entries.associate { it.key.toString() to it.value }
                    else -> throw AssertionError("Unexpected stop result type: ${value?.javaClass?.name}")
                }
                latch.countDown()
            }

            override fun reject(code: String?, message: String?, cause: Throwable?) {
                rejected = "$code - $message"
                latch.countDown()
            }
        })
        assertTrue("Recording should stop within 2 seconds", latch.await(2, TimeUnit.SECONDS))
        rejected?.let { throw AssertionError("Recording stop failed: $it") }
        return result ?: throw AssertionError("Stop result should not be null")
    }

    private fun resolveCompressedFile(result: Map<String, Any?>): File {
        val compression = result["compression"]
        val compressionMap = when (compression) {
            is android.os.Bundle -> bundleToMap(compression)
            is Map<*, *> -> compression.entries.associate { it.key.toString() to it.value }
            else -> emptyMap()
        }
        val uri = compressionMap["compressedFileUri"] as? String
            ?: throw AssertionError("Compressed Opus URI should be present in stop result: $result")
        val file = when {
            uri.startsWith("file://") || uri.startsWith("file:") -> File(URI(uri))
            else -> File(uri)
        }
        assertTrue("Generated Opus file should exist: ${file.absolutePath}", file.exists())
        assertTrue("Generated file should be Opus: ${file.name}", file.name.endsWith(".opus"))
        return file
    }

    private fun bundleToMap(bundle: android.os.Bundle): Map<String, Any?> =
        bundle.keySet().associateWith { key -> bundle.get(key) }

    private fun cleanupGeneratedAudio() {
        filesDir.listFiles()?.forEach { file ->
            if (file.name.startsWith("recording_") && file.extension in setOf("opus", "wav", "m4a", "aac")) {
                file.delete()
            }
        }
    }

    companion object {
        private const val RECORDING_DURATION_MS = 2_000L
        private const val REQUESTED_RANGE_MS = 2_000L
        private const val TARGET_SAMPLE_RATE = 16_000
        private const val TARGET_CHANNELS = 1
        private const val TARGET_BIT_DEPTH = 16
    }
}
