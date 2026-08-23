package net.siteed.audiostudio

import android.Manifest
import android.content.Context
import android.media.AudioRecord
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import expo.modules.kotlin.Promise
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(AndroidJUnit4::class)
class RecorderConcurrencyInstrumentedTest {

    @get:Rule
    val grantPermissionRule: GrantPermissionRule =
        GrantPermissionRule.grant(Manifest.permission.RECORD_AUDIO)

    private lateinit var context: Context
    private lateinit var manager: AudioRecorderManager
    private val interruptionEvents = CopyOnWriteArrayList<Bundle>()

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        AudioRecorderManager.destroy()
        interruptionEvents.clear()
        manager = AudioRecorderManager.initialize(
            context = context,
            filesDir = context.filesDir,
            permissionUtils = PermissionUtils(context),
            audioDataEncoder = AudioDataEncoder(),
            eventSender = object : EventSender {
                override fun sendExpoEvent(eventName: String, params: Bundle) {
                    if (eventName == Constants.RECORDING_INTERRUPTED_EVENT_NAME) {
                        interruptionEvents.add(Bundle(params))
                    }
                }
            },
            enablePhoneStateHandling = false,
            enableBackgroundAudio = false
        )
    }

    @After
    fun tearDown() {
        AudioRecorderManager.destroy()
        context.filesDir.listFiles()?.filter { it.name.startsWith("device_change_race") }
            ?.forEach { it.delete() }
    }

    /**
     * The production transition leaves audioRecord null for 200 ms, which gives this 5 ms
     * poll enough time to request stop inside the old race window. The final ownership
     * assertions prove that stop wins; RecorderLockingTest guards the static lock ordering.
     * Observing null only coordinates the interleaving.
     */
    @Test
    fun stopDuringDeviceChange_doesNotRestartADeadRecorder() {
        startRecording()
        // Establish enough PCM for the file-floor assertion before opening the race window.
        Thread.sleep(300)
        val handlerFailure = AtomicReference<Throwable?>()
        val handler = Thread {
            try {
                manager.handleDeviceChange()
            } catch (error: Throwable) {
                handlerFailure.set(error)
            }
        }
        handler.start()

        assertTrue(
            "Device change should release the old recorder before reinitializing",
            awaitRecorderState { it == null }
        )

        val stopResult = stopRecording()
        handler.join(3_000)

        assertFalse("Device-change handler should finish", handler.isAlive)
        assertNull("Device-change handler should not throw", handlerFailure.get())
        assertFalse("Manager should remain stopped", manager.isRecording)
        assertNull("No AudioRecord should survive stop", currentAudioRecord())
        assertFalse("Stopped transition should not emit deviceChanged", emittedReasons().contains("deviceChanged"))

        assertRecordingResult(stopResult)
    }

    @Test
    fun pauseDuringDeviceChange_doesNotRestartPausedRecorder() {
        val compressed = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q
        startRecording(compressed = compressed)
        // Establish enough PCM for the file-floor assertion before opening the race window.
        Thread.sleep(300)
        val handlerFailure = AtomicReference<Throwable?>()
        val handler = Thread {
            try {
                manager.handleDeviceChange()
            } catch (error: Throwable) {
                handlerFailure.set(error)
            }
        }
        handler.start()

        assertTrue(
            "Device change should release the old recorder before reinitializing",
            awaitRecorderState { it == null }
        )
        pauseRecording()
        handler.join(3_000)

        assertFalse("Device-change handler should finish", handler.isAlive)
        assertNull("Device-change handler should not throw", handlerFailure.get())
        val status = manager.getStatus()
        assertTrue("Manager should remain recording", status.getBoolean("isRecording"))
        assertTrue("Manager should remain paused", status.getBoolean("isPaused"))
        assertNull("No AudioRecord should restart while paused", currentAudioRecord())
        assertFalse("Paused transition should not emit deviceChanged", emittedReasons().contains("deviceChanged"))

        val pausedSize = currentRecordedSize()
        resumeRecording()
        assertTrue(
            "Resumed recording should capture new PCM",
            awaitRecordedSizeAbove(pausedSize)
        )
        val result = stopRecording()
        assertRecordingResult(result)
        if (compressed) {
            assertCompressedRecordingResult(result)
        }
    }

    private fun startRecording(compressed: Boolean = false) {
        val latch = CountDownLatch(1)
        var error: String? = null
        manager.startRecording(
            buildMap {
                put("sampleRate", SAMPLE_RATE)
                put("channels", 1)
                put("encoding", "pcm_16bit")
                put("interval", 100)
                put("enableProcessing", false)
                // This test targets recorder ownership, not the foreground-service contract.
                put("keepAwake", false)
                put("filename", "device_change_race")
                if (compressed) {
                    put("output", mapOf(
                        "compressed" to mapOf(
                            "enabled" to true,
                            "format" to "aac",
                            "bitrate" to 128_000
                        )
                    ))
                }
            },
            object : Promise {
                override fun resolve(value: Any?) {
                    latch.countDown()
                }

                override fun reject(code: String?, message: String?, cause: Throwable?) {
                    error = "$code: $message"
                    latch.countDown()
                }
            }
        )
        assertTrue("Recording should start", latch.await(3, TimeUnit.SECONDS))
        assertNull("Recording start failed", error)
    }

    private fun stopRecording(): Bundle {
        val latch = CountDownLatch(1)
        var result: Bundle? = null
        var error: String? = null
        manager.stopRecording(object : Promise {
            override fun resolve(value: Any?) {
                result = value as? Bundle
                latch.countDown()
            }

            override fun reject(code: String?, message: String?, cause: Throwable?) {
                error = "$code: $message"
                latch.countDown()
            }
        })
        assertTrue("Recording should stop", latch.await(3, TimeUnit.SECONDS))
        assertNull("Recording stop failed", error)
        assertNotNull("Recording stop should return metadata", result)
        return result!!
    }

    private fun pauseRecording() {
        val latch = CountDownLatch(1)
        var error: String? = null
        manager.pauseRecording(object : Promise {
            override fun resolve(value: Any?) {
                latch.countDown()
            }

            override fun reject(code: String?, message: String?, cause: Throwable?) {
                error = "$code: $message"
                latch.countDown()
            }
        })
        assertTrue("Recording should pause", latch.await(3, TimeUnit.SECONDS))
        assertNull("Recording pause failed", error)
    }

    private fun resumeRecording() {
        val latch = CountDownLatch(1)
        var error: String? = null
        manager.resumeRecording(object : Promise {
            override fun resolve(value: Any?) {
                latch.countDown()
            }

            override fun reject(code: String?, message: String?, cause: Throwable?) {
                error = "$code: $message"
                latch.countDown()
            }
        })
        assertTrue("Recording should resume", latch.await(3, TimeUnit.SECONDS))
        assertNull("Recording resume failed", error)
    }

    private fun assertRecordingResult(result: Bundle) {
        val fileUri = result.getString("fileUri")
        assertNotNull("Stop should return a file URI", fileUri)
        val minimumFileBytes = WAV_HEADER_BYTES +
            SAMPLE_RATE * BYTES_PER_SAMPLE * MINIMUM_RECORDED_MS / 1_000
        val fileBytes = File(java.net.URI(fileUri)).length()
        assertTrue(
            "Stopped recording should contain at least ${MINIMUM_RECORDED_MS}ms of PCM: $fileBytes bytes",
            fileBytes >= minimumFileBytes
        )
        assertTrue("Stopped recording should have positive duration", result.getLong("durationMs") > 0)
    }

    private fun assertCompressedRecordingResult(result: Bundle) {
        val compression = result.getBundle("compression")
        assertNotNull("Compression metadata should exist", compression)
        val fileUri = compression!!.getString("compressedFileUri")
        assertNotNull("Compressed file URI should exist", fileUri)
        val file = File(java.net.URI(fileUri))
        assertTrue("Compressed recording should contain audio", file.length() > 0)
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(file.absolutePath)
            assertTrue("Compressed recording should contain an audio track", extractor.trackCount > 0)
            val audioDurations = (0 until extractor.trackCount).mapNotNull { track ->
                val format = extractor.getTrackFormat(track)
                val mimeType = format.getString(MediaFormat.KEY_MIME)
                if (
                    mimeType?.startsWith("audio/") == true &&
                    format.containsKey(MediaFormat.KEY_DURATION)
                ) {
                    format.getLong(MediaFormat.KEY_DURATION)
                } else {
                    null
                }
            }
            assertTrue("Compressed recording should contain an audio track", audioDurations.isNotEmpty())
            assertTrue("Compressed recording should have positive duration", (audioDurations.maxOrNull() ?: 0L) > 0)
        } finally {
            extractor.release()
        }
    }

    private fun emittedReasons(): List<String> =
        interruptionEvents.mapNotNull { it.getString("reason") }

    private fun awaitRecordedSizeAbove(size: Long): Boolean {
        val deadline = System.currentTimeMillis() + 2_000L
        do {
            if (currentRecordedSize() > size) return true
            Thread.sleep(20)
        } while (System.currentTimeMillis() < deadline)
        return currentRecordedSize() > size
    }

    private fun awaitRecorderState(predicate: (AudioRecord?) -> Boolean): Boolean {
        val deadline = System.currentTimeMillis() + 2_000
        do {
            if (predicate(currentAudioRecord())) return true
            Thread.sleep(5)
        } while (System.currentTimeMillis() < deadline)
        return predicate(currentAudioRecord())
    }

    private fun currentAudioRecord(): AudioRecord? {
        return recorderStateField("audioRecord") as? AudioRecord
    }

    private fun currentRecordedSize(): Long {
        return (recorderStateField("totalDataSize") as Number).toLong()
    }

    private fun recorderStateField(name: String): Any? {
        val lockField = AudioRecorderManager::class.java.getDeclaredField("audioRecordLock")
        lockField.isAccessible = true
        val lock = checkNotNull(lockField.get(manager))
        val field = AudioRecorderManager::class.java.getDeclaredField(name)
        field.isAccessible = true
        return synchronized(lock) {
            field.get(manager)
        }
    }

    companion object {
        private const val SAMPLE_RATE = 16_000
        private const val BYTES_PER_SAMPLE = 2
        private const val MINIMUM_RECORDED_MS = 50
        private const val WAV_HEADER_BYTES = 44
    }
}
