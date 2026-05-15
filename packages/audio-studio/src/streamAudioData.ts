import { LegacyEventEmitter, type EventSubscription } from 'expo-modules-core'

import AudioStudioModule from './AudioStudioModule'
import { isWeb } from './constants'
import {
    AudioStreamError,
    AudioStreamErrorCode,
    mapStreamError,
} from './errors/AudioStreamError'
import { processAudioBuffer } from './utils/audioProcessing'

/**
 * High-level API: stream decoded audio from a stored file as bounded Float32
 * chunks without materializing the full PCM range in memory.
 *
 * See `docs/STREAM_AUDIO_DATA.md` for the full contract and rollout notes.
 */
export interface StreamAudioDataOptions {
    /** URI of the audio file to decode. */
    fileUri: string
    /** Start time in milliseconds (default: 0). */
    startTimeMs?: number
    /** End time in milliseconds (default: end-of-file). */
    endTimeMs?: number
    /**
     * Source sample rate hint. Ignored if `targetSampleRate` is set; native
     * decoders read the actual rate from the file.
     */
    sampleRate?: number
    /** Output sample rate. Native resamples when this differs from the file. */
    targetSampleRate?: number
    /** Output channel count (1 = mono downmix, 2 = stereo passthrough). */
    channels?: number
    /** Clamp samples to [-1, 1] and replace non-finite values with 0. */
    normalizeAudio?: boolean
    /** Target chunk duration in ms (default: 1000, min: 10, max: 60000). */
    chunkDurationMs?: number
    /** Soft cap on chunk size in bytes (Float32 = 4 bytes/sample). */
    maxChunkBytes?: number
    /** Max chunks queued in native before JS ack pauses decode (default: 4). */
    maxBufferedChunks?: number
    /**
     * Optional timeout for a chunk acknowledgement while backpressure is active.
     * Undefined/0 disables timeout so long transcription callbacks can run.
     */
    backpressureTimeoutMs?: number
    /** Output PCM format; only `'float32'` supported today. */
    streamFormat?: 'float32'
    /** Abort the in-flight request. Resolves promise with `cancelled: true`. */
    signal?: AbortSignal
}

export interface StreamAudioDataChunk {
    /** Native request id; constant across all chunks of one call. */
    requestId: string
    /** Zero-based monotonic chunk index. */
    chunkIndex: number
    /** Start time in output-rate ms (rounded to nearest sample). */
    startTimeMs: number
    /** End time in output-rate ms. */
    endTimeMs: number
    /** Duration in ms (`endTimeMs - startTimeMs`). */
    durationMs: number
    /** First sample index in the output timeline. */
    startSample: number
    /** Sample count in `samples` (interleaved if channels > 1). */
    sampleCount: number
    /** Output sample rate. */
    sampleRate: number
    /** Output channel count. */
    channels: number
    /** Interleaved Float32 samples in [-1, 1]. */
    samples: Float32Array
    /** True for the last chunk of a non-cancelled run. */
    isFinal: boolean
}

export interface StreamAudioDataProgress {
    requestId: string
    processedMs: number
    durationMs: number
    progress: number
    emittedChunks: number
    bufferedChunks?: number
}

export interface StreamAudioDataResult {
    requestId: string
    durationMs: number
    sampleRate: number
    channels: number
    chunks: number
    samples: number
    cancelled: boolean
}

export interface StreamAudioDataCallbacks {
    /**
     * Called with each decoded chunk. If this returns a Promise, native decode
     * pauses until it resolves (backpressure). Throwing aborts the stream with
     * `ERR_AUDIO_STREAM_DECODE_FAILED`.
     */
    onChunk: (chunk: StreamAudioDataChunk) => void | Promise<void>
    /** Called whenever native reports progress. */
    onProgress?: (progress: StreamAudioDataProgress) => void
}

