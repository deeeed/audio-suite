package net.siteed.audiostudio

import java.io.File
import org.junit.Assert.assertEquals
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
        val startBody = source
            .substringAfter("fun startRecording(")
            .substringBefore("\n    private fun isAudioFormatSupported(")

        assertTrue(
            "startRecording() must not clear the resolved source. Clearing belongs on the " +
                "teardown paths; doing it here discards what prepareRecording() resolved.",
            !startBody.contains("onTeardown()") && !startBody.contains("onBeginAttempt()")
        )
    }

    @Test
    fun `a fresh attempt is begun where a new recorder replaces the old one`() {
        // Guards the failed-preparation defect: initializers catch their own exceptions and
        // return false, so callers return early without reaching any catch or cleanup.
        assertTrue(
            "initializeAudioRecord() must begin a fresh attempt when it is not resuming or " +
                "reconstructing, so a failed attempt's source is not inherited by the next " +
                "attempt on a different source.",
            source.contains("audioSourceLifecycle.onBeginAttempt()")
        )
        assertTrue(
            "The fresh-attempt reset must be guarded on !_isRecording && !isPrepared, or it " +
                "would also fire on device change, resume, and prepared start.",
            source.contains("if (!_isRecording.get() && !isPrepared) {")
        )
    }

    @Test
    fun `teardown clears the source immediately after preparation state is reset`() {
        // isPrepared and the resolved source have the same lifetime: both describe recorders
        // that exist. The two teardown sites — stopRecording() and cleanup() — must reset
        // both. prepareRecording()'s catch also sets isPrepared = false, but it delegates to
        // cleanup() for the rest, so it is covered by cleanup()'s pairing rather than its own.
        val paired = Regex(
            "isPrepared = false[^\\n]*\\n\\s*audioSourceLifecycle\\.onTeardown\\(\\)"
        ).findAll(source).count()

        assertEquals(
            "Both teardown sites must clear the resolved source right where they reset " +
                "isPrepared. A teardown that leaves the source behind lets it outlive the " +
                "recorder it describes.",
            2,
            paired
        )
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
