// packages/audio-studio/src/events.ts

import { LegacyEventEmitter, type EventSubscription } from 'expo-modules-core'

import { AudioAnalysis } from './AudioAnalysis/AudioAnalysis.types'
import type {
    MaxDurationReachedEvent,
    RecordingInterruptionEvent,
} from './AudioStudio.types'
import AudioStudioModule from './AudioStudioModule'

const emitter = new LegacyEventEmitter(AudioStudioModule)

// Internal event payload from native module
export interface AudioEventPayload {
    encoded?: string
    /** Float32 samples in [-1, 1] — sent by native when streamFormat='float32'.
     *  Android new arch delivers Float32Array; iOS delivers number[]. */
    pcmFloat32?: Float32Array | number[]
    buffer?: Float32Array
    fileUri: string
    lastEmittedSize: number
    position: number
    deltaSize: number
    totalSize: number
    mimeType: string
    streamUuid: string
    compression?: {
        data?: string | Blob // Base64 (native) or Float32Array (web) encoded compressed data chunk
        position: number
        eventDataSize: number
        totalSize: number
    }
}

export function addAudioEventListener(
    listener: (event: AudioEventPayload) => Promise<void>
): EventSubscription {
    return emitter.addListener<AudioEventPayload>('AudioData', listener)
}

// Only aliasing the AudioAnalysis type for the event payload
export interface AudioAnalysisEvent extends AudioAnalysis {}

export function addAudioAnalysisListener(
    listener: (event: AudioAnalysisEvent) => Promise<void>
): EventSubscription {
    return emitter.addListener<AudioAnalysisEvent>('AudioAnalysis', listener)
}

export function addRecordingInterruptionListener(
    listener: (event: RecordingInterruptionEvent) => void
): EventSubscription {
    // Add debug logging
    console.debug('Adding recording interruption listener')

    const subscription = emitter.addListener<RecordingInterruptionEvent>(
        'onRecordingInterrupted', // Make sure this matches the native event name
        (event) => {
            console.debug('Recording interruption event received:', event)
            listener(event)
        }
    )

    return subscription
}

export function addMaxDurationReachedListener(
    listener: (event: MaxDurationReachedEvent) => void
): EventSubscription {
    return emitter.addListener<MaxDurationReachedEvent>(
        'MaxDurationReached',
        listener
    )
}

export interface RecordingErrorEvent {
    /** Human-readable description of what failed. */
    message: string
}

/**
 * Recording errors reported by the native layer.
 *
 * This is the existing generic iOS `error` event, which had no typed subscription until
 * now — so a failure that does not reject a call was effectively unobservable. That
 * mattered for #420: when the primary WAV stops accepting writes the compressed output
 * keeps going, and a caller relying on the WAV for crash recovery had no signal.
 *
 * The event is not limited to that case, and the severity varies. It currently carries:
 * - a primary WAV that stopped and could not be recovered — recording continues, and any
 *   compressed output is unaffected
 * - a compressed recorder that failed to complete or hit an encode error — that output is
 *   finished
 * - a failed auto-resume or resume after an interruption
 * - input hardware reporting an unusable format, so no tap was installed — this happens on
 *   resume, device switching and foreground recovery as well as on prepare/start
 * - prepare/start refused during an active phone call
 *
 * During prepare/start, either of those last two also accompanies the rejected call, so
 * handling both surfaces the same failure twice.
 *
 * There is no machine-readable discriminator; `message` is prose and its wording is not a
 * stable API. Do not branch on it, and note there is no state to poll in response either —
 * `status()` reports whether recording is running, not whether an output is still healthy.
 * Until the event carries a code, the practical use is logging and telemetry: surfacing
 * that something degraded, not deciding what.
 *
 * Both platforms emit it, but not for the same failures — the underlying APIs fail in
 * different places (#447). Android reports: the AudioRecord leaving its initialized state
 * mid-recording, a read returning an error code, the primary WAV failing to flush, and the
 * recording loop dying. It reports at most one event per degradation episode, re-arming
 * once audio flows again, so the count of events is not a count of failed buffers.
 *
 * Treat silence on either platform as "nothing was reported", not as "recording is
 * healthy": neither platform emits for every way a recording can go wrong.
 */
export function addRecordingErrorListener(
    listener: (event: RecordingErrorEvent) => void
): EventSubscription {
    return emitter.addListener<RecordingErrorEvent>('error', listener)
}