export interface AudioDecodeCapabilities {
    platform: 'ios' | 'android' | 'web'
    supportedInputFormats: string[]
    supportedOutputFormats: Array<'float32'>
    supportsCancellation: boolean
    supportsBackpressure: boolean
    supportsTimeRange: boolean
    supportsTargetSampleRate: boolean
    supportsChannelMixing: boolean
    knownLimitations?: string[]
}

const CHUNK_EVENT = 'AudioDataStreamChunk'
const PROGRESS_EVENT = 'AudioDataStreamProgress'
const COMPLETE_EVENT = 'AudioDataStreamComplete'
const ERROR_EVENT = 'AudioDataStreamError'

let cachedEmitter: LegacyEventEmitter | null = null
function getEmitter(): LegacyEventEmitter {
    if (!cachedEmitter) {
        cachedEmitter = new LegacyEventEmitter(AudioStudioModule)
    }
    return cachedEmitter
}

function generateRequestId(): string {
    const g = globalThis as { crypto?: { randomUUID?: () => string } }
    if (typeof g.crypto?.randomUUID === 'function') {
        try {
            return g.crypto.randomUUID()
        } catch {
            // fall through
        }
    }
    return `asd_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 10)}`
}

function toFloat32(samples: unknown): Float32Array {
    if (samples instanceof Float32Array) return samples
    if (Array.isArray(samples)) {
        const out = new Float32Array(samples.length)
        for (let i = 0; i < samples.length; i++) {
            const v = Number(samples[i])
            out[i] = Number.isFinite(v) ? v : 0
        }
        return out
    }
    if (typeof samples === 'string') {
        const bytes = base64ToBytes(samples)
        const floatLength = Math.floor(bytes.byteLength / 4)
        if (bytes.byteOffset % 4 === 0) {
            return new Float32Array(bytes.buffer, bytes.byteOffset, floatLength)
        }
        const sliced = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
        )
        return new Float32Array(sliced, 0, Math.floor(sliced.byteLength / 4))
    }
    if (samples && typeof samples === 'object' && 'length' in samples) {
        // ArrayLike fallback
        const arr = samples as ArrayLike<number>
        const out = new Float32Array(arr.length)
        for (let i = 0; i < arr.length; i++) {
            const v = Number(arr[i])
            out[i] = Number.isFinite(v) ? v : 0
        }
        return out
    }
    return new Float32Array(0)
}

function base64ToBytes(input: string): Uint8Array {
    const g = globalThis as { atob?: (s: string) => string }
    if (typeof g.atob !== 'function') {
        // Buffer path for environments without atob; React Native has atob.
        const Buf = (
            globalThis as {
                Buffer?: {
                    from: (input: string, encoding: string) => Uint8Array
                }
            }
        ).Buffer
        if (Buf) return new Uint8Array(Buf.from(input, 'base64'))
        return new Uint8Array(0)
    }
    const bin = g.atob(input)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}

function rejectInvalidRange(message: string): never {
    throw new AudioStreamError({
        code: 'ERR_AUDIO_STREAM_INVALID_RANGE',
        message,
        recoverable: false,
    })
}

function assertPositiveFiniteOption(
    value: number | undefined,
    name: string,
    integer = false
): void {
    if (value === undefined) return
    if (
        !Number.isFinite(value) ||
        value <= 0 ||
        (integer && !Number.isInteger(value))
    ) {
        rejectInvalidRange(
            `${name} must be a positive${integer ? ' integer' : ''}`
        )
    }
}

