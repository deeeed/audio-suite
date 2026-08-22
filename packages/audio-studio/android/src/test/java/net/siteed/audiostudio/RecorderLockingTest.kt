package net.siteed.audiostudio

import java.io.File
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
 * These are source assertions rather than behavioural tests. That is a deliberate limit,
 * not an oversight: `AudioRecorderManager` needs a real `AudioRecord`, so the interleavings
 * cannot be reproduced in a unit test until the injectable-recorder seam in #472 exists.
 * What these do catch is the regression that actually happened — someone adding or moving
 * a path and leaving it unsynchronized. They fail loudly with the reason rather than
 * letting the next race be discovered in review.
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
    fun `cleanup joins the worker with the lock released`() {
        // Three phases, in order: claim the session under the lock, join with it released,
        // then tear down under it again. The join must sit between the two locked blocks —
        // the recording loop takes the same lock on every read, so a join while holding it
        // cannot finish until the timeout expires.
        val body = bodyOf("internal fun cleanup(callerHoldsRecordLock: Boolean)")
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
        val body = bodyOf("internal fun cleanup(callerHoldsRecordLock: Boolean)")
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
            "fun prepareRecording(options: Map<String, Any?>): Boolean"
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
        val body = bodyOf("internal fun cleanup(callerHoldsRecordLock: Boolean)")
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
        val body = bodyOf("internal fun cleanup(callerHoldsRecordLock: Boolean)")
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
