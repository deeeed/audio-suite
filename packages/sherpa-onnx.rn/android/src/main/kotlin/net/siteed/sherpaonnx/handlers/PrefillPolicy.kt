package net.siteed.sherpaonnx.handlers

/**
 * Decides when a prefilled AudioTrack should start playing.
 *
 * Extracted from [TtsHandler] because the decision is the part that keeps being wrong and
 * the part that was untestable. Two defects — gating on the wrong threshold, and carrying
 * playback state across a track replacement — survived six passing AudioTrack tests,
 * because those tests rebuilt the framework setup instead of exercising this logic.
 *
 * Pure and framework-free: callers supply the device's capabilities, so every branch can
 * be tested without an AudioTrack, including the pre-S paths a modern test device can
 * never reach.
 */
internal object PrefillPolicy {

    /** Prefill target before starting playback, as a fraction of one second. */
    const val PREFILL_DIVISOR = 5 // 1/5s = 200ms

    fun prefillFrames(sampleRate: Int): Int = sampleRate / PREFILL_DIVISOR

    /**
     * Frames that must be buffered before `play()` actually produces output.
     *
     * A MODE_STREAM track starts only once its buffer holds `startThresholdInFrames`.
     * When that value is writable (API 31+) it is lowered to the prefill target at build
     * time, so the target governs. When it is not, the threshold stays at the full buffer
     * capacity, and starting after 200 ms leaves the track waiting on samples that may
     * never arrive.
     *
     * @param canLowerThreshold whether `startThresholdInFrames` is writable on this device
     * @param bufferSizeInFrames the track's buffer capacity
     */
    fun effectivePrefillFrames(
        sampleRate: Int,
        canLowerThreshold: Boolean,
        bufferSizeInFrames: Int,
    ): Int {
        val target = prefillFrames(sampleRate)
        if (canLowerThreshold) return target
        return maxOf(target, bufferSizeInFrames)
    }

    /** Should playback start now, given what the CURRENT track holds? */
    fun shouldStart(
        playbackStarted: Boolean,
        framesInCurrentTrack: Int,
        sampleRate: Int,
        canLowerThreshold: Boolean,
        bufferSizeInFrames: Int,
    ): Boolean {
        if (playbackStarted) return false
        return framesInCurrentTrack >=
            effectivePrefillFrames(sampleRate, canLowerThreshold, bufferSizeInFrames)
    }

    /**
     * Frames of silence to append so a finished utterance that never reached the threshold
     * can still start. Zero when the threshold is lowerable, since the caller lowers it
     * instead of padding.
     */
    fun tailPaddingFrames(
        framesInCurrentTrack: Int,
        canLowerThreshold: Boolean,
        bufferSizeInFrames: Int,
    ): Int {
        if (canLowerThreshold) return 0
        return maxOf(0, bufferSizeInFrames - framesInCurrentTrack)
    }

    /**
     * State for a replacement track. A replacement is empty, so it must earn its own
     * prefill: carrying the previous `playbackStarted` would start it immediately and let
     * a remainder below its threshold play as silence, or not at all.
     */
    data class TrackState(val playbackStarted: Boolean, val framesInCurrentTrack: Int)

    fun onTrackReplaced(): TrackState = TrackState(playbackStarted = false, framesInCurrentTrack = 0)
}