function validateOptions(options: StreamAudioDataOptions): void {
    if (!options.fileUri) {
        rejectInvalidRange('fileUri is required')
    }
    if (
        options.startTimeMs !== undefined &&
        options.endTimeMs !== undefined &&
        options.startTimeMs >= options.endTimeMs
    ) {
        rejectInvalidRange('startTimeMs must be < endTimeMs')
    }
    if (options.endTimeMs !== undefined && options.endTimeMs <= 0) {
        rejectInvalidRange('endTimeMs must be > 0')
    }
    if (options.startTimeMs !== undefined && options.startTimeMs < 0) {
        rejectInvalidRange('startTimeMs must be >= 0')
    }
    if (
        options.chunkDurationMs !== undefined &&
        (options.chunkDurationMs < 10 || options.chunkDurationMs > 60000)
    ) {
        rejectInvalidRange('chunkDurationMs must be in [10, 60000]')
    }
    if (
        options.backpressureTimeoutMs !== undefined &&
        options.backpressureTimeoutMs < 0
    ) {
        rejectInvalidRange('backpressureTimeoutMs must be >= 0')
    }
    assertPositiveFiniteOption(options.targetSampleRate, 'targetSampleRate')
    assertPositiveFiniteOption(options.sampleRate, 'sampleRate')
    assertPositiveFiniteOption(options.channels, 'channels', true)
    assertPositiveFiniteOption(
        options.maxBufferedChunks,
        'maxBufferedChunks',
        true
    )
    assertPositiveFiniteOption(options.maxChunkBytes, 'maxChunkBytes', true)

    if (
        options.streamFormat !== undefined &&
        options.streamFormat !== 'float32'
    ) {
        throw new AudioStreamError({
            code: 'ERR_AUDIO_STREAM_UNSUPPORTED_FORMAT',
            message: `Unsupported streamFormat: ${options.streamFormat}`,
            recoverable: false,
        })
    }
}

/**
 * Stream decoded audio from a stored file as bounded Float32 PCM chunks.
 *
 * Memory bound:
 *   `chunkDurationMs * sampleRate * channels * 4 * maxBufferedChunks` +
 *   native decoder buffers.
 *
 * Cancellation: pass `options.signal` and call `abort()`. The returned promise
 * resolves with `cancelled: true` (it does not reject) when cancellation wins.
 *
 * Backpressure: if `onChunk` returns a Promise, native decode is paused until
 * it resolves; if it throws, the stream is aborted with a `decode_failed` error.
 */
export async function streamAudioData(
    options: StreamAudioDataOptions,
    callbacks: StreamAudioDataCallbacks
): Promise<StreamAudioDataResult> {
    validateOptions(options)

    if (isWeb) {
        return streamAudioDataWeb(options, callbacks)
    }

    return streamAudioDataNative(options, callbacks)
}

/** Discover what the running platform supports. */
export async function getAudioDecodeCapabilities(): Promise<AudioDecodeCapabilities> {
    if (isWeb) {
        return {
            platform: 'web',
            supportedInputFormats: [
                'audio/wav',
                'audio/mpeg',
                'audio/mp4',
                'audio/aac',
                'audio/ogg',
                'audio/webm',
            ],
            supportedOutputFormats: ['float32'],
            supportsCancellation: true,
            supportsBackpressure: true,
            supportsTimeRange: true,
            supportsTargetSampleRate: true,
            supportsChannelMixing: true,
            knownLimitations: [
                'Web decodes the entire file via AudioContext.decodeAudioData before chunking; very long files may exceed browser memory.',
            ],
        }
    }
    if (typeof AudioStudioModule.getAudioDecodeCapabilities === 'function') {
        try {
            const caps = await AudioStudioModule.getAudioDecodeCapabilities()
            return caps as AudioDecodeCapabilities
        } catch (err) {
            throw mapStreamError(err, undefined, 'native')
        }
    }
    throw new AudioStreamError({
        code: 'ERR_AUDIO_STREAM_NATIVE_UNAVAILABLE',
        message: 'getAudioDecodeCapabilities is not available on this build',
        recoverable: false,
    })
}

