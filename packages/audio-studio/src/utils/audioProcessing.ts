// packages/audio-studio/src/utils/audioProcessing.ts
import { Platform } from 'react-native'

import { ConsoleLike } from '../AudioStudio.types'

export interface ProcessAudioBufferOptions {
    arrayBuffer?: ArrayBuffer
    fileUri?: string
    targetSampleRate?: number
    targetChannels: number
    normalizeAudio: boolean
    startTimeMs?: number
    endTimeMs?: number
    position?: number
    length?: number
    audioContext?: AudioContext
    logger?: ConsoleLike
}

export interface ProcessedAudioData {
    channelData: Float32Array
    samples: number
    durationMs: number
    sampleRate: number
    channels: number
    buffer: AudioBuffer
}

export async function processAudioBuffer({
    arrayBuffer,
    fileUri,
    targetSampleRate,
    targetChannels,
    normalizeAudio,
    startTimeMs,
    endTimeMs,
    position,
    length,
    audioContext,
    logger,
}: ProcessAudioBufferOptions): Promise<ProcessedAudioData> {
    if (Platform.OS !== 'web') {
        throw new Error('processAudioBuffer is only supported on web')
    }

    let ctx: AudioContext | undefined
    let buffer: AudioBuffer | undefined

    try {
        // Log initial parameters
        logger?.debug('Process audio buffer - Initial params:', {
            hasArrayBuffer: !!arrayBuffer,
            fileUri,
            targetSampleRate,
            targetChannels,
            normalizeAudio,
            startTimeMs,
            endTimeMs,
            position,
            length,
        })

        // Get the audio data
        let audioData: ArrayBuffer
        if (arrayBuffer) {
            audioData = arrayBuffer
        } else if (fileUri) {
            const response = await fetch(fileUri)
            if (!response.ok) {
                throw new Error(
                    `Failed to fetch fileUri: ${response.statusText}`
                )
            }
            audioData = await response.arrayBuffer()
        } else {
            throw new Error('Either arrayBuffer or fileUri must be provided')
        }

        logger?.debug('Audio data loaded:', {
            byteLength: audioData.byteLength,
            firstBytes: Array.from(new Uint8Array(audioData.slice(0, 16))),
        })

        // Create context at original sample rate first
        ctx =
            audioContext ||
            new (window.AudioContext ||
                (
                    window as unknown as {
                        webkitAudioContext?: typeof AudioContext
                    }
                ).webkitAudioContext)()
        buffer = await ctx.decodeAudioData(audioData)

        const effectiveTargetSampleRate = targetSampleRate ?? buffer.sampleRate

        logger?.debug('Decoded audio buffer:', {
            originalChannels: buffer.numberOfChannels,
            originalSampleRate: buffer.sampleRate,
            originalDuration: buffer.duration,
            originalLength: buffer.length,
        })

        // Calculate time range
        const startSample =
            startTimeMs !== undefined
                ? Math.floor((startTimeMs / 1000) * buffer.sampleRate)
                : position !== undefined
                  ? Math.floor(position / 2)
                  : 0

        // Fix: Adjust position calculation based on original sample rate
        // When position is provided in bytes, we need to account for the original sample rate
        const bytesPerSample = 2 // 16-bit audio = 2 bytes per sample
        const adjustedStartSample =
            position !== undefined
                ? Math.floor(
                      (position / bytesPerSample) *
                          (buffer.sampleRate / effectiveTargetSampleRate)
                  )
                : startSample

        const samplesNeeded =
            length !== undefined
                ? Math.floor(
                      (length / bytesPerSample) *
                          (buffer.sampleRate / effectiveTargetSampleRate)
                  )
                : endTimeMs !== undefined
                  ? Math.floor(
                        ((endTimeMs - (startTimeMs ?? 0)) / 1000) *
                            buffer.sampleRate
                    )
                  : buffer.length - adjustedStartSample

        logger?.debug('Sample calculations (adjusted):', {
            originalStartSample: startSample,
            adjustedStartSample,
            samplesNeeded,
            originalSampleRate: buffer.sampleRate,
            targetSampleRate: effectiveTargetSampleRate,
            conversionRatio: buffer.sampleRate / effectiveTargetSampleRate,
            expectedDurationMs: (samplesNeeded / buffer.sampleRate) * 1000,
        })

        // Create temporary buffer for the segment
        const segmentBuffer = ctx.createBuffer(
            buffer.numberOfChannels,
            samplesNeeded,
            buffer.sampleRate
        )

        // Copy the segment
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const channelData = buffer.getChannelData(channel)
            const segmentData = segmentBuffer.getChannelData(channel)
            for (let i = 0; i < samplesNeeded; i++) {
                segmentData[i] = channelData[adjustedStartSample + i]
            }
        }

        // Create offline context for resampling
        const offlineCtx = new OfflineAudioContext(
            targetChannels,
            Math.ceil(
                (samplesNeeded * effectiveTargetSampleRate) / buffer.sampleRate
            ),
            effectiveTargetSampleRate
        )

        // Create source and connect
        const source = offlineCtx.createBufferSource()
        source.buffer = segmentBuffer
        source.connect(offlineCtx.destination)

        // Render at new sample rate
        source.start()
        const processedBuffer = await offlineCtx.startRendering()

        // Get the final audio data
        const channelData = processedBuffer.getChannelData(0)
        const durationMs = Math.round(
            (samplesNeeded / buffer.sampleRate) * 1000
        )

        logger?.debug('Final processed audio:', {
            outputSamples: channelData.length,
            outputSampleRate: effectiveTargetSampleRate,
            durationMs,
        })

        return {
            buffer: processedBuffer,
            channelData,
            samples: channelData.length,
            durationMs,
            sampleRate: effectiveTargetSampleRate,
            channels: processedBuffer.numberOfChannels,
        }
    } catch (error) {
        logger?.error('Failed to process audio buffer:', {
            error,
            position,
            length,
            startTimeMs,
            endTimeMs,
            bufferLength: buffer?.length,
        })
        throw error
    } finally {
        if (!audioContext && ctx) {
            await ctx.close()
        }
    }
}
