package net.siteed.audiostudio

import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

/**
 * Sequences that produced real defects while the resolving logic itself was correct (#428).
 *
 * Each test names the caller path it stands for. The manager drives the same transitions:
 * `onInitializeRecorders` from `initializeAudioRecord`, `onTeardown` from `stopRecording`
 * and `cleanup`.
 */
class AudioSourceLifecycleTest {

    /** Counts resolves so a test can tell "kept" apart from "re-resolved to the same value". */
    private class Resolver(private vararg val sources: String) {
        var calls = 0
            private set

        fun next(): String = sources[calls.coerceAtMost(sources.size - 1)].also { calls++ }
    }

    @Test
    fun `resolves once when the recorders are first built`() {
        val lifecycle = AudioSourceLifecycle<String>()
        val resolver = Resolver("unprocessed")

        lifecycle.onInitializeRecorders(resolver::next)

        assertEquals("unprocessed", lifecycle.resolved)
        assertEquals(1, resolver.calls)
    }

    @Test
    fun `device change keeps the source the compressed recorder is still open on`() {
        // initializeAudioRecord runs again on device change while the compressed recorder is
        // only paused. Re-resolving here could flip PCM to mic and leave the two mismatched.
        val lifecycle = AudioSourceLifecycle<String>()
        val resolver = Resolver("unprocessed", "mic")

        lifecycle.onInitializeRecorders(resolver::next)
        lifecycle.onInitializeRecorders(resolver::next)

        assertEquals("unprocessed", lifecycle.resolved)
        assertEquals(1, resolver.calls)
    }

    @Test
    fun `pause then resume keeps the source`() {
        val lifecycle = AudioSourceLifecycle<String>()
        val resolver = Resolver("voiceRecognition", "mic")

        lifecycle.onInitializeRecorders(resolver::next)
        // Resume rebuilds the PCM recorder; the compressed one was never released.
        lifecycle.onInitializeRecorders(resolver::next)

        assertEquals("voiceRecognition", lifecycle.resolved)
        assertEquals(1, resolver.calls)
    }

    @Test
    fun `prepare then start reports what preparation resolved`() {
        // The round-2 blocker: start cleared the source before checking isPrepared, and a
        // prepared start skips initialization, so a non-mic recording reported mic.
        val lifecycle = AudioSourceLifecycle<String>()
        val resolver = Resolver("unprocessed")

        lifecycle.onInitializeRecorders(resolver::next) // prepareRecording()
        // startRecording() with isPrepared == true does not initialize again.

        assertEquals("unprocessed", lifecycle.resolved)
    }

    @Test
    fun `stop then prepare with a new source does not reuse the old one`() {
        // Also from round 2: preparation after a stop must resolve fresh.
        val lifecycle = AudioSourceLifecycle<String>()
        val resolver = Resolver("unprocessed", "mic")

        lifecycle.onInitializeRecorders(resolver::next)
        lifecycle.onTeardown()
        lifecycle.onInitializeRecorders(resolver::next)

        assertEquals("mic", lifecycle.resolved)
        assertEquals(2, resolver.calls)
    }

    @Test
    fun `a failed attempt does not leak its source into the next one`() {
        // Round-3 blocker: each initializer catches its own exception and returns false, so
        // a caller returns early without reaching any catch or cleanup. Preparation that
        // fails after resolving must not leave that source behind for a different request.
        val lifecycle = AudioSourceLifecycle<String>()
        val resolver = Resolver("unprocessed", "mic")

        lifecycle.onBeginAttempt()
        lifecycle.onInitializeRecorders(resolver::next)
        // ...compressed-recorder init fails here and prepareRecording() returns false.

        lifecycle.onBeginAttempt()
        lifecycle.onInitializeRecorders(resolver::next)

        assertEquals("mic", lifecycle.resolved)
        assertEquals(2, resolver.calls)
    }

    @Test
    fun `teardown drops the source so nothing reads a stale value`() {
        val lifecycle = AudioSourceLifecycle<String>()

        lifecycle.onInitializeRecorders { "unprocessed" }
        lifecycle.onTeardown()

        assertNull(lifecycle.resolved)
    }

    @Test
    fun `a full session resolves once per recording`() {
        val lifecycle = AudioSourceLifecycle<String>()
        val resolver = Resolver("unprocessed", "voiceRecognition")

        // prepare -> start -> device change -> pause -> resume -> stop
        lifecycle.onInitializeRecorders(resolver::next)
        lifecycle.onInitializeRecorders(resolver::next)
        lifecycle.onInitializeRecorders(resolver::next)
        assertEquals("unprocessed", lifecycle.resolved)
        assertEquals(1, resolver.calls)

        lifecycle.onTeardown()

        // A second recording asking for something else gets it.
        lifecycle.onInitializeRecorders(resolver::next)
        assertEquals("voiceRecognition", lifecycle.resolved)
        assertEquals(2, resolver.calls)
    }
}
