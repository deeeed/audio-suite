package net.siteed.audiostudio

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Guards that AudioRecorderManager drives AudioSourceLifecycle where it should.
 *
 * AudioSourceLifecycleTest proves the transitions are correct; it cannot prove the manager
 * uses them. That gap is not theoretical here — every defect found in this feature so far
 * has been in the wiring rather than in the decision, and each time the existing tests
 * stayed green: the source was re-resolved on every reconstruction, then cleared on the
 * start path where a prepared start skips initialization, then left behind by preparation
 * failures that return before any cleanup runs.
 *
 * Asserting on source text is blunt, but it is the cheapest thing that fails when a call
 * is moved or dropped. The alternative — driving the real manager — needs AudioRecord and
 * MediaRecorder, so it cannot run off-device.
 */
class AudioSourceWiringTest {

    private val source: String by lazy {
        val candidates = listOf(
            "src/main/java/net/siteed/audiostudio/AudioRecorderManager.kt",
            "android/src/main/java/net/siteed/audiostudio/AudioRecorderManager.kt",
            "packages/audio-studio/android/src/main/java/net/siteed/audiostudio/AudioRecorderManager.kt",
        )
        val found = candidates.map(::File).firstOrNull { it.exists() }
            ?: error(
                "AudioRecorderManager.kt not found relative to ${File(".").absolutePath}; " +
                    "update the candidate paths in AudioSourceWiringTest."
            )
        found.readText()
    }

    /**
     * The body of one function, by brace matching from its signature. Assertions are scoped
     * to a function so that moving a call to the wrong place fails rather than passing on a
     * match found somewhere else in the file.
     */
    private fun bodyOf(signature: String): String {
        val start = source.indexOf(signature)
        require(start >= 0) {
            "$signature not found in AudioRecorderManager.kt; update AudioSourceWiringTest."
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
    fun `resolving goes through the lifecycle rather than a bare field write`() {
        assertTrue(
            "The source must be resolved inside onInitializeRecorders, which resolves only " +
                "when nothing holds a previous value. Resolving directly would re-resolve on " +
                "device change and resume, flipping the PCM recorder while the compressed one " +
                "keeps the original source.",
            source.contains("audioSourceLifecycle.onInitializeRecorders {")
        )
    }

    @Test
    fun `the source is never cleared on the start path`() {
        // The round-2 defect: startRecording() cleared it above the isPrepared check, and a
        // prepared start skips initialization, so a non-mic recording reported mic.
        val startBody = bodyOf("fun startRecording(")

        assertTrue(
            "startRecording() must not clear the resolved source. Clearing belongs on the " +
                "teardown paths; doing it here discards what prepareRecording() resolved.",
            !startBody.contains("onTeardown()") && !startBody.contains("onBeginAttempt()")
        )
    }

    @Test
    fun `a fresh attempt is begun inside the guard, in initializeAudioRecord`() {
        // Guards the failed-preparation defect: initializers catch their own exceptions and
        // return false, so callers return early without reaching any catch or cleanup.
        // Both the discard and the reset must sit inside the guard — outside it they would
        // also fire on device change, resume, and prepared start, tearing down recorders
        // that belong to a live recording.
        val guarded = Regex(
            "if \\(!_isRecording\\.get\\(\\) && !isPrepared\\) \\{\\s*" +
                "discardFailedAttempt\\(\\)\\s*" +
                "audioSourceLifecycle\\.onBeginAttempt\\(\\)\\s*\\}"
        )

        assertTrue(
            "initializeAudioRecord() must discard a previous failed attempt and begin a " +
                "fresh one, both inside the !_isRecording && !isPrepared guard, so neither " +
                "a stale source nor a stale recorder is inherited by the next attempt.",
            guarded.containsMatchIn(bodyOf("private fun initializeAudioRecord("))
        )
    }

    @Test
    fun `discarding a failed attempt releases the recorders it left behind`() {
        // cleanup() releases the compressed recorder only while _isRecording is true, which
        // a failed attempt never sets, and startRecording() calls compressedRecorder?.start()
        // unconditionally — so a survivor gets started by a later, unrelated attempt.
        val body = bodyOf("private fun discardFailedAttempt()")

        assertTrue(
            "discardFailedAttempt() must null both recorders and the compressed file, or a " +
                "later attempt can start a recorder it never configured and report " +
                "compression it never produced.",
            body.contains("audioRecord = null") &&
                body.contains("compressedRecorder = null") &&
                body.contains("compressedFile = null")
        )
        assertTrue(
            "The stale MediaRecorder must be reset() rather than stop()ed: it was prepared " +
                "but never started, and stop() throws in that state.",
            body.contains("recorder.reset()") && !body.contains("recorder.stop()")
        )
    }

    @Test
    fun `each teardown clears the source where it resets preparation state`() {
        // isPrepared and the resolved source have the same lifetime: both describe recorders
        // that exist. Checked per function so that moving a call from one teardown to the
        // other — which keeps the file-wide count at two — still fails.
        // prepareRecording()'s catch also sets isPrepared = false, but delegates the rest to
        // cleanup(), so it is covered by cleanup()'s own pairing.
        val paired = Regex("isPrepared = false[^\\n]*\\n\\s*audioSourceLifecycle\\.onTeardown\\(\\)")

        for (signature in listOf("fun stopRecording(", "fun cleanup()")) {
            assertTrue(
                "$signature must clear the resolved source right where it resets isPrepared. " +
                    "A teardown that leaves the source behind lets it outlive the recorder " +
                    "it describes.",
                paired.containsMatchIn(bodyOf(signature))
            )
        }
    }

    @Test
    fun `every read of the resolved source is checked`() {
        assertTrue(
            "Reads must go through requireAudioSource. Substituting MIC would report and " +
                "open a source the recorders are not using, hiding a lifecycle bug behind " +
                "plausible-looking output.",
            !source.contains("?: AudioSourceResolver.MIC")
        )
    }
}
