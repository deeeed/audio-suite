import { LegacyEventEmitter, type EventSubscription } from 'expo-modules-core'

import {
    BitDepth,
    TrimAudioOptions,
    TrimAudioResult,
    TrimProgressEvent,
} from './AudioStudio.types'
import AudioStudioModule from './AudioStudioModule'
import { isWeb } from './constants'
import { processAudioBuffer } from './utils/audioProcessing'
import { cleanNativeOptions } from './utils/cleanNativeOptions'
import { encodeCompressedAudio } from './utils/encodeCompressedAudio.web'
import { resampleAudioBuffer } from './utils/resampleAudioBuffer.web'
import { writeWavHeader } from './utils/writeWavHeader'

// Create a single emitter instance
const emitter = new LegacyEventEmitter(AudioStudioModule)

function sliceAudioBuffer(
    src: AudioBuffer,
    ctx: AudioContext,
    startMs: number,
    endMs: number
): AudioBuffer {
    const sr = src.sampleRate
    const start = Math.floor((startMs / 1000) * sr)
    const end = Math.min(Math.ceil((endMs / 1000) * sr), src.length)
    const length = Math.max(0, end - start)
    const out = ctx.createBuffer(src.numberOfChannels, length, sr)
    for (let c = 0; c < src.numberOfChannels; c++) {
        out.getChannelData(c).set(src.getChannelData(c).subarray(start, end))
    }
    return out
}

function encodeBufferToWav(
    buffer: AudioBuffer,
    bitDepth: BitDepth
): ArrayBuffer {
    const { length, numberOfChannels, sampleRate } = buffer
    const channels: Float32Array[] = []
    for (let c = 0; c < numberOfChannels; c++) {
        channels.push(buffer.getChannelData(c))
    }
    const interleavedData = new Int16Array(length * numberOfChannels)
    for (let i = 0; i < length; i++) {
        for (let c = 0; c < numberOfChannels; c++) {
            const clamped = Math.max(-1, Math.min(1, channels[c][i]))
            interleavedData[i * numberOfChannels + c] = Math.round(
                clamped * 32767
            )
        }
    }
    return writeWavHeader({
        buffer: interleavedData.buffer as ArrayBuffer,
        sampleRate,
        numChannels: numberOfChannels,
        bitDepth,
    })
}

/**
 * Trims an audio file based on the provided options.
 *
 * @experimental This API is experimental and not fully optimized for production use.
 * Performance may vary based on file size and device capabilities.
 * Future versions may include breaking changes.
 *
 * @param options Configuration options for the trimming operation
 * @param progressCallback Optional callback to receive progress updates
 * @returns Promise resolving to the trimmed audio file information, including processing time
 */
