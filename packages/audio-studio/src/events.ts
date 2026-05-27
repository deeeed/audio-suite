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
