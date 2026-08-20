package net.siteed.sherpaonnx.handlers

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Guards that TtsHandler actually calls the prefill policy.
 *
 * PrefillPolicyTest proves the policy is correct; it cannot prove the handler uses it.
 * That gap is not theoretical: a scripted edit once silently reverted the gate to the
 * plain prefill target, and twelve policy tests plus six instrumented AudioTrack tests all
 * stayed green while pre-S playback was broken.
 *
 * Asserting on source text is blunt, but it is the cheapest thing that fails when the
 * wiring is removed. The alternative — driving a real generation loop — needs a loaded
 * model on a device and would not run in CI.
 */
class TtsHandlerWiringTest {

    private val source: String by lazy {
        val candidates = listOf(
            "src/main/kotlin/net/siteed/sherpaonnx/handlers/TtsHandler.kt",
            "android/src/main/kotlin/net/siteed/sherpaonnx/handlers/TtsHandler.kt",
            "packages/sherpa-onnx.rn/android/src/main/kotlin/net/siteed/sherpaonnx/handlers/TtsHandler.kt",
        )
        val found = candidates.map(::File).firstOrNull { it.exists() }
            ?: error(
                "TtsHandler.kt not found relative to ${File(".").absolutePath}; " +
                    "update the candidate paths in TtsHandlerWiringTest."
            )
        found.readText()
    }

    @Test
    fun `the playback gate goes through PrefillPolicy`() {
        assertTrue(
            "TtsHandler must decide when to start playback via PrefillPolicy.shouldStart. " +
                "Without it the gate can silently regress to the plain 200ms target, which " +
                "leaves pre-API-31 devices silent for utterances shorter than the buffer.",
            source.contains("PrefillPolicy.shouldStart(")
        )
    }

    @Test
    fun `tail padding goes through PrefillPolicy`() {
        assertTrue(
            "The short-utterance path must size its silence padding via " +
                "PrefillPolicy.tailPaddingFrames.",
            source.contains("PrefillPolicy.tailPaddingFrames(")
        )
    }

    @Test
    fun `every track replacement resets state through PrefillPolicy`() {
        // Count invocations only. `private fun initAudioTrack(` is the declaration and must
        // not be mistaken for a call site — an earlier version of this test did exactly
        // that and failed against correct code.
        val calls = Regex("""(?<!fun )initAudioTrack\(currentSampleRate""")
            .findAll(source)
            .count()
        val resets = Regex("""PrefillPolicy\.onTrackReplaced\(\)""").findAll(source).count()

        // One call sets up the first track for the utterance and legitimately has no reset;
        // every other call replaces a live track and must clear per-track state.
        assertTrue(
            "Found $calls initAudioTrack call sites but only $resets " +
                "PrefillPolicy.onTrackReplaced() resets. Every replacement must clear " +
                "playbackStarted and the per-track frame count, or the new empty track " +
                "starts immediately and drops a remainder below its threshold.",
            resets >= calls - 1
        )
    }

    @Test
    fun `the gate does not use the raw prefill target`() {
        val gateUsesRawTarget = Regex(
            """!playbackStarted\s*&&\s*framesInCurrentTrack\s*>=\s*prefillFrames\("""
        ).containsMatchIn(source)
        assertTrue(
            "The playback gate must not compare against prefillFrames() directly — that is " +
                "the regression that left pre-API-31 devices silent. Use " +
                "PrefillPolicy.shouldStart, which accounts for a fixed start threshold.",
            !gateUsesRawTarget
        )
    }
}
