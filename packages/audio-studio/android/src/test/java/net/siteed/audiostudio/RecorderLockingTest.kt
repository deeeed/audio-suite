package net.siteed.audiostudio

import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

/**
 * Guards the locking invariant in `AudioRecorderManager` (#446).
 *
 * Ten review rounds went into teardown races before the actual defect became clear: four
 * of eight entry points did not take `audioRecordLock`, so a teardown could always be
 * interleaved with a path that created or replaced recorder state. Each fix hardened one
 * interleaving and the next round found another.
 *
 * The invariant that removes the whole class:
 *
 *  1. Every entry point that reads or mutates recorder state holds `audioRecordLock`.
 *  2. The recording thread is joined only *outside* that lock, because the recording loop
 *     takes the same lock on every read and cannot reach its exit while it is held.
 *
 * These source assertions keep the static lock and ownership rules visible in the fast unit
 * suite. `RecorderConcurrencyInstrumentedTest` exercises the #472 stop interleaving with a
 * real `AudioRecord` on device.
 *
 * Source assertions are deliberate here: the manager still has no injectable AudioRecord
 * seam. They guard structural lock/session invariants; device tests cover behavior.
 */
class RecorderLockingTest {

    private val source: String by lazy {
        val candidates = listOf(
            File("src/main/java/net/siteed/audiostudio/AudioRecorderManager.kt"),
            File("packages/audio-studio/android/src/main/java/net/siteed/audiostudio/AudioRecorderManager.kt"),
            File("../../packages/audio-studio/android/src/main/java/net/siteed/audiostudio/AudioRecorderManager.kt")
        )
        (candidates.firstOrNull { it.exists() }
            ?: error(
                "AudioRecorderManager.kt not found relative to ${File(".").absolutePath}; " +
                    "update the candidate paths in RecorderLockingTest."
            )).readText()
    }

    /** The body of one function, by brace matching from its signature. */
    private fun bodyOf(signature: String): String {
        val start = source.indexOf(signature)
        require(start >= 0) {
            "$signature not found in AudioRecorderManager.kt; update RecorderLockingTest."
        }
        var depth = 0
        var seenOpen = false
        for (i in start until source.length) {
            when (source[i]) {
                '{' -> { depth++; seenOpen = true }
                '}' -> {
                    depth--
                    if (seenOpen && depth == 0) return source.substring(start, i + 1)
                }
            }
        }
        error("Unbalanced braces after $signature")
    }

    @Test
    fun `every recorder entry point holds audioRecordLock`() {
        // startRecording, prepareRecording and pauseRecording were the unsynchronized ones.
        // A teardown running concurrently with any of them could release recorders that
        // call had just installed, or observe a half-built state.
        val entryPoints = listOf(
            "fun startRecording(options: Map<String, Any?>, promise: Promise)",
            "fun prepareRecording(options: Map<String, Any?>): Boolean",
            "private fun pauseRecording(promise: Promise, isSystemInterruption: Boolean)",
            "fun resumeRecording(promise: Promise)",
            "fun stopRecording(promise: Promise)",
            "fun getStatus(): Bundle"
        )

        for (signature in entryPoints) {
            assertTrue(
                bodyOf(signature).contains("synchronized(audioRecordLock)"),
                "$signature must hold audioRecordLock. Every path that reads or mutates " +
                    "recorder state is serialized on it; an unsynchronized one can be " +
                    "interleaved with teardown and release recorders another call owns."
            )
        }
    }

    @Test
    fun `device change rechecks session after its unlocked transition`() {
        val body = bodyOf("private fun handleDeviceChangeTransition(")
        val claimAt = body.indexOf("val deviceChangeSession = synchronized(audioRecordLock)")
        val expectedAt = body.indexOf("sessionId != expectedSession", claimAt)
        val firstMutationAt = body.indexOf("audioRecord?.stop()", claimAt)
        val delayAt = body.indexOf("Thread.sleep(200)")
        val restartAt = body.indexOf("return synchronized(audioRecordLock)", delayAt)

        assertTrue(claimAt >= 0, "Device change must claim its session under audioRecordLock")
        assertTrue(
            expectedAt > claimAt && firstMutationAt > expectedAt,
            "Device change must reject a replaced session before its first recorder mutation"
        )
        assertTrue(
            claimAt < delayAt && delayAt < restartAt,
            "Device change must release audioRecordLock for the transition delay, then retake it"
        )
        val restart = body.substring(restartAt)
        assertTrue(
            restart.contains(
                "!_isRecording.get() || isPaused.get() || sessionId != deviceChangeSession"
            ),
            "Device change must not restart after stop, pause, or a new session wins during the delay"
        )
        assertTrue(
            body.contains("changingDeviceSession.compareAndSet(") &&
                body.contains("DeviceTransitionResult.Cancelled"),
            "Device-change ownership must be claimed and cleared for the same session"
        )
        val pausedAt = body.indexOf("if (isPaused.get())")
        val pausedClaimAt = body.indexOf("var claimedSession = expectedSession")
        val pausedReleaseAt = body.indexOf("audioRecord?.release()", pausedAt)
        assertTrue(
            pausedClaimAt >= 0 && pausedAt > pausedClaimAt && pausedReleaseAt > pausedAt,
            "Paused device changes must capture their session before a throwing release"
        )
        assertTrue(
            bodyOf("private fun pauseRecording(promise: Promise, isSystemInterruption: Boolean)")
                .contains("compressedPausedForDeviceChangeSession.get() != sessionId"),
            "Only the session whose compressed recorder phase 1 paused may skip a second pause"
        )
        assertTrue(
            bodyOf("private fun recordingProcess()")
                .contains("changingDeviceSession.get() == sessionId"),
            "A device change must gate only the worker for its own session"
        )
    }