async function streamAudioDataNative(
    options: StreamAudioDataOptions,
    callbacks: StreamAudioDataCallbacks
): Promise<StreamAudioDataResult> {
    if (typeof AudioStudioModule.streamAudioData !== 'function') {
        throw new AudioStreamError({
            code: 'ERR_AUDIO_STREAM_NATIVE_UNAVAILABLE',
            message:
                'streamAudioData native method missing — rebuild the host app with the latest @siteed/audio-studio.',
            recoverable: false,
        })
    }

    const requestId = generateRequestId()
    const emitter = getEmitter()
    const subs: EventSubscription[] = []
    let chunkCount = 0
    let sampleCount = 0
    let processingChain: Promise<void> = Promise.resolve()
    let settled = false
    let abortListener: (() => void) | null = null
    let lastProgress: StreamAudioDataProgress | null = null

    const finalize = () => {
        for (const sub of subs) {
            try {
                sub.remove()
            } catch {
                /* noop */
            }
        }
        subs.length = 0
        if (abortListener && options.signal) {
            options.signal.removeEventListener('abort', abortListener)
        }
    }

    return new Promise<StreamAudioDataResult>((resolve, reject) => {
        const settle = (
            fn: () => void,
            mode: 'resolve' | 'reject',
            value: unknown
        ) => {
            if (settled) return
            settled = true
            finalize()
            fn()
            if (mode === 'resolve') {
                resolve(value as StreamAudioDataResult)
            } else {
                reject(value as Error)
            }
        }

        const handleError = (err: unknown) => {
            settle(
                () => {
                    try {
                        AudioStudioModule.cancelStreamAudioData?.(requestId)
                    } catch {
                        /* noop */
                    }
                },
                'reject',
                mapStreamError(err, options.fileUri, 'native')
            )
        }

        subs.push(
            emitter.addListener(CHUNK_EVENT, (raw: unknown) => {
                const evt = raw as {
                    requestId: string
                    chunkIndex: number
                    startTimeMs: number
                    endTimeMs: number
                    startSample: number
                    sampleCount: number
                    sampleRate: number
                    channels: number
                    samples: Float32Array | number[] | string
                    isFinal: boolean
                }
                if (evt.requestId !== requestId) return
                const chunk: StreamAudioDataChunk = {
                    requestId: evt.requestId,
                    chunkIndex: evt.chunkIndex,
                    startTimeMs: evt.startTimeMs,
                    endTimeMs: evt.endTimeMs,
                    durationMs: evt.endTimeMs - evt.startTimeMs,
                    startSample: evt.startSample,
                    sampleCount: evt.sampleCount,
                    sampleRate: evt.sampleRate,
                    channels: evt.channels,
                    samples: toFloat32(evt.samples),
                    isFinal: evt.isFinal,
                }
                chunkCount += 1
                sampleCount += chunk.sampleCount

                processingChain = processingChain
                    .then(async () => {
                        await callbacks.onChunk(chunk)
                        try {
                            AudioStudioModule.acknowledgeStreamAudioChunk?.(
                                requestId,
                                chunk.chunkIndex
                            )
                        } catch {
                            /* noop */
                        }
                    })
                    .catch(handleError)
            })
        )

        if (callbacks.onProgress) {
            subs.push(
                emitter.addListener(PROGRESS_EVENT, (raw: unknown) => {
                    const evt = raw as StreamAudioDataProgress
                    if (evt.requestId !== requestId) return
                    lastProgress = evt
                    callbacks.onProgress!(evt)
                })
            )
        }

        subs.push(
            emitter.addListener(COMPLETE_EVENT, (raw: unknown) => {
                const evt = raw as {
                    requestId: string
                    durationMs: number
                    sampleRate: number
                    channels: number
                    chunks?: number
                    samples?: number
                    cancelled: boolean
                }
                if (evt.requestId !== requestId) return
                // Wait for in-flight onChunk callbacks before resolving.
                processingChain
                    .then(() => {
                        settle(() => {}, 'resolve', {
                            requestId,
                            durationMs:
                                evt.durationMs > 0
                                    ? evt.durationMs
                                    : (lastProgress?.durationMs ?? 0),
                            sampleRate: evt.sampleRate,
                            channels: evt.channels,
                            chunks: evt.chunks ?? chunkCount,
                            samples: evt.samples ?? sampleCount,
                            cancelled: evt.cancelled,
                        } satisfies StreamAudioDataResult)
                    })
                    .catch(handleError)
            })
        )

        subs.push(
            emitter.addListener(ERROR_EVENT, (raw: unknown) => {
                const evt = raw as {
                    requestId: string
                    code?: string
                    message?: string
                    nativeMessage?: string
                }
                if (evt.requestId !== requestId) return
                if (evt.code === 'ERR_AUDIO_STREAM_CANCELLED') {
                    processingChain
                        .catch(() => {})
                        .then(() => {
                            settle(() => {}, 'resolve', {
                                requestId,
                                durationMs: lastProgress?.durationMs ?? 0,
                                sampleRate:
                                    options.targetSampleRate ??
                                    options.sampleRate ??
                                    0,
                                channels: options.channels ?? 1,
                                chunks: chunkCount,
                                samples: sampleCount,
                                cancelled: true,
                            } satisfies StreamAudioDataResult)
                        })
                    return
                }
                handleError(
                    new AudioStreamError({
                        code:
                            (evt.code as AudioStreamErrorCode) ??
                            'ERR_AUDIO_STREAM_UNKNOWN',
                        message: evt.message ?? 'native stream error',
                        nativeMessage: evt.nativeMessage,
                        fileUri: options.fileUri,
                        platform: 'native',
                        recoverable: false,
                    })
                )
            })
        )

        if (options.signal) {
            if (options.signal.aborted) {
                settle(() => {}, 'resolve', {
                    requestId,
                    durationMs: lastProgress?.durationMs ?? 0,
                    sampleRate:
                        options.targetSampleRate ?? options.sampleRate ?? 0,
                    channels: options.channels ?? 1,
                    chunks: 0,
                    samples: 0,
                    cancelled: true,
                } satisfies StreamAudioDataResult)
                return
            }
            abortListener = () => {
                try {
                    AudioStudioModule.cancelStreamAudioData?.(requestId)
                } catch {
                    /* noop */
                }
            }
            options.signal.addEventListener('abort', abortListener)
        }

        const { signal: _signal, ...nativeOptions } = options
        AudioStudioModule.streamAudioData({
            ...nativeOptions,
            requestId,
            streamFormat: options.streamFormat ?? 'float32',
            chunkDurationMs: options.chunkDurationMs ?? 1000,
            maxBufferedChunks: options.maxBufferedChunks ?? 4,
            normalizeAudio: options.normalizeAudio ?? true,
        }).catch(handleError)
    })
}

