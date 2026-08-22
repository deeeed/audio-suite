package net.siteed.audiostudio

import org.junit.Test
import org.junit.Assert.*
import java.io.File

/**
 * Guards the foreground-service start/stop symmetry behind #474.
 *
 * The bug was a drift between two conditions written in different places: starting the
 * service required `(showNotification || keepAwake) && enableBackgroundAudio`, while both
 * stop paths required `showNotification` alone. With the default config — `keepAwake` true
 * and `showNotification` false — every recording started a service nothing ever stopped,
 * leaving an ongoing recording notification after the recording had finished.
 *
 * These are source assertions rather than behavioural tests. Driving the real lifecycle
 * needs an instrumented run with a live AudioRecord and a bound service; what can be
 * checked cheaply, and what actually broke, is that the three call sites still agree.
 */
class ForegroundServiceLifecycleTest {

    private val managerSource: String by lazy {
        val f = File("src/main/java/net/siteed/audiostudio/AudioRecorderManager.kt")
        assertTrue("AudioRecorderManager.kt should be readable from the module dir", f.exists())
        f.readText()
    }

    @Test
    fun defaultConfigKeepsAwakeWithoutNotification() {
        val result = RecordingConfig.fromMap(
            mapOf("sampleRate" to 44100, "channels" to 1, "encoding" to "pcm_16bit")
        )
        assertTrue("Config creation should succeed", result.isSuccess)
        val (config, _) = result.getOrThrow()

        // This pairing is what made the bug reachable by default rather than exotic.
        assertTrue("keepAwake should default to true", config.keepAwake)
        assertFalse("showNotification should default to false", config.showNotification)
    }

    @Test
    fun serviceStartConditionCoversKeepAwake() {
        val predicate = Regex(
            """private fun serviceWasStartedFor\([^)]*\)\s*:\s*Boolean\s*=\s*([^\n]+)"""
        ).find(managerSource)
        assertNotNull("serviceWasStartedFor should exist as a single shared predicate", predicate)

        val body = predicate!!.groupValues[1]
        assertTrue(
            "The predicate must consider keepAwake, or default recordings start an unstoppable service: $body",
            body.contains("keepAwake")
        )
        assertTrue(
            "The predicate must consider showNotification: $body",
            body.contains("showNotification")
        )
        assertTrue(
            "The predicate must respect enableBackgroundAudio: $body",
            body.contains("enableBackgroundAudio")
        )
    }

    @Test
    fun everyServiceStopIsGuardedByTheSharedPredicate() {
        val stopSites = Regex("""AudioRecordingService\.stopService""").findAll(managerSource).count()
        assertTrue("Expected at least two stopService call sites, found $stopSites", stopSites >= 2)

        // Each stopService must be reached through serviceWasStartedFor, or be the
        // orphan-cleanup path which stops the service precisely because it is orphaned.
        managerSource.lines().forEachIndexed { index, line ->
            if (!line.contains("AudioRecordingService.stopService")) return@forEachIndexed

            val preceding = managerSource.lines()
                .subList(maxOf(0, index - 6), index)
                .joinToString("\n")

            val guarded = preceding.contains("serviceWasStartedFor")
            val orphanCleanup = preceding.contains("orphaned") || preceding.contains("isServiceRunning")

            assertTrue(
                "stopService at line ${index + 1} is guarded by neither serviceWasStartedFor " +
                    "nor the orphan check. A stop condition that does not mirror the start " +
                    "condition is exactly the #474 defect.",
                guarded || orphanCleanup
            )
        }
    }

    @Test
    fun noStopSiteGuardsOnShowNotificationAlone() {
        // The original defect, spelled out: `if (recordingConfig.showNotification)` wrapping
        // a stopService call. Notification teardown may still be guarded that way; the
        // service teardown may not.
        val offending = Regex(
            """if \([^)]*showNotification\)\s*\{(?:(?!\}|serviceWasStartedFor)[\s\S]){0,240}?AudioRecordingService\.stopService"""
        ).find(managerSource)

        assertNull(
            "A stopService call is guarded by showNotification alone. With the default " +
                "config (keepAwake=true, showNotification=false) the service starts and is " +
                "never stopped, which is #474.",
            offending
        )
    }
}