    @Test
    fun `device switch failure events settle once`() {
        for (signature in listOf(
            "fun handleDeviceChange()",
            "private fun handleDeviceChangeTransition("
        )) {
            val body = bodyOf(signature)
            val guardPattern = Regex(
                """eventSent\s*\.\s*compareAndSet\s*\(\s*false\s*,\s*true\s*\)"""
            )
            val guardAt = guardPattern.find(body)?.range?.first ?: -1
            val eventAt = body.indexOf("eventSender.sendExpoEvent", guardAt)
            assertEquals(
                1,
                guardPattern.findAll(body).count(),
                "$signature must have one settle-once guard"
            )
            assertTrue(
                guardAt >= 0 && eventAt > guardAt,
                "$signature must guard its deviceSwitchFailed event"
            )
        }
    }

    @Test
    fun `device switch recovery cannot mutate a successor session`() {
        val transition = bodyOf("private fun handleDeviceChangeTransition(")
        assertTrue(
            transition.contains("DeviceTransitionResult.Failed(deviceChangeSession)"),
            "A failed transition must return the session it claimed"
        )

        for ((signature, expectedMutation) in listOf(
            "private fun stopRecordingAfterDeviceChangeFailure(" to "stopRecording(promise)",
            "private fun pauseRecordingAfterDeviceChangeFailure(" to
                "pauseRecording(promise, isSystemInterruption = false)"
        )) {
            val recovery = bodyOf(signature)
            val lockAt = recovery.indexOf("synchronized(audioRecordLock)")
            val sessionAt = recovery.indexOf("sessionId != claimedSession", lockAt)
            val recordingAt = recovery.indexOf("!_isRecording.get()", sessionAt)
            val mutationAt = recovery.indexOf(expectedMutation, lockAt)

            assertTrue(lockAt >= 0, "$signature must take audioRecordLock")
            assertTrue(
                sessionAt > lockAt && recordingAt > sessionAt && mutationAt > recordingAt,
                "$signature must recheck session ownership under the lock before recovery"
            )
            assertTrue(
                recovery.contains("catch (recoveryError: Exception)") &&
                    recovery.contains("failDeviceChangeRecovery(claimedSession, it, promise)"),
                "$signature must settle failures from repeated recorder operations"
            )
        }

        val failedRecovery = bodyOf("private fun failDeviceChangeRecovery(")
        val cleanupAt = failedRecovery.indexOf("cleanupInternal(")
        val rejectAt = failedRecovery.indexOf("promise.reject(")
        assertTrue(
            cleanupAt >= 0 && rejectAt > cleanupAt &&
                failedRecovery.contains("expectedSession = claimedSession") &&
                failedRecovery.contains("emitStoppedEvent = false"),
            "Failed recovery must join and tear down only its session before settling"
        )
        val cleanup = bodyOf("private fun cleanupInternal(")
        val expectedAt = cleanup.indexOf("sessionId != expectedSession")
        val workerAt = cleanup.indexOf("recordingThreadRef.getAndSet(null)")
        assertTrue(
            expectedAt >= 0 && workerAt > expectedAt,
            "Expected-session cleanup must reject a successor before claiming its worker"
        )
    }

