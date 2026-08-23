package net.siteed.audiostudio

import android.Manifest
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.ParcelFileDescriptor
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
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class ForegroundServiceLifecycleInstrumentedTest {

    @get:Rule
    val grantPermissionRule: GrantPermissionRule = if (
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
    ) {
        GrantPermissionRule.grant(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.POST_NOTIFICATIONS
        )
    } else {
        GrantPermissionRule.grant(Manifest.permission.RECORD_AUDIO)
    }

    private lateinit var context: Context
    private lateinit var manager: AudioRecorderManager

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        org.junit.Assume.assumeTrue(
            "AudioRecorderManager.startRecording requires Android 11+",
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        )
        AudioRecorderManager.destroy()
        AudioRecordingService.stopService(context)
        assertTrue("Previous foreground service should stop", awaitServiceState(false))

        manager = AudioRecorderManager.initialize(
            context = context,
            filesDir = context.filesDir,
            permissionUtils = PermissionUtils(context),
            audioDataEncoder = AudioDataEncoder(),
            eventSender = object : EventSender {
                override fun sendExpoEvent(eventName: String, params: Bundle) = Unit
            },
            enablePhoneStateHandling = false,
            enableBackgroundAudio = true
        )
    }

    @After
    fun tearDown() {
        try {
            AudioRecorderManager.destroy()
            AudioRecordingService.stopService(context)
            assertTrue("Foreground service should stop during teardown", awaitServiceState(false))
        } finally {
            context.filesDir.listFiles()?.filter { it.name.startsWith("service_lifecycle_") }
                ?.forEach { it.delete() }
        }
    }

    @Test
    fun defaultConfig_stopsServiceAfterRecording() {
        startRecording(options("default"))
        assertTrue("Default config should start the service", awaitServiceState(true))

        Thread.sleep(RECORDING_MS)
        val result = stopRecording()

        assertRecordingResult(result)
        assertTrue("Default config should stop the service", awaitServiceState(false))
    }

    @Test
    fun notificationConfig_stopsServiceAfterRecording() {
        startRecording(options("notification", showNotification = true, keepAwake = false))
        assertTrue("Notification config should start the service", awaitServiceState(true))

        Thread.sleep(RECORDING_MS)
        val result = stopRecording()

        assertRecordingResult(result)
        assertTrue("Notification config should stop the service", awaitServiceState(false))
    }

    @Test
    fun defaultConfig_cleanupStopsService() {
        startRecording(options("default_cleanup"))
        assertTrue("Default config should start the service", awaitServiceState(true))

        AudioRecorderManager.destroy()

        assertTrue("Cleanup should stop the default-config service", awaitServiceState(false))
    }

    @Test
    fun preparedSuccessor_duringCleanup_stopsOldServiceAndPreservesPreparation() {
        val recordingOptions = options("prepared_successor_old")
        val successorOptions = options("prepared_successor_new")
        startRecording(recordingOptions)
        assertTrue("Recording should start the service", awaitServiceState(true))

        val blockerReady = CountDownLatch(1)
        val successorPrepared = CountDownLatch(1)
        val prepareOnInterrupt = AtomicBoolean(false)
        val successorResult = AtomicReference<Boolean?>(null)
        val blocker = Thread {
            blockerReady.countDown()
            try {
                Thread.sleep(Long.MAX_VALUE)
            } catch (_: InterruptedException) {
                try {
                    if (prepareOnInterrupt.get()) {
                        // cleanup phase 0 cleared _isRecording before interrupting this
                        // worker. Preparation reclaims the old recorder and publishes the
                        // successor before the worker exits, so phase 2 must see its session.
                        successorResult.set(manager.prepareRecording(successorOptions))
                    }
                } finally {
                    successorPrepared.countDown()
                }
            }
        }
        blocker.isDaemon = true

        val threadRef = recordingThreadReference()
        val recordingState = recordingState()
        val cleanupThread = Thread { manager.cleanup() }
        var displacedWorker: Thread? = null
        var cleanupStarted = false
        try {
            blocker.start()
            assertTrue("Blocking worker should start", blockerReady.await(1, TimeUnit.SECONDS))

            displacedWorker = threadRef.getAndSet(blocker)
            assertNotNull("Active recording should have a PCM worker", displacedWorker)

            // Stop and join the displaced worker before cleanup's bounded two-second join.
            // Restore the flag afterwards so cleanup still claims an active recording.
            recordingState.set(false)
            displacedWorker!!.join(5_000L)
            assertFalse("Displaced recording worker should stop", displacedWorker!!.isAlive)
            recordingState.set(true)
            val ownedSession = sessionId()

            prepareOnInterrupt.set(true)
            cleanupStarted = true
            cleanupThread.start()
            assertTrue(
                "Cleanup worker should publish the prepared successor",
                successorPrepared.await(5, TimeUnit.SECONDS)
            )
            assertTrue("Successor preparation should succeed", successorResult.get() == true)
            assertTrue("Successor should be prepared", manager.isPrepared)
            assertTrue("Successor preparation should publish a new session", sessionId() > ownedSession)
            cleanupThread.join(3_000L)

            assertFalse("Cleanup should finish within 3 seconds", cleanupThread.isAlive)
            assertTrue("Cleanup should stop the old service", awaitServiceState(false))
            // join establishes visibility for cleanup-thread writes before this plain read.
            assertTrue("Cleanup should preserve the prepared successor", manager.isPrepared)
        } finally {
            prepareOnInterrupt.set(false)
            recordingState.set(false)
            displacedWorker?.interrupt()
            displacedWorker?.join(3_000L)
            blocker.interrupt()
            blocker.join(3_000L)
            if (cleanupStarted) {
                cleanupThread.join(3_000L)
            } else {
                // Restore active ownership so failure cleanup stops and releases recorders.
                recordingState.set(true)
                manager.cleanup()
            }
        }
    }

    @Test
    fun disabledFlags_leaveServiceStopped() {
        startRecording(options("disabled", showNotification = false, keepAwake = false))
        assertTrue("Both flags disabled should not leave a running service", serviceRemainsStopped())

        Thread.sleep(RECORDING_MS)
        assertRecordingResult(stopRecording())
        assertTrue("Stopping should leave the service stopped", awaitServiceState(false))
    }

    private fun options(
        name: String,
        showNotification: Boolean? = null,
        keepAwake: Boolean? = null
    ): Map<String, Any> = buildMap {
        put("sampleRate", 16_000)
        put("channels", 1)
        put("encoding", "pcm_16bit")
        put("interval", 100)
        put("enableProcessing", false)
        put("filename", "service_lifecycle_$name")
        showNotification?.let { put("showNotification", it) }
        keepAwake?.let { put("keepAwake", it) }
    }

    private fun startRecording(options: Map<String, Any>) {
        val latch = CountDownLatch(1)
        var error: String? = null
        manager.startRecording(options, object : Promise {
            override fun resolve(value: Any?) {
                latch.countDown()
            }

            override fun reject(code: String?, message: String?, cause: Throwable?) {
                error = "$code: $message"
                latch.countDown()
            }
        })

        assertTrue("Recording should start", latch.await(3, TimeUnit.SECONDS))
        assertNull("Recording start failed", error)
    }

    private fun stopRecording(): Map<String, Any> {
        val latch = CountDownLatch(1)
        var result: Map<String, Any>? = null
        var error: String? = null
        manager.stopRecording(object : Promise {
            override fun resolve(value: Any?) {
                result = when (value) {
                    is Bundle -> mapOf(
                        "fileUri" to value.getString("fileUri").orEmpty(),
                        "durationMs" to value.getLong("durationMs"),
                        "size" to value.getLong("size")
                    )
                    else -> null
                }
                latch.countDown()
            }

            override fun reject(code: String?, message: String?, cause: Throwable?) {
                error = "$code: $message"
                latch.countDown()
            }
        })

        assertTrue("Recording should stop", latch.await(5, TimeUnit.SECONDS))
        assertNull("Recording stop failed", error)
        assertNotNull("Recording stop should return metadata", result)
        return result!!
    }

    private fun assertRecordingResult(result: Map<String, Any>) {
        val fileUri = result["fileUri"] as? String
        assertTrue("Recording should return a file URI: $fileUri", fileUri?.startsWith("file:") == true)
        val file = File(java.net.URI(fileUri!!))
        assertTrue("Recording should contain PCM data", file.length() > 44)
        assertTrue("Recording duration should be positive", (result["durationMs"] as Number).toLong() > 0)
    }

    private fun awaitServiceState(expectedRunning: Boolean): Boolean {
        val deadline = System.currentTimeMillis() + SERVICE_TIMEOUT_MS
        do {
            if (isServiceRunning() == expectedRunning) return true
            Thread.sleep(SERVICE_POLL_MS)
        } while (System.currentTimeMillis() < deadline)
        return isServiceRunning() == expectedRunning
    }

    private fun serviceRemainsStopped(): Boolean {
        val deadline = System.currentTimeMillis() + SERVICE_ABSENCE_OBSERVATION_MS
        do {
            if (isServiceRunning()) return false
            Thread.sleep(SERVICE_POLL_MS)
        } while (System.currentTimeMillis() < deadline)
        return !isServiceRunning()
    }

    private fun isServiceRunning(): Boolean {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val output = instrumentation.uiAutomation.executeShellCommand(
            "dumpsys activity services ${context.packageName}"
        )
        val dump = ParcelFileDescriptor.AutoCloseInputStream(output)
            .bufferedReader()
            .use { it.readText() }
        // The service package differs from the generated `.test` package, so dumpsys
        // prints the full class name rather than abbreviating it to `/.ClassName`.
        return dump.contains(AudioRecordingService::class.java.name)
    }

    // These probes intentionally fail on a production rename. Keeping recorder ownership
    // private is preferable to widening production visibility for one instrumentation test.
    @Suppress("UNCHECKED_CAST")
    private fun recordingThreadReference(): AtomicReference<Thread?> {
        val field = AudioRecorderManager::class.java.getDeclaredField("recordingThreadRef")
        field.isAccessible = true
        return field.get(manager) as AtomicReference<Thread?>
    }

    private fun recordingState(): AtomicBoolean {
        val field = AudioRecorderManager::class.java.getDeclaredField("_isRecording")
        field.isAccessible = true
        return field.get(manager) as AtomicBoolean
    }

    private fun sessionId(): Long {
        val field = AudioRecorderManager::class.java.getDeclaredField("sessionId")
        field.isAccessible = true
        // Field.getLong preserves the volatile read used by production.
        return field.getLong(manager)
    }

    companion object {
        private const val RECORDING_MS = 300L
        private const val SERVICE_POLL_MS = 100L
        private const val SERVICE_ABSENCE_OBSERVATION_MS = 500L
        private const val SERVICE_TIMEOUT_MS = 3_000L
    }
}
