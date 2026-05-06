/**
 * Pre-tuned `amplitudeRange` presets for the bar visualizer. Pin one of
 * these on AudioPlayerWidget / AudioFilePlayerWidget / WaveformPreview /
 * ChatRecordWidget to lock the running peak — without a fixed range, the
 * visualizer rescales every time a louder sample arrives, so identical
 * dB looks different at different points in the same clip.
 *
 * The numeric ranges assume the default `amplitudeScale='sqrt'`. Bump
 * `max` toward 1.0 if you switch to `linear`.
 */

/**
 * Speech (chat-record voice notes, conversation audio). Typical 100ms PCM
 * peaks rarely exceed ~0.2; this lets normal speech fill ~100% of the
 * canvas under sqrt scale while quieter moments still differ visibly
 * (whisper ~0.05 → ~50%, silence ~0.005 → ~16%).
 */
export const SPEECH_AMPLITUDE_RANGE = { min: 0, max: 0.2 } as const

/**
 * Music / mixed-content recordings that genuinely peak high. Use this when
 * speech presets would clip too aggressively.
 */
export const MUSIC_AMPLITUDE_RANGE = { min: 0, max: 0.8 } as const

/**
 * Full-range — equivalent to letting the running peak settle at 1.0. Use
 * for pre-normalized assets where you know peaks reach unity.
 */
export const FULL_AMPLITUDE_RANGE = { min: 0, max: 1 } as const
