// packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts

import { BitDepth, ConsoleLike } from '../AudioStudio.types'

/**
 * Represents the configuration for decoding audio data.
 */
export interface DecodingConfig {
    /** Target sample rate for decoded audio (Android and Web) */
    targetSampleRate?: number
    /** Target number of channels (Android and Web) */
    targetChannels?: number
    /** Target bit depth (Android and Web) */
    targetBitDepth?: BitDepth
    /** Whether to normalize audio levels (Android and Web) */
    normalizeAudio?: boolean
    /**
     * RMS threshold below which a segment is flagged silent.
     * Range 0..1. Default 0.01.
     * Currently applied as a JS post-process so the same behavior holds across iOS/Android/Web.
     */
    silenceRmsThreshold?: number
}

/**
 * Represents speech-related features extracted from audio.
 */
export interface SpeechFeatures {
    isActive: boolean // Whether speech is detected in this segment
    speakerId?: number // Optional speaker identification
    // Could add more speech-related features here like:
    // confidence: number
    // language?: string
    // sentiment?: number
    // etc.
}

/**
 * Represents various audio features extracted from an audio signal.
 */
export interface AudioFeatures {
    energy?: number // The infinite integral of the squared signal, representing the overall energy of the audio.
    mfcc?: number[] // Mel-frequency cepstral coefficients, describing the short-term power spectrum of a sound.
    rms?: number // Root mean square value, indicating the amplitude of the audio signal.
    minAmplitude?: number // Minimum amplitude value in the audio signal.
    maxAmplitude?: number // Maximum amplitude value in the audio signal.
    zcr?: number // Zero-crossing rate, indicating the rate at which the signal changes sign.
    spectralCentroid?: number // The center of mass of the spectrum, indicating the brightness of the sound.
    spectralFlatness?: number // Measure of the flatness of the spectrum, indicating how noise-like the signal is.
    spectralRolloff?: number // The frequency below which a specified percentage (usually 85%) of the total spectral energy lies.
    spectralBandwidth?: number // The width of the spectrum, indicating the range of frequencies present.
    chromagram?: number[] // Chromagram, representing the 12 different pitch classes of the audio.
    tempo?: number // Estimated tempo of the audio signal, measured in beats per minute (BPM).
    hnr?: number // Harmonics-to-noise ratio, indicating the proportion of harmonics to noise in the audio signal.
    melSpectrogram?: number[] // Mel-scaled spectrogram representation of the audio.
    spectralContrast?: number[] // Spectral contrast features representing the difference between peaks and valleys.
    tonnetz?: number[] // Tonal network features representing harmonic relationships.
    pitch?: number // Pitch of the audio signal, measured in Hertz (Hz).
    crc32?: number // crc32 checksum of the audio signal, used to verify the integrity of the audio.
}

/**
 * Options to specify which audio features to extract.
 * Note: Advanced features (spectral features, chromagram, pitch, etc.) are experimental,
 * especially during live recording, due to high processing requirements.
 */
export interface AudioFeaturesOptions {
    // Basic features - well optimized
    energy?: boolean
    rms?: boolean
    zcr?: boolean

    // Advanced features - experimental, may impact performance in live recording
    mfcc?: boolean
    spectralCentroid?: boolean
    spectralFlatness?: boolean
    spectralRolloff?: boolean
    spectralBandwidth?: boolean
    chromagram?: boolean
    tempo?: boolean
    hnr?: boolean
    melSpectrogram?: boolean
    spectralContrast?: boolean
    tonnetz?: boolean
    pitch?: boolean

    // Utility
    crc32?: boolean
}

/**
 * Represents a single data point in the audio analysis.
 */
export interface DataPoint {
    id: number
    amplitude: number // Peak amplitude for the segment
    rms: number // Root mean square value
    dB: number // dBFS (decibels relative to full scale) computed from RMS value
    silent: boolean // Always computed
    features?: AudioFeatures
    speech?: SpeechFeatures
    startTime?: number
    endTime?: number
    // start / end position in bytes
    startPosition?: number
    endPosition?: number
    // number of audio samples for this point (samples size depends on bit depth)
    samples?: number
}

/**
 * Represents the complete data from the audio analysis.
 */
export interface AudioAnalysis {
    segmentDurationMs: number // Duration of each segment in milliseconds
    durationMs: number // Duration of the audio in milliseconds
    /**
     * Bit depth used for audio analysis processing.
     *
     * **Important**: This represents the internal processing bit depth, which may differ
     * from the recording bit depth. Audio is typically converted to 32-bit float for
     * analysis to ensure precision in calculations, regardless of the original recording format.
     *
     * Platform behavior:
     * - iOS: Always 32 (float processing)
     * - Android: Always 32 (float processing)
     * - Web: Always 32 (Web Audio API standard)
     *
     * The actual recorded file will maintain the requested bit depth (8, 16, or 32).
     */
    bitDepth: number
    samples: number // Size of the audio in bytes
    numberOfChannels: number // Number of audio channels
    sampleRate: number // Sample rate of the audio
    dataPoints: DataPoint[] // Array of data points from the analysis.
    amplitudeRange: {
        min: number
        max: number
    }
    rmsRange: {
        min: number
        max: number
    }
    extractionTimeMs: number // Time taken to extract/process the analysis in milliseconds
    // TODO: speaker changes into a broader speech analysis section
    speechAnalysis?: {
        speakerChanges: {
            timestamp: number
            speakerId: number
        }[]
        // Could add more speech analysis data here like:
        // dominantSpeaker?: number
        // totalSpeechDuration?: number
        // speakerStats?: { [speakerId: number]: { duration: number, segments: number } }
    }
}

