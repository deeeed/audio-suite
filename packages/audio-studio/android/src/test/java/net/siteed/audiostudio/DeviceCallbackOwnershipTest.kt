package net.siteed.audiostudio

import java.io.File
import kotlin.test.assertTrue
import org.junit.Test

class DeviceCallbackOwnershipTest {
    private val moduleSource: String by lazy {
        val candidates = listOf(
            File("src/main/java/net/siteed/audiostudio/AudioStudioModule.kt"),
            File("packages/audio-studio/android/src/main/java/net/siteed/audiostudio/AudioStudioModule.kt"),
            File("../../packages/audio-studio/android/src/main/java/net/siteed/audiostudio/AudioStudioModule.kt")
        )
        (candidates.firstOrNull { it.exists() }
            ?: error("AudioStudioModule.kt not found relative to ${File(".").absolutePath}"))
            .readText()
    }

    @Test
    fun `disconnect callback captures its session before coroutine dispatch`() {
        val callbackAt = moduleSource.indexOf("override fun onDeviceDisconnected(deviceId: String)")
        val captureAt = moduleSource.indexOf(
            "val disconnectedSession = audioRecorderManager.activeRecordingSession()",
            callbackAt
        )
        val launchAt = moduleSource.indexOf("coroutineScope.launch", callbackAt)
        val dispatchAt = moduleSource.indexOf(
            "handleDeviceDisconnection(deviceId, disconnectedSession)",
            launchAt
        )
        assertTrue(
            callbackAt >= 0 && captureAt > callbackAt && launchAt > captureAt && dispatchAt > launchAt,
            "A queued disconnect must carry the session active when the delegate fired"
        )
    }

    @Test
    fun `manual routing changes and recorder restart share one session token`() {
        for ((entry, routeCall) in listOf(
            "AsyncFunction(\"selectInputDevice\")" to "audioDeviceManager.selectDeviceNow(deviceId)",
            "AsyncFunction(\"resetToDefaultDevice\")" to "audioDeviceManager.resetToDefaultDeviceNow()"
        )) {
            val entryAt = moduleSource.indexOf(entry)
            val captureAt = moduleSource.indexOf("activeRecordingSession()", entryAt)
            val routeAt = moduleSource.indexOf(routeCall, captureAt)
            val failureAt = moduleSource.indexOf("if (!", routeAt)
            val transitionAt = moduleSource.indexOf(
                "audioRecorderManager.handleDeviceChange(requestedSession)",
                failureAt
            )
            assertTrue(
                entryAt >= 0 && captureAt > entryAt && routeAt > captureAt &&
                    failureAt > routeAt && transitionAt > failureAt,
                "$entry must bind routing and transition to one session and skip failed routing"
            )
        }
    }

    @Test
    fun `fallback event is emitted only after successful session-bound transition`() {
        val handlerAt = moduleSource.indexOf("private suspend fun handleDeviceDisconnection(")
        val successAt = moduleSource.indexOf("if (success)", handlerAt)
        val transitionAt = moduleSource.indexOf(
            "val fallbackActive = audioRecorderManager.handleDeviceChange(disconnectedSession)",
            successAt
        )
        val activeAt = moduleSource.indexOf("if (fallbackActive)", transitionAt)
        val reasonAt = moduleSource.indexOf("\"reason\" to \"deviceFallback\"", activeAt)
        val pausedAt = moduleSource.indexOf("\"isPaused\" to false", reasonAt)
        val deviceAt = moduleSource.indexOf("\"deviceId\" to deviceId", pausedAt)
        assertTrue(
            handlerAt >= 0 && successAt > handlerAt && transitionAt > successAt && activeAt > transitionAt &&
                reasonAt > activeAt && pausedAt > reasonAt && deviceAt > pausedAt,
            "deviceFallback must follow successful routing and transition with its exact payload"
        )
    }
}