export async function trimAudio(
    options: TrimAudioOptions,
    progressCallback?: (event: TrimProgressEvent) => void
): Promise<TrimAudioResult> {
    // Validation
    if (!options.fileUri) {
        throw new Error('fileUri is required')
    }
    const mode = options.mode ?? 'single'
    if (mode === 'single') {
        if (
            options.startTimeMs === undefined &&
            options.endTimeMs === undefined
        ) {
            throw new Error(
                'At least one of startTimeMs or endTimeMs must be provided in single mode'
            )
        }
    } else if (mode === 'keep' || mode === 'remove') {
        if (!options.ranges || options.ranges.length === 0) {
            throw new Error(
                'ranges must be provided and non-empty for keep or remove modes'
            )
        }
    } else {
        throw new Error(
            `Invalid mode: ${mode}. Must be 'single', 'keep', or 'remove'`
        )
    }

    if (isWeb) {
        try {
            const startTime = performance.now()
            const {
                fileUri,
                startTimeMs,
                endTimeMs,
                ranges,
                outputFileName,
                outputFormat,
            } = options

            // Create AudioContext
            const audioContext = new (window.AudioContext ||
                (window as any).webkitAudioContext)()

            // First, load the entire audio file to get its properties
            const response = await fetch(fileUri)
            const arrayBuffer = await response.arrayBuffer()
            const originalAudioBuffer =
                await audioContext.decodeAudioData(arrayBuffer)

            // Get original audio properties
            const originalSampleRate = originalAudioBuffer.sampleRate
            const originalChannels = originalAudioBuffer.numberOfChannels

            // Determine output format - use original values as defaults if not specified
            let format = outputFormat?.format || 'wav'
            const targetSampleRate =
                outputFormat?.sampleRate || originalSampleRate
            const targetChannels = outputFormat?.channels || originalChannels
            const targetBitDepth = outputFormat?.bitDepth || 16

            // Get file info from the URL
            const filename =
                outputFileName ||
                fileUri.split('/').pop() ||
                'trimmed-audio.wav'

            // Process based on mode
            let resultBuffer: AudioBuffer

            // Report initial progress
            progressCallback?.({ progress: 10 })

            if (mode === 'single') {
                // Single mode: extract a single range
                // Use original sample rate and channels for extraction to preserve quality
                const { buffer } = await processAudioBuffer({
                    fileUri,
                    targetSampleRate, // Use the requested sample rate
                    targetChannels,
                    normalizeAudio: false,
                    startTimeMs,
                    endTimeMs,
                    audioContext,
                })

                resultBuffer = buffer

                // If we need to change sample rate or channels, do it after extraction
                if (
                    targetSampleRate !== originalSampleRate ||
                    targetChannels !== originalChannels
                ) {
                    resultBuffer = await resampleAudioBuffer(
                        buffer,
                        targetSampleRate,
                        targetChannels
                    )
                }
            } else {
                // For keep or remove modes
                const fullDuration = originalAudioBuffer.duration * 1000 // in ms

                type ProcessSegment = {
                    startTimeMs: number
                    endTimeMs: number
                }

                let segmentsToProcess: ProcessSegment[] = []

                if (mode === 'keep') {
                    // For keep mode, use the ranges directly
                    segmentsToProcess = ranges!
                } else {
                    // mode === 'remove'
                    // For remove mode, invert the ranges
                    const sortedRanges = [...ranges!].sort(
                        (a, b) => a.startTimeMs - b.startTimeMs
                    )

                    // Add segment from start to first range if needed
                    if (
                        sortedRanges.length > 0 &&
                        sortedRanges[0].startTimeMs > 0
                    ) {
                        segmentsToProcess.push({
                            startTimeMs: 0,
                            endTimeMs: sortedRanges[0].startTimeMs,
                        })
                    }

                    // Add segments between ranges
                    for (let i = 0; i < sortedRanges.length - 1; i++) {
                        segmentsToProcess.push({
                            startTimeMs: sortedRanges[i].endTimeMs,
                            endTimeMs: sortedRanges[i + 1].startTimeMs,
                        })
                    }

                    // Add segment from last range to end if needed
                    if (
                        sortedRanges.length > 0 &&
                        sortedRanges[sortedRanges.length - 1].endTimeMs <
                            fullDuration
                    ) {
                        segmentsToProcess.push({
                            startTimeMs:
                                sortedRanges[sortedRanges.length - 1].endTimeMs,
                            endTimeMs: fullDuration,
                        })
                    }
                }

                // Filter out empty or invalid segments
                segmentsToProcess = segmentsToProcess.filter(
                    (segment) =>
                        segment.startTimeMs < segment.endTimeMs &&
                        segment.endTimeMs - segment.startTimeMs > 1
                ) // 1ms minimum

                if (segmentsToProcess.length === 0) {
                    throw new Error(
                        'No valid segments to process after filtering ranges'
                    )
                }

                // Process each segment using original sample rate and channels
                const segmentBuffers: AudioBuffer[] = []

                for (let i = 0; i < segmentsToProcess.length; i++) {
                    const segment = segmentsToProcess[i]

                    // Report progress for each segment
                    progressCallback?.({
                        progress:
                            10 +
                            Math.round((i / segmentsToProcess.length) * 40),
                    })

                    // Slice from the already-decoded buffer (avoids N re-fetches)
                    const segmentBuffer = sliceAudioBuffer(
                        originalAudioBuffer,
                        audioContext,
                        segment.startTimeMs,
                        segment.endTimeMs
                    )

                    segmentBuffers.push(segmentBuffer)
                }

                // Concatenate all segments
                const totalSamples = segmentBuffers.reduce(
                    (sum, buffer) => sum + buffer.length,
                    0
                )

                // Create buffer with original properties first
                const concatenatedBuffer = audioContext.createBuffer(
                    originalChannels,
                    totalSamples,
                    originalSampleRate
                )

                let offset = 0
                for (const segmentBuffer of segmentBuffers) {
                    for (
                        let channel = 0;
                        channel < originalChannels;
                        channel++
                    ) {
                        const outputData =
                            concatenatedBuffer.getChannelData(channel)
                        const segmentData =
                            segmentBuffer.getChannelData(channel)

                        for (let i = 0; i < segmentBuffer.length; i++) {
                            outputData[offset + i] = segmentData[i]
                        }
                    }
                    offset += segmentBuffer.length
                }

                resultBuffer = concatenatedBuffer

                // If we need to change sample rate or channels, do it after concatenation
                if (
                    targetSampleRate !== originalSampleRate ||
                    targetChannels !== originalChannels
                ) {
                    resultBuffer = await resampleAudioBuffer(
                        concatenatedBuffer,
                        targetSampleRate,
                        targetChannels
                    )
                }
            }

            // Report progress (50% - processing complete)
            progressCallback?.({ progress: 50 })

            // Encode the result based on the requested format
            let outputData: ArrayBuffer
            let outputMimeType: string
            let compressionInfo: TrimAudioResult['compression'] = undefined

            // AAC is not reliably supported in browsers; fall back to opus
            if (format === 'aac') {
                console.warn(
                    'AAC format is not supported on web platforms. Falling back to OPUS format.'
                )
                format = 'opus'
            }

            if (format === 'wav') {
                outputData = encodeBufferToWav(
                    resultBuffer,
                    targetBitDepth as BitDepth
                )
                outputMimeType = 'audio/wav'
            } else if (format === 'opus') {
                try {
                    const { data, bitrate } = await encodeCompressedAudio(
                        resultBuffer,
                        format,
                        outputFormat?.bitrate
                    )
                    outputData = data
                    outputMimeType = 'audio/webm'
                    compressionInfo = { format, bitrate, size: data.byteLength }
                } catch (error) {
                    console.warn(
                        `Failed to encode to ${format}, falling back to WAV: ${error}`
                    )
                    outputData = encodeBufferToWav(
                        resultBuffer,
                        targetBitDepth as BitDepth
                    )
                    outputMimeType = 'audio/wav'
                }
            } else {
                // Default to WAV for unsupported formats
                console.warn(
                    `Format ${format} not supported on web, using WAV instead`
                )
                outputData = encodeBufferToWav(
                    resultBuffer,
                    targetBitDepth as BitDepth
                )
                outputMimeType = 'audio/wav'
            }

            // Report progress (90% - encoding complete)
            progressCallback?.({ progress: 90 })

            // Create a blob and URL for the result
            const blob = new Blob([outputData], { type: outputMimeType })
            const outputUri = URL.createObjectURL(blob)

            // Calculate processing time
            const processingTimeMs = performance.now() - startTime

            // Report progress (100% - complete)
            progressCallback?.({ progress: 100 })

            // Create result object
            const result: TrimAudioResult = {
                uri: outputUri,
                filename,
                durationMs: Math.round(resultBuffer.duration * 1000),
                size: outputData.byteLength,
                sampleRate: resultBuffer.sampleRate,
                channels: resultBuffer.numberOfChannels,
                bitDepth: targetBitDepth,
                mimeType: outputMimeType,
                processingInfo: {
                    durationMs: processingTimeMs,
                },
            }

            if (compressionInfo) {
                result.compression = compressionInfo
            }

            return result
        } catch (error) {
            console.error('Error in trimAudio:', error)
            throw error
        }
    }

    // Set up progress event listener if callback is provided
    let subscription: EventSubscription | undefined
    if (progressCallback) {
        subscription = emitter.addListener(
            'TrimProgress',
            (event: TrimProgressEvent) => {
                progressCallback(event)
            }
        )
    }

    try {
        // Clean non-serializable/undefined values to avoid Android Kotlin bridge crash
        const result = await AudioStudioModule.trimAudio(
            cleanNativeOptions(options)
        )
        return result
    } finally {
        if (subscription) {
            subscription.remove()
        }
    }
}

/**
 * Simplified version of trimAudio that returns only the URI of the trimmed file.
 *
 * @experimental This API is experimental and not fully optimized for production use.
 * Performance may vary based on file size and device capabilities.
 * Future versions may include breaking changes.
 *
 * @param options Configuration options for the trimming operation
 * @returns Promise resolving to the URI of the trimmed audio file
 */
export async function trimAudioSimple(
    options: TrimAudioOptions
): Promise<string> {
    const result = await trimAudio(options)
    return result.uri
}