/**
 * Options for specifying a time range within an audio file.
 */
export interface AudioRangeOptions {
    /** Start time in milliseconds */
    startTimeMs?: number
    /** End time in milliseconds */
    endTimeMs?: number
}

/**
 * Options for generating a quick preview of audio waveform.
 * This is optimized for UI rendering with a specified number of points.
 */
export interface PreviewBar {
    /** Stable zero-based bar identifier. */
    id: number
    /** Peak amplitude for this bar, normalized to 0..1. */
    amplitude: number
    /** Root mean square amplitude for this bar, normalized to 0..1. */
    rms: number
    /** Whether this bar is below the configured silence RMS threshold. */
    silent: boolean
    /** Bar start time in milliseconds from the extracted range start. */
    startTimeMs: number
    /** Bar end time in milliseconds from the extracted range start. */
    endTimeMs: number
}

/**
 * Compact preview-bars result for UI waveform rendering.
 * Unlike `AudioAnalysis`, this intentionally omits full `DataPoint` feature data.
 */
export interface PreviewBarsResult {
    bars: PreviewBar[]
    durationMs: number
    sampleRate: number
    numberOfChannels: number
    bitDepth: number
    samples: number
    /** Requested bar count before native/platform clamping. */
    requestedNumberOfBars: number
    /** Approximate duration represented by each bar. */
    barDurationMs: number
    amplitudeRange: {
        min: number
        max: number
    }
    rmsRange: {
        min: number
        max: number
    }
    extractionTimeMs: number
}

/**
 * Options for extracting compact waveform preview bars for UI rendering.
 */
export interface PreviewBarsOptions extends AudioRangeOptions {
    /** URI of the audio file to analyze */
    fileUri: string
    /**
     * Total number of bars to generate for the preview.
     * @default 100
     */
    numberOfBars?: number
    /** Optional logger for debugging. */
    logger?: ConsoleLike
    /** Optional configuration for decoding the audio file. */
    decodingOptions?: DecodingConfig
    /**
     * Optional callback fired once per compact bar after extraction resolves.
     * Native progressive streaming is not implied by this callback.
     */
    onBarReady?: (bar: PreviewBar, index: number, total: number) => void
}

export interface PreviewOptions extends AudioRangeOptions {
    /** URI of the audio file to analyze */
    fileUri: string
    /**
     * Total number of points to generate for the preview.
     * @default 100
     */
    numberOfPoints?: number
    /**
     * Optional logger for debugging.
     */
    logger?: ConsoleLike
    /**
     * Optional configuration for decoding the audio file.
     * Defaults to:
     * - targetSampleRate: undefined (keep original)
     * - targetChannels: undefined (keep original)
     * - targetBitDepth: 16
     * - normalizeAudio: false
     */
    decodingOptions?: DecodingConfig
    /**
     * Optional callback fired once per data point as the preview becomes available.
     * Today the native module returns the full analysis in one shot; the points are then
     * micro-batched on the JS side so consumers can render bars incrementally.
     * Native progressive streaming is a future enhancement.
     */
    onPointReady?: (point: DataPoint, index: number, total: number) => void
    /**
     * Optional cancellation signal for JS-side progressive point emission.
     * Aborting does not cancel native extraction after it has started, but it
     * stops any queued `onPointReady` callbacks from an older request.
     */
    signal?: AbortSignal
}

/**
 * Options for mel-spectrogram extraction
 *
 * @experimental This feature is experimental and currently only available on Android.
 * The API may change in future versions.
 */
export interface ExtractMelSpectrogramOptions {
    fileUri?: string // Path to audio file
    arrayBuffer?: ArrayBuffer // Raw audio buffer
    windowSizeMs: number // Window size in ms (e.g., 25)
    hopLengthMs: number // Hop length in ms (e.g., 10)
    nMels: number // Number of mel filters (e.g., 60)
    fMin?: number // Min frequency (default: 0)
    fMax?: number // Max frequency (default: sampleRate / 2)
    windowType?: 'hann' | 'hamming' // Window function (default: 'hann')
    normalize?: boolean // Mean normalization (default: false)
    logScale?: boolean // Log scaling of mel energies (default: true)
    decodingOptions?: DecodingConfig // Audio decoding settings
    /** Optional start time in ms. If neither startTimeMs nor endTimeMs is set, defaults to 0. */
    startTimeMs?: number
    /** Optional end time in ms. Clamped so that the range does not exceed MAX_DURATION_MS (30 s). */
    endTimeMs?: number
    logger?: ConsoleLike
}

/**
 * Result type for WASM-based audio feature extraction.
 */
export interface AudioFeaturesWasmResult {
    spectralCentroid: number
    spectralFlatness: number
    spectralRolloff: number
    spectralBandwidth: number
    mfcc: number[]
    chromagram: number[]
}

/**
 * Return type for mel spectrogram extraction
 *
 * @experimental This feature is experimental and currently only available on Android.
 * The API may change in future versions.
 */
export interface MelSpectrogram {
    spectrogram: number[][] // 2D array [time][mel]
    sampleRate: number // Audio sample rate
    nMels: number // Number of mel filters
    timeSteps: number // Number of time frames
    durationMs: number // Audio duration in ms
}
