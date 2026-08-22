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
     * The body of a named function in the manager, by brace matching from its declaration.
     *
     * Checking each required function individually is what makes a deleted call site
     * detectable. Counting calls across the file cannot: the manager has four, so removing
     * a required stop still leaves three and any "at least three" assertion passes.
     */
    private fun bodyOf(functionName: String): String {
        // Skip expression-bodied declarations: `fun cleanup() = cleanup(...)` has no block,
        // so brace-matching from it runs into the NEXT function and inspects the wrong
        // region entirely. Take the first declaration whose signature is followed by `{`.
        val decl = Regex("""fun $functionName\s*\(""").findAll(managerSource).firstOrNull { m ->
            val after = managerSource.substring(m.range.last + 1)
            val closeParen = after.indexOf(')')
            closeParen >= 0 && Regex("""^[^\n=]*\{""").containsMatchIn(after.substring(closeParen + 1))
        }
        assertNotNull(
            "$functionName should exist in AudioRecorderManager with a block body", decl
        )

        var depth = 0
        var started = false
        val body = StringBuilder()
        for (i in decl!!.range.first until managerSource.length) {
            val c = managerSource[i]
            if (c == '{') { depth++; started = true }
            if (started) body.append(c)
            if (c == '}') {
                depth--
                if (depth == 0 && started) break
            }
        }
        return body.toString()
    }

    /**
     * The condition of the `if (...)` that this text ends with, or "" when it ends with
     * anything else (a function signature, `else`, a lambda). Matches parentheses from the
     * closing one backwards so a multiline condition is captured whole and an earlier,
     * already-closed block is not swallowed with it.
     */
    private fun conditionOfIfEndingAt(text: String): String {
        if (!text.endsWith(")")) return ""
        var depth = 0
        var i = text.length - 1
        while (i >= 0) {
            when (text[i]) {
                ')' -> depth++
                '(' -> {
                    depth--
                    if (depth == 0) {
                        val head = text.substring(0, i).trimEnd()
                        if (!head.endsWith("if")) return ""
                        return text.substring(i + 1, text.length - 1)
                            .replace(Regex("""\s+"""), " ")
                            .trim()
                    }
                }
            }
            i--
        }
        return ""
    }

    /**
     * The guard immediately controlling a service call, i.e. the innermost `if (...)` whose
     * block is still open at that call.
     *
     * A call can be reached through several nested guards. What matters is that no
     * showNotification guard is open anywhere on that path: nesting the shared predicate
     * inside one still skips the stop for the default config.
     */
    private fun openGuardsAt(body: String, callIndex: Int): List<String> {
        val open = ArrayDeque<String>()
        var i = 0
        while (i < callIndex) {
            val c = body[i]
            if (c == '{') {
                // Attribute this block to the nearest `if (...)` that precedes it, if any.
                // Only the condition of the `if` that opens THIS block. Scanning back
                // greedily swallowed an already-closed notification block plus the next
                // `if`, and reported the two as one guard.
                val preceding = body.substring(maxOf(0, i - 400), i).trimEnd()
                open.addLast(conditionOfIfEndingAt(preceding))
            } else if (c == '}') {
                if (open.isNotEmpty()) open.removeLast()
            }
            i++
        }
        return open.filter { it.isNotEmpty() }
    }

    /**
     * Every `return` in this text that is reached under a showNotification condition.
     *
     * Guards still open at the call are only half the story: an earlier terminating
     * branch skips it with nothing enclosing it. `if (!showNotification) return` before a
     * correctly guarded stop passes every open-guard check while restoring the leak.
     */
    private fun notificationGatedReturnsBefore(body: String, callIndex: Int): List<String> {
        val prefix = body.substring(0, callIndex)
        return Regex("""if\s*\(([^)]*showNotification[^)]*)\)\s*\{?[^{}]*?\breturn\b""")
            .findAll(prefix)
            .map { it.groupValues[1].replace(Regex("""\s+"""), " ").trim() }
            .toList()
    }

    private fun assertServiceCallIsCorrectlyGuarded(functionName: String, call: String) {
        val body = bodyOf(functionName)

        // Every occurrence, not just the first. cleanup has two stops — one on the
        // session-mismatch return, one in the main teardown — and checking only the first
        // left the second unexamined, which is where a bypass would go.
        val indices = generateSequence(body.indexOf(call)) { prev ->
            body.indexOf(call, prev + 1).takeIf { it >= 0 }
        }.takeWhile { it >= 0 }.toList()

        assertTrue(
            "$functionName must contain $call. Removing it drops teardown for that " +
                "lifecycle path, and counting calls file-wide would not notice (#474).",
            indices.isNotEmpty()
        )

        indices.forEach { callIndex -> assertOneCallGuarded(functionName, call, body, callIndex) }
    }

    private fun assertOneCallGuarded(
        functionName: String,
        call: String,
        body: String,
        callIndex: Int
    ) {
        val guards = openGuardsAt(body, callIndex)

        // The whole defect in one assertion, in whatever shape it returns: single-line,
        // multiline, or the predicate nested inside a notification guard.
        val notificationGuard = guards.firstOrNull { it.contains("showNotification") }
        assertNull(
            "In $functionName, $call is reached through a showNotification guard " +
                "(`$notificationGuard`). The default config is keepAwake=true with " +
                "showNotification=false, so that path skips it, which is #474 — and it " +
                "stays broken even when the shared predicate is nested inside.",
            notificationGuard
        )

        // A guard may name a local computed from the predicate rather than calling it
        // inline. Follow one level of `val <name> = ...` so that stays honest without
        // accepting a guard that never consults the predicate at all.
        val guardsResolved = guards.map { guard ->
            val name = Regex("""[!\s]*([A-Za-z_][A-Za-z0-9_]*)$""")
                .find(guard.trim())?.groupValues?.get(1)
            val binding = name?.let { n ->
                // Line-based: a regex spanning the continuation lines backtracked into a
                // StackOverflowError on this body.
                val lines = body.lines()
                val start = lines.indexOfFirst { Regex("""\bval $n\s*=""").containsMatchIn(it) }
                if (start < 0) null
                else lines.drop(start).take(4).joinToString(" ")
            }
            if (binding != null) "$guard => $binding" else guard
        }

        assertTrue(
            "In $functionName, $call is not guarded by the shared predicate. Its guards " +
                "are: $guardsResolved",
            guardsResolved.any {
                it.contains("serviceWasStartedFor") ||
                    it.contains("needsService") ||
                    // The session-mismatch stop routes through its own rule, which is
                    // itself covered by a truth table above.
                    it.contains("shouldStopServiceOnSessionMismatch")
            }
        )

        val gatedReturns = notificationGatedReturnsBefore(body, callIndex)
        assertTrue(
            "In $functionName, a showNotification-conditioned return precedes $call " +
                "($gatedReturns). That skips it for the default config just as surely as " +
                "wrapping it would, which is #474.",
            gatedReturns.isEmpty()
        )
    }

    @Test
    fun startRecordingProcessStartsTheServiceThroughThePredicate() {
        assertServiceCallIsCorrectlyGuarded(
            "startRecordingProcess", "AudioRecordingService.startService(context)"
        )
    }

    @Test
    fun stopRecordingStopsTheServiceThroughThePredicate() {
        assertServiceCallIsCorrectlyGuarded(
            "stopRecording", "AudioRecordingService.stopService(context)"
        )
    }

    @Test
    fun cleanupStopsTheServiceThroughThePredicate() {
        assertServiceCallIsCorrectlyGuarded(
            "cleanup", "AudioRecordingService.stopService(context)"
        )

        // cleanup owns two stops and needs both. The session-mismatch return releases a
        // service the successor does not own; the main teardown releases this session's.
        // Requiring only one lets either be deleted while the other keeps the test green.
        val occurrences = Regex("""AudioRecordingService\.stopService""")
            .findAll(bodyOf("cleanup")).count()
        assertEquals(
            "cleanup must stop the service on both paths: the session-mismatch return " +
                "and the main teardown. Dropping either strands a service (#474).",
            2, occurrences
        )
    }

    @Test
    fun sessionMismatchRuleTruthTable() {
        // The relationship, not its spelling. A one-token inversion of the production
        // condition kept every token an earlier source-matching assertion looked for and
        // still passed, while leaking for a prepared successor and killing an active one.
        val stop = AudioRecorderManager::shouldStopServiceOnSessionMismatch

        assertTrue(
            "Old session owned a service and the successor is only prepared: the service " +
                "is nobody's, so it must be stopped. This is the #474 leak.",
            stop.invoke(true, false)
        )
        assertFalse(
            "Old session owned a service and the successor is actively recording: the " +
                "successor owns it now, so stopping would kill a live recording's service.",
            stop.invoke(true, true)
        )
        assertFalse(
            "Old session owned no service, successor only prepared: nothing to stop.",
            stop.invoke(false, false)
        )
        assertFalse(
            "Old session owned no service, successor recording: not this teardown's to stop.",
            stop.invoke(false, true)
        )
    }

    @Test
    fun sessionMismatchStopUsesTheCapturedDecisionAndTheRule() {
        // Two things the truth table cannot see: that the decision is captured when the
        // session is claimed rather than reconstructed later from mutable state, and that
        // the call site actually consults the rule.
        val body = bodyOf("cleanup").lines().joinToString("\n") { it.substringBefore("//") }

        // Position is the point: the capture has to happen where the session is claimed,
        // before the unlocked join. Asserting only that an assignment exists somewhere
        // passed when it was moved into phase 2, which is the bug being guarded against.
        val captureIndex = Regex("""ownedService\s*=\s*[^\n]*serviceWasStartedFor""")
            .find(body)?.range?.first ?: -1
        val joinIndex = body.indexOf(".join(")
        val mismatchIndex = body.indexOf("sessionId != ownedSession")

        assertTrue(
            "cleanup must derive ownedService from serviceWasStartedFor when it claims " +
                "the session. Reading recordingConfig later can see a successor's config, " +
                "or a failed attempt's, and skip the stop (#474).",
            captureIndex >= 0
        )
        assertTrue(
            "The ownedService capture must precede the worker join. After it, a concurrent " +
                "start or prepare has already replaced recordingConfig.",
            joinIndex < 0 || captureIndex < joinIndex
        )
        assertTrue(
            "The ownedService capture must precede the session-mismatch check it feeds.",
            mismatchIndex < 0 || captureIndex < mismatchIndex
        )
        assertFalse(
            "The capture must read the config, not assign a constant. `ownedService = true` " +
                "would stop services this teardown never started.",
            Regex("""ownedService\s*=\s*(true|false)\b""").containsMatchIn(body)
        )

        val mismatchReturn = body.indexOf("sessionId != ownedSession")
        assertTrue("cleanup should still guard on the session mismatch", mismatchReturn >= 0)
        val stopIndex = body.indexOf("AudioRecordingService.stopService", mismatchReturn)
        assertTrue("The session-mismatch path must still release an unowned service", stopIndex >= 0)

        val between = body.substring(mismatchReturn, stopIndex)
        assertTrue(
            "The session-mismatch stop must go through shouldStopServiceOnSessionMismatch, " +
                "so the truth table above describes what actually runs: ${between.takeLast(300)}",
            between.contains("shouldStopServiceOnSessionMismatch")
        )
        // Passing a fresh serviceWasStartedFor(recordingConfig) here defeats the whole
        // capture: phase 2 runs after the join, where the config may already belong to a
        // successor or to an attempt that failed before publishing its session.
        val callSite = body.substring(stopIndex - 400, stopIndex)
        assertFalse(
            "The session-mismatch stop must not recompute ownership from recordingConfig. " +
                "It has to use the value captured when the session was claimed: " +
                callSite.takeLast(300),
            Regex("""ownedService\s*=\s*[^\n]*serviceWasStartedFor""").containsMatchIn(callSite)
        )
        assertTrue(
            "It must pass the captured ownedService: ${between.takeLast(300)}",
            Regex("""ownedService\s*=\s*ownedService""").containsMatchIn(between)
        )
    }

    @Test
    fun orphanRecoveryStopsTheServiceOnObservedState() {
        // getStatus is the deliberate exception: it stops a service it observes running
        // while nothing is recording. Its config can be stale or absent, so the predicate
        // is the wrong question there — the observed state is the right one.
        val body = bodyOf("getStatus")
        val callIndex = body.indexOf("AudioRecordingService.stopService(context)")
        assertTrue("getStatus should still recover an orphaned service", callIndex >= 0)

        val guards = openGuardsAt(body, callIndex)
        assertTrue(
            "The orphan stop must be guarded by observed service state, not by config: $guards",
            guards.any { it.contains("isServiceRunning") }
        )
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