    @Test
    fun `cleanup joins the worker with the lock released`() {
        // Three phases, in order: claim the session under the lock, join with it released,
        // then tear down under it again. The join must sit between the two locked blocks —
        // the recording loop takes the same lock on every read, so a join while holding it
        // cannot finish until the timeout expires.
        val body = bodyOf("private fun cleanupInternal(")
        val claimAt = body.indexOf("synchronized(audioRecordLock)")
        val joinAt = body.indexOf(".join(")
        val teardownAt = body.lastIndexOf("synchronized(audioRecordLock)")

        assertTrue(joinAt >= 0, "cleanup must join the recording thread")
        assertTrue(claimAt >= 0, "cleanup must claim its session under audioRecordLock")
        assertTrue(
            teardownAt > joinAt,
            "recorder teardown must happen under audioRecordLock, after the join."
        )
        assertTrue(
            claimAt < joinAt,
            "cleanup must claim the session it owns under audioRecordLock BEFORE the " +
                "join. Reading state outside the lock lets a start publish a new session " +
                "during the join, which teardown would then destroy."
        )
        assertTrue(
            claimAt != teardownAt,
            "the session claim and the recorder teardown must be separate locked blocks, " +
                "with the join between them."
        )
    }

    @Test
    fun `cleanup refuses to tear down a session it does not own`() {
        val body = bodyOf("private fun cleanupInternal(")
        assertTrue(
            body.contains("sessionId != ownedSession"),
            "cleanup must compare sessionId against the value it claimed and bail out if " +
                "a start or prepare published a new session during the unlocked join."
        )
    }

    @Test
    fun `every session publication bumps sessionId`() {
        // If a publication point forgets this, cleanup cannot tell that a new session
        // appeared and will release its recorders.
        for (signature in listOf(
            "private fun startRecordingProcess(promise: Promise): Boolean",
            "fun prepareRecording(options: Map<String, Any?>): Boolean",
            // Resume restarts both recorders, so it republishes the session too.
            "fun resumeRecording(promise: Promise)"
        )) {
            assertTrue(
                bodyOf(signature).contains("sessionId++"),
                "$signature publishes recorders, so it must bump sessionId. Without it a " +
                    "concurrent teardown cannot tell this session from the one it claimed."
            )
        }
    }

    @Test
    fun `callers already holding the lock do not join`() {
        // The join is the one thing that must not happen under the lock, so a caller that
        // already owns it says so and skips the join. Those callers either terminated the
        // thread themselves or know there is none.
        val body = bodyOf("private fun cleanupInternal(")
        assertTrue(
            body.contains("ownedWorker = null"),
            "a caller already holding audioRecordLock must claim no worker, so the join " +
                "below is skipped. Joining under that lock deadlocks against the " +
                "recording loop, which needs it to reach its exit."
        )
        assertTrue(
            body.contains("if (ownedWorker != null && ownedWorker.isAlive)"),
            "the join must act only on the worker claimed in phase 0, never on whatever " +
                "recordingThreadRef holds by then — that may belong to a newer session."
        )
    }

    @Test
    fun `cleanup claims the worker with the session`() {
        // Claiming the session but taking the worker later, outside the lock, let a start
        // that published its thread in the gap have it stolen and interrupted.
        val body = bodyOf("private fun cleanupInternal(")
        val claimAt = body.indexOf("ownedWorker = recordingThreadRef.getAndSet(null)")
        val joinAt = body.indexOf(".join(")
        assertTrue(claimAt >= 0, "cleanup must claim the worker under audioRecordLock")
        assertTrue(
            claimAt < joinAt,
            "the worker must be claimed in the locked phase 0, before the join."
        )
    }

    @Test
    fun `cleanup callers inside the lock declare it`() {
        // Each of these runs inside a synchronized(audioRecordLock) block, so passing the
        // default would make cleanup try to join while the lock is held.
        for (signature in listOf(
            "fun stopRecording(promise: Promise)",
            "fun getStatus(): Bundle",
            "fun prepareRecording(options: Map<String, Any?>): Boolean"
        )) {
            // Comment lines are stripped first: prose that mentions cleanup() is not a
            // call, and matching it made this test fail on documentation.
            val body = bodyOf(signature)
                .lineSequence()
                .filterNot { it.trimStart().startsWith("//") || it.trimStart().startsWith("*") }
                .joinToString("\n")
            if (!body.contains("cleanup(")) continue
            assertFalse(
                Regex("""cleanup\(\s*\)""").containsMatchIn(body),
                "$signature holds audioRecordLock, so its cleanup call must pass " +
                    "callerHoldsRecordLock = true. The no-argument form joins the " +
                    "recording thread, which deadlocks against the lock it holds."
            )
        }
    }