async function streamAudioDataWeb(
    options: StreamAudioDataOptions,
    callbacks: StreamAudioDataCallbacks
): Promise<StreamAudioDataResult> {
    const requestId = generateRequestId()
    const cancelled = () => options.signal?.aborted === true
    if (cancelled()) {
        return {
            requestId,
            durationMs: 0,
            sampleRate: options.targetSampleRate ?? options.sampleRate ?? 0,
            channels: options.channels ?? 1,
            chunks: 0,
            samples: 0,
            cancelled: true,
        }
    }

    try {
        const processed = await processAudioBuffer({
            fileUri: options.fileUri,
            targetSampleRate: options.targetSampleRate,
            targetChannels: options.channels ?? 1,
            normalizeAudio: options.normalizeAudio ?? true,
            startTimeMs: options.startTimeMs,
            endTimeMs: options.endTimeMs,
        })

        const sampleRate = processed.sampleRate
        const channels = processed.channels
        const durationMs = processed.durationMs
        const chunkDurationMs = options.chunkDurationMs ?? 1000
        let samplesPerChunk = Math.max(
            channels,
            Math.floor((chunkDurationMs / 1000) * sampleRate) * channels
        )
        if (options.maxChunkBytes) {
            // Round down to a multiple of `channels` so we never split an
            // interleaved frame across two chunks (that would produce a
            // fractional `startSample` for the next chunk).
            const rawMax = Math.floor(options.maxChunkBytes / 4)
            const maxSamples = Math.max(
                channels,
                Math.floor(rawMax / channels) * channels
            )
            samplesPerChunk = Math.max(
                channels,
                Math.min(samplesPerChunk, maxSamples)
            )
        }

        const all = sanitizeFloat32(
            interleaveBuffer(processed.buffer, channels),
            options.normalizeAudio ?? true
        )

        // Chunk timestamps are absolute (range start + offset) on every
        // platform; progress is *elapsed within the range* so the
        // `processedMs / durationMs` fraction stays in [0, 1] regardless of
        // `startTimeMs`. The native decoders use the same split.
        const rangeStartMs = options.startTimeMs ?? 0
        let chunkIndex = 0
        let emittedSamples = 0
        for (let off = 0; off < all.length; off += samplesPerChunk) {
            if (cancelled()) {
                return {
                    requestId,
                    durationMs,
                    sampleRate,
                    channels,
                    chunks: chunkIndex,
                    samples: emittedSamples,
                    cancelled: true,
                }
            }
            const end = Math.min(off + samplesPerChunk, all.length)
            const slice = all.slice(off, end)
            const startSample = off / channels
            const endSample = end / channels
            const startMs =
                Math.round((startSample / sampleRate) * 1000) + rangeStartMs
            const endMs =
                Math.round((endSample / sampleRate) * 1000) + rangeStartMs
            const chunk: StreamAudioDataChunk = {
                requestId,
                chunkIndex,
                startTimeMs: startMs,
                endTimeMs: endMs,
                durationMs: Math.round(
                    ((endSample - startSample) / sampleRate) * 1000
                ),
                startSample,
                sampleCount: slice.length,
                sampleRate,
                channels,
                samples: slice,
                isFinal: end >= all.length,
            }
            await callbacks.onChunk(chunk)
            // Resample rounding (Math.ceil in processAudioBuffer) can push
            // elapsed past the source-rate-derived range duration on the tail
            // chunk. Cap so onProgress consumers always see a [0, 1] ratio,
            // matching the native `coerceIn(0, 1)` / `min(1, max(0, …))`
            // clamp.
            const rawElapsedMs = Math.round((endSample / sampleRate) * 1000)
            const elapsedMs =
                durationMs > 0
                    ? Math.min(rawElapsedMs, durationMs)
                    : rawElapsedMs
            callbacks.onProgress?.({
                requestId,
                processedMs: elapsedMs,
                durationMs,
                progress:
                    durationMs > 0
                        ? Math.min(1, Math.max(0, elapsedMs / durationMs))
                        : 1,
                emittedChunks: chunkIndex + 1,
            })
            chunkIndex += 1
            emittedSamples += slice.length
        }

        return {
            requestId,
            durationMs,
            sampleRate,
            channels,
            chunks: chunkIndex,
            samples: emittedSamples,
            cancelled: false,
        }
    } catch (err) {
        throw mapStreamError(err, options.fileUri, 'web')
    }
}

