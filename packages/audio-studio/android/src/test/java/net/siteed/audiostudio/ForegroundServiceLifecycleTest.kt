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
 * The rule now lives in one pure function, so most of this file exercises it as Kotlin
 * with a truth table. Only the wiring check has to read source text, because whether the
 * three call sites route through that function is not observable from a JVM test.
 */
class ForegroundServiceLifecycleTest {

    private fun configOf(showNotification: Boolean, keepAwake: Boolean): RecordingConfig {
        val result = RecordingConfig.fromMap(
            mapOf(
                "sampleRate" to 44100,
                "channels" to 1,
                "encoding" to "pcm_16bit",
                "showNotification" to showNotification,
                "keepAwake" to keepAwake
            )
        )
        assertTrue("Config creation should succeed", result.isSuccess)
        return result.getOrThrow().first
    }

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
    fun requiresForegroundServiceTruthTable() {
        // background enabled: either flag is enough to need the service.
        assertTrue(
            "showNotification alone needs the service",
            AudioRecorderManager.requiresForegroundService(configOf(true, false), true)
        )
        assertTrue(
            "keepAwake alone needs the service — this is the #474 case",
            AudioRecorderManager.requiresForegroundService(configOf(false, true), true)
        )
        assertTrue(
            "both flags need the service",
            AudioRecorderManager.requiresForegroundService(configOf(true, true), true)
        )
        assertFalse(
            "neither flag needs no service",
            AudioRecorderManager.requiresForegroundService(configOf(false, false), true)
        )

        // background disabled: nothing starts the service, so nothing must stop one.
        assertFalse(
            "background audio off means no service, even with showNotification",
            AudioRecorderManager.requiresForegroundService(configOf(true, false), false)
        )
        assertFalse(
            "background audio off means no service, even with keepAwake",
            AudioRecorderManager.requiresForegroundService(configOf(false, true), false)
        )
        assertFalse(
            "background audio off means no service, even with both",
            AudioRecorderManager.requiresForegroundService(configOf(true, true), false)
        )
    }

    @Test
    fun defaultConfigRequiresTheService() {
        // The whole bug in one assertion: the default config starts a service, so the
        // stop paths have to agree that it did.
        val result = RecordingConfig.fromMap(
            mapOf("sampleRate" to 44100, "channels" to 1, "encoding" to "pcm_16bit")
        )
        val (config, _) = result.getOrThrow()

        assertTrue(
            "The default config starts the foreground service. Any stop path that does " +
                "not reach the same conclusion leaks it, which is #474.",
            AudioRecorderManager.requiresForegroundService(config, true)
        )
    }

    /**
     * Is a `showNotification` block still open where this line sits?
     *
     * Presence of the word is not the test: a closed `if (showNotification) { ... }` next to
     * a correctly guarded call is fine. What breaks is the call being *inside* that block,
     * which is how the defect can come back even while the shared predicate is called —
     * nesting the predicate under a showNotification guard restores the leak.
     */
    private fun insideOpenNotificationGuard(enclosing: String): Boolean {
        var depth: Int? = null
        enclosing.lines().forEach { raw ->
            val line = raw.substringBefore("//")
            if (depth == null) {
                if (Regex("""if \([^)]*showNotification[^)]*\)\s*\{""").containsMatchIn(line)) {
                    depth = 1
                    return@forEach
                }
            } else {
                depth = depth!! + line.count { it == '{' } - line.count { it == '}' }
                if (depth!! <= 0) depth = null
            }
        }
        return (depth ?: 0) > 0
    }

    @Test
    fun everyServiceCallSiteRoutesThroughTheSharedPredicate() {
        val lines = managerSource.lines()
        val sites = lines.withIndex().filter { (_, line) ->
            line.contains("AudioRecordingService.startService") ||
                line.contains("AudioRecordingService.stopService")
        }
        assertTrue("Expected at least three service call sites, found ${sites.size}", sites.size >= 3)

        sites.forEach { (index, line) ->
            val enclosing = lines.subList(maxOf(0, index - 8), index).joinToString("\n")

            val orphanCleanup = enclosing.contains("orphaned") || enclosing.contains("isServiceRunning")
            val routed = enclosing.contains("serviceWasStartedFor") ||
                enclosing.contains("needsService")

            assertFalse(
                "Service call at line ${index + 1} sits inside an open showNotification " +
                    "block. With the default config (keepAwake=true, showNotification=false) " +
                    "that skips it, which is #474 — and it stays broken even if the shared " +
                    "predicate is called inside: ${line.trim()}",
                insideOpenNotificationGuard(enclosing) && !orphanCleanup
            )
            assertTrue(
                "Service call at line ${index + 1} does not route through the shared " +
                    "predicate or the orphan check: ${line.trim()}",
                routed || orphanCleanup
            )
        }
    }

    @Test
    fun theSharedPredicateDelegatesToTheTestedRule() {
        // If serviceWasStartedFor grew its own copy of the condition, the truth table above
        // would stop describing what the call sites actually do.
        val delegation = Regex(
            """private fun serviceWasStartedFor\([^)]*\)\s*:\s*Boolean\s*=\s*([^\n]+)"""
        ).find(managerSource)
        assertNotNull("serviceWasStartedFor should still exist", delegation)
        assertTrue(
            "serviceWasStartedFor must delegate to requiresForegroundService, not restate " +
                "the condition: ${delegation!!.groupValues[1]}",
            delegation.groupValues[1].contains("requiresForegroundService")
        )
    }
}
