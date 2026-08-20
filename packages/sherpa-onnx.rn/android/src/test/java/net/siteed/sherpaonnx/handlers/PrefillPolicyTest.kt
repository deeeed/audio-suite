package net.siteed.sherpaonnx.handlers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for the prefill decision.
 *
 * These exist because two real defects — gating on the plain prefill target instead of the
 * device-effective one, and carrying playback state across a track replacement — survived
 * six passing instrumented AudioTrack tests. Those tests rebuilt the framework setup and
 * asserted framework behavior, so they could not catch a mistake in the wiring.
 *
 * Being framework-free, these also cover the pre-API-31 branches that a modern test device
 * can never exercise.
 */
class PrefillPolicyTest {

    private val sampleRate = 22050
    private val target = sampleRate / 5 // 4410 frames = 200ms
    private val buffer = 28480 // ~1292ms, matches a Pixel 6a at this sample rate

    // --- effectivePrefillFrames ---

    @Test
    fun `threshold is the prefill target when it can be lowered`() {
        assertEquals(target, PrefillPolicy.effectivePrefillFrames(sampleRate, true, buffer))
    }

    @Test
    fun `threshold is the buffer when it cannot be lowered`() {
        assertEquals(buffer, PrefillPolicy.effectivePrefillFrames(sampleRate, false, buffer))
    }

    @Test
    fun `threshold never drops below the prefill target on a tiny buffer`() {
        assertEquals(target, PrefillPolicy.effectivePrefillFrames(sampleRate, false, 100))
    }

    // --- shouldStart ---

    @Test
    fun `does not start before the target is reached`() {
        assertFalse(PrefillPolicy.shouldStart(false, target - 1, sampleRate, true, buffer))
    }

    @Test
    fun `starts once the target is reached when the threshold is lowerable`() {
        assertTrue(PrefillPolicy.shouldStart(false, target, sampleRate, true, buffer))
    }

    /**
     * The blocker: on pre-S a track holding between the target and the buffer would call
     * play() and set playbackStarted, then never produce output and skip the tail padding
     * that would have rescued it.
     */
    @Test
    fun `does not start between the target and the buffer when the threshold is fixed`() {
        val between = (target + buffer) / 2
        assertFalse(
            "A pre-S track holding $between frames cannot reach its fixed threshold of " +
                "$buffer, so starting here leaves it silent.",
            PrefillPolicy.shouldStart(false, between, sampleRate, false, buffer)
        )
    }

    @Test
    fun `starts once the buffer is full when the threshold is fixed`() {
        assertTrue(PrefillPolicy.shouldStart(false, buffer, sampleRate, false, buffer))
    }

    @Test
    fun `never starts twice`() {
        assertFalse(PrefillPolicy.shouldStart(true, buffer, sampleRate, true, buffer))
    }

    // --- tailPaddingFrames ---

    @Test
    fun `no padding when the threshold can be lowered instead`() {
        assertEquals(0, PrefillPolicy.tailPaddingFrames(1000, true, buffer))
    }

    @Test
    fun `pads up to the buffer when the threshold is fixed`() {
        assertEquals(buffer - 1000, PrefillPolicy.tailPaddingFrames(1000, false, buffer))
    }

    @Test
    fun `no padding once the buffer is already full`() {
        assertEquals(0, PrefillPolicy.tailPaddingFrames(buffer, false, buffer))
    }

    // --- track replacement ---

    /**
     * The second blocker: a replacement track is empty, so carrying the previous
     * playbackStarted would start it immediately and drop a remainder below its threshold.
     */
    @Test
    fun `a replaced track must earn its own prefill`() {
        val state = PrefillPolicy.onTrackReplaced()
        assertFalse("playbackStarted must reset", state.playbackStarted)
        assertEquals("buffered frames must reset", 0, state.framesInCurrentTrack)

        assertFalse(
            "Immediately after replacement the new track holds nothing, so it must not start.",
            PrefillPolicy.shouldStart(
                state.playbackStarted,
                state.framesInCurrentTrack,
                sampleRate,
                true,
                buffer
            )
        )
    }
}