function interleaveBuffer(buffer: AudioBuffer, channels: number): Float32Array {
    const numCh = Math.max(1, Math.min(channels, buffer.numberOfChannels))
    const framesPerCh = buffer.length
    if (numCh === 1) {
        // Cheap path: clone channel 0 so downstream mutation doesn't touch the
        // underlying AudioBuffer storage.
        return new Float32Array(buffer.getChannelData(0))
    }
    const out = new Float32Array(framesPerCh * numCh)
    const channelData: Float32Array[] = []
    for (let c = 0; c < numCh; c++) {
        channelData.push(buffer.getChannelData(c))
    }
    for (let f = 0; f < framesPerCh; f++) {
        for (let c = 0; c < numCh; c++) {
            out[f * numCh + c] = channelData[c][f]
        }
    }
    return out
}

function sanitizeFloat32(input: Float32Array, clamp: boolean): Float32Array {
    if (!clamp) {
        // still need NaN/Inf sanitation
        for (let i = 0; i < input.length; i++) {
            const v = input[i]
            if (!Number.isFinite(v)) input[i] = 0
        }
        return input
    }
    for (let i = 0; i < input.length; i++) {
        const v = input[i]
        if (!Number.isFinite(v)) {
            input[i] = 0
        } else if (v > 1) {
            input[i] = 1
        } else if (v < -1) {
            input[i] = -1
        }
    }
    return input
}