    @Test
    fun `failure paths leave the ownership flag for cleanup to read`() {
        // cleanup reads _isRecording to decide whether it owns the recorders. A failure
        // path that clears the flag first makes cleanup skip the release and leak the
        // recorder it was called to reclaim — the #446 bug, which came back twice this
        // way. Interrupting the worker is enough; cleanup clears the flag in phase 0.
        for (signature in listOf(
            "fun startRecording(options: Map<String, Any?>, promise: Promise)",
            "private fun startRecordingProcess(promise: Promise): Boolean"
        )) {
            val body = bodyOf(signature)
                .lineSequence()
                .filterNot { it.trimStart().startsWith("//") || it.trimStart().startsWith("*") }
                .joinToString("\n")
            // Walk lines in order rather than searching the whole body: the same text can
            // appear more than once, and substring searching matched the wrong occurrence.
            var clearedSinceStart = false
            for (line in body.lineSequence()) {
                if (line.contains("_isRecording.set(true)")) clearedSinceStart = false
                if (line.contains("_isRecording.set(false)")) clearedSinceStart = true
                if (!line.contains("cleanup(callerHoldsRecordLock = true)")) continue
                assertFalse(
                    clearedSinceStart,
                    "$signature clears _isRecording before calling cleanup. cleanup reads " +
                        "that flag to decide whether it owns the recorders, so clearing " +
                        "it first makes the release a no-op and leaks them."
                )
            }
        }
    }

    @Test
    fun `resume refuses a session teardown already claimed`() {
        // isPaused alone is not enough. cleanup's phase 0 clears _isRecording and takes
        // the worker, so a resume checking only isPaused would restart both recorders and
        // resolve success on a recording nothing is reading from.
        val body = bodyOf("fun resumeRecording(promise: Promise)")
        assertTrue(
            body.contains("val resumeSession = synchronized(audioRecordLock)") &&
                body.contains("if (!_isRecording.get())"),
            "resumeRecording must capture its session and reject after teardown claims it."
        )

        // Presence alone is not enough. A guard outside the lock is a TOCTOU check:
        // cleanup can claim the session between it and the restart. The check that counts
        // is the one inside the lock that does the restarting, before any mutation.
        val restartAt = body.indexOf("audioRecord?.startRecording()")
        val lockAt = body.lastIndexOf("synchronized(audioRecordLock)", restartAt)
        val guardInLock = body.indexOf("sessionId != resumeSession", lockAt)
        val initializeAt = body.indexOf("initializeAudioRecord", lockAt)
        assertTrue(restartAt > lockAt, "resume must restart AudioRecord under the lock")
        assertTrue(
            guardInLock in (lockAt + 1) until restartAt && initializeAt in guardInLock until restartAt,
            "resumeRecording must revalidate and rebuild its original session inside the " +
                "same lock that restarts the recorders."
        )

        // isPaused must not clear before that recheck, or a resume that loses the race
        // leaves the recording neither paused nor running.
        val clearAt = body.indexOf("isPaused.set(false)")
        assertTrue(
            clearAt > guardInLock,
            "isPaused must be cleared after the in-lock ownership recheck, so a rejected " +
                "resume leaves the recording paused rather than half-resumed."
        )
    }

    @Test
    fun `an interrupted join still finishes teardown`() {
        // join throws InterruptedException. Letting it propagate skipped all of phase 2:
        // recorders, the foreground service, the wake lock, audio focus, listeners, and
        // destroy()'s singleton clear.
        val body = bodyOf("private fun cleanupInternal(")
        val joinAt = body.indexOf(".join(")
        val guarded = body.lastIndexOf("try {", joinAt)
        assertTrue(
            guarded in 0 until joinAt && body.contains("catch (e: InterruptedException)"),
            "cleanup must catch InterruptedException around the join and carry on. " +
                "Teardown has to release the recorders even when the joining thread is " +
                "itself interrupted."
        )
    }

    @Test
    fun `starting a recording consumes the preparation`() {
        // isPrepared outliving the start let a losing teardown treat an active recording
        // as a never-started preparation and release its recorders. The two states have to
        // be disjoint for the release gate to mean anything.
        val body = bodyOf("private fun startRecordingProcess(promise: Promise): Boolean")
        assertTrue(
            body.contains("_isRecording.set(true)") && body.contains("isPrepared = false"),
            "startRecordingProcess must clear isPrepared where it sets _isRecording. " +
                "An active recording that still looks prepared can have its recorders " +
                "released by a concurrent teardown."
        )
    }

    @Test
    fun `the public cleanup keeps its no-argument signature`() {
        // A Kotlin default parameter compiles to cleanup(boolean) plus a synthetic
        // cleanup$default, with no no-arg entry point — an ABI break for any precompiled
        // caller of this published library.
        assertTrue(
            source.contains("fun cleanup() = cleanup(callerHoldsRecordLock = false)"),
            "cleanup() must stay a real no-argument method. Expressing it as a default " +
                "parameter removes the no-arg method from the bytecode and breaks " +
                "precompiled callers with NoSuchMethodError."
        )
        assertFalse(
            source.contains("fun cleanup(callerHoldsRecordLock: Boolean = false)"),
            "cleanup must not use a default parameter; see above."
        )
    }
}
