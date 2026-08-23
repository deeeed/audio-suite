package net.siteed.audiostudio

import android.Manifest
import android.content.Context
import android.media.AudioRecord
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

@RunWith(AndroidJUnit4::class)
class RecorderConcurrencyInstrumentedTest {

    @get:Rule
    val grantPermissionRule: GrantPermissionRule =
        GrantPermissionRule.grant(Manifest.permission.RECORD_AUDIO)

    private lateinit var context: Context
    private lateinit var manager: AudioRecorderManager

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        AudioRecorderManager.destroy()
        manager = AudioRecorderManager.initialize(
            context = context,
            filesDir = context.filesDir,
            permissionUtils = PermissionUtils(context),
            audioDataEncoder = AudioDataEncoder(),
            eventSender = object : EventSender {
                override fun sendExpoEvent(eventName: String, params: Bundle) = Unit
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
     * assertions prove that stop wins; the timing assertion prevents the transition delay
     * from moving back under the monitor. Observing null only coordinates the interleaving.
     */
    @Test
    fun stopDuringDeviceChange_doesNotRestartADeadRecorder() {
        startRecording()
        Thread.sleep(150)
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

        val stopStartedAt = android.os.SystemClock.elapsedRealtime()
        val stopResult = stopRecording()
        val stopElapsedMs = android.os.SystemClock.elapsedRealtime() - stopStartedAt
        handler.join(3_000)

        assertFalse("Device-change handler should finish", handler.isAlive)
        assertNull("Device-change handler should not throw", handlerFailure.get())
        assertFalse("Manager should remain stopped", manager.isRecording)
        assertNull("No AudioRecord should survive stop", currentAudioRecord())
        assertTrue("Stop should not exhaust its 2-second join timeout: ${stopElapsedMs}ms", stopElapsedMs < 1_500)

        assertRecordingResult(stopResult)
    }

    @Test
    fun pauseDuringDeviceChange_doesNotRestartPausedRecorder() {
        startRecording()
        Thread.sleep(150)
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

        assertRecordingResult(stopRecording())
    }

    private fun startRecording() {
        val latch = CountDownLatch(1)
        var error: String? = null
        manager.startRecording(
            mapOf(
                "sampleRate" to SAMPLE_RATE,
                "channels" to 1,
                "encoding" to "pcm_16bit",
                "interval" to 100,
                "enableProcessing" to false,
                "filename" to "device_change_race"
            ),
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

    private fun awaitRecorderState(predicate: (AudioRecord?) -> Boolean): Boolean {
        val deadline = System.currentTimeMillis() + 2_000
        do {
            if (predicate(currentAudioRecord())) return true
            Thread.sleep(5)
        } while (System.currentTimeMillis() < deadline)
        return predicate(currentAudioRecord())
    }

    private fun currentAudioRecord(): AudioRecord? {
        val field = AudioRecorderManager::class.java.getDeclaredField("audioRecord")
        field.isAccessible = true
        return field.get(manager) as? AudioRecord
    }

    companion object {
        private const val SAMPLE_RATE = 16_000
        private const val BYTES_PER_SAMPLE = 2
        private const val MINIMUM_RECORDED_MS = 50
        private const val WAV_HEADER_BYTES = 44
    }
}
