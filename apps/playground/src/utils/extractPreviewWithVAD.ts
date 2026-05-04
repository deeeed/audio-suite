import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'

import {
    extractAudioData,
    extractPreview,
    type AudioAnalysis,
    type DataPoint,
    type PreviewOptions,
} from '@siteed/audio-studio'
import { VAD } from '@siteed/sherpa-onnx.rn'

import { baseLogger } from '../config'

const logger = baseLogger.extend('extractPreviewWithVAD')

export interface VoiceSegment {
    startMs: number
    endMs: number
}

export interface ExtractPreviewWithVADOptions
    extends Omit<PreviewOptions, 'onPointReady'> {
    /**
     * Optional override for the underlying preview's `onPointReady`. Same
     * signature as `extractPreview` — fired as bars stream in (before VAD).
     */
    onPointReady?: PreviewOptions['onPointReady']
    /**
     * Notification callback for the slow side: VAD model load and inference.
     * Useful for spinners since VAD adds ~hundreds of ms after extraction.
     */
    onVadStatus?: (status: VadStatus) => void
    /** Silero probability threshold. Default 0.5 — Silero's recommended value. */
    vadThreshold?: number
    /** PCM sample rate fed to Silero. Default 16000 (Silero v5 native rate). */
    vadSampleRate?: number
    /**
     * If true, skip VAD entirely and return `voiceMask` empty / `voiceSegments` empty.
     * Lets callers degrade gracefully (e.g. on web) without changing call sites.
     */
    skipVad?: boolean
}

export type VadStatus =
    | { phase: 'idle' }
    | { phase: 'loading-model' }
    | { phase: 'extracting-pcm' }
    | { phase: 'running-vad' }
    | { phase: 'done'; segmentCount: number; voiceMs: number; elapsedMs: number }
    | { phase: 'error'; error: string }

export interface ExtractPreviewWithVADResult {
    analysis: AudioAnalysis
    voiceSegments: VoiceSegment[]
    /**
     * One boolean per `analysis.dataPoints[i]` — true if any Silero voice
     * segment overlaps that bar's time window. When `skipVad` was set or VAD
     * failed, this is an empty array.
     */
    voiceMask: boolean[]
    voiceMs: number
}

let modelInitOnce: Promise<void> | null = null
let lastInitThreshold: number | null = null

async function ensureVadInitialized(threshold: number) {
    if (modelInitOnce && lastInitThreshold === threshold) return modelInitOnce
    if (modelInitOnce && lastInitThreshold !== threshold) {
        // Threshold changed — release and re-init.
        try {
            await VAD.release()
        } catch {
            // ignore
        }
        modelInitOnce = null
    }
    modelInitOnce = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const [asset] = await Asset.loadAsync(require('@assets/silero_vad_v5.onnx'))
        await asset.downloadAsync()
        const resolvedUri = asset.localUri ?? asset.uri
        if (!resolvedUri) throw new Error('Silero VAD asset did not resolve')

        let fileUri = resolvedUri
        if (Platform.OS !== 'web' && !fileUri.startsWith('file://')) {
            const targetUri = `${FileSystem.cacheDirectory}silero_vad_v5.onnx`
            await FileSystem.downloadAsync(fileUri, targetUri)
            fileUri = targetUri
        }
        const path = fileUri.startsWith('file://') ? fileUri.substring(7) : fileUri
        const lastSlash = path.lastIndexOf('/')
        if (lastSlash < 0) throw new Error(`Silero asset path invalid: ${path}`)
        const modelDir = path.substring(0, lastSlash)
        const modelFile = path.substring(lastSlash + 1)
        const result = await VAD.init({ modelDir, modelFile, threshold })
        if (!result.success) {
            modelInitOnce = null
            throw new Error(result.error || 'VAD init failed')
        }
        lastInitThreshold = threshold
        logger.info('Silero VAD ready', { modelDir, threshold })
    })()
    return modelInitOnce
}

function pcmToFloat32(bytes: Uint8Array, bitDepth: number): Float32Array {
    if (bitDepth === 16) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const samples = bytes.byteLength / 2
        const out = new Float32Array(samples)
        for (let i = 0; i < samples; i++) {
            out[i] = view.getInt16(i * 2, true) / 32768
        }
        return out
    }
    if (bitDepth === 8) {
        const out = new Float32Array(bytes.byteLength)
        for (let i = 0; i < bytes.byteLength; i++) {
            out[i] = (bytes[i]! - 128) / 128
        }
        return out
    }
    if (bitDepth === 32) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const samples = bytes.byteLength / 4
        const out = new Float32Array(samples)
        for (let i = 0; i < samples; i++) {
            out[i] = view.getFloat32(i * 4, true)
        }
        return out
    }
    throw new Error(`Unsupported bit depth: ${bitDepth}`)
}

function buildVoiceMask(
    dataPoints: DataPoint[],
    segments: VoiceSegment[],
): boolean[] {
    const n = dataPoints.length
    if (n === 0 || segments.length === 0) return new Array(n).fill(false)
    const mask = new Array<boolean>(n).fill(false)
    for (let i = 0; i < n; i++) {
        const dp = dataPoints[i]!
        const start = (dp.startTime ?? 0) * 1000
        const end = (dp.endTime ?? start) * 1000
        for (const s of segments) {
            if (s.endMs <= start) continue
            if (s.startMs >= end) break
            mask[i] = true
            break
        }
    }
    return mask
}

/**
 * Run `extractPreview` and Silero VAD over the same file, returning the
 * usual analysis plus a per-bar voice mask. The combined call hides the
 * VAD plumbing from callers and degrades to extraction-only on web (which
 * doesn't ship the Silero model in this repo today).
 *
 * Lives in the playground because it bridges two domain packages
 * (`@siteed/audio-studio` for extraction, `@siteed/sherpa-onnx.rn` for
 * Silero). Promote into a shared package once a second consumer needs it.
 */
export async function extractPreviewWithVAD(
    options: ExtractPreviewWithVADOptions,
): Promise<ExtractPreviewWithVADResult> {
    const {
        onVadStatus,
        vadThreshold = 0.5,
        vadSampleRate = 16000,
        skipVad = false,
        onPointReady,
        ...previewOptions
    } = options

    onVadStatus?.({ phase: 'idle' })

    const analysis = await extractPreview({
        ...previewOptions,
        onPointReady,
    })

    if (skipVad) {
        onVadStatus?.({
            phase: 'done',
            segmentCount: 0,
            voiceMs: 0,
            elapsedMs: 0,
        })
        return {
            analysis,
            voiceSegments: [],
            voiceMask: [],
            voiceMs: 0,
        }
    }

    const startedAt = Date.now()
    try {
        onVadStatus?.({ phase: 'loading-model' })
        await ensureVadInitialized(vadThreshold)
        await VAD.reset()

        onVadStatus?.({ phase: 'extracting-pcm' })
        const safeEnd =
            'endTimeMs' in previewOptions && previewOptions.endTimeMs
                ? previewOptions.endTimeMs
                : Math.max(500, analysis.durationMs - 250)

        const audio = await extractAudioData({
            fileUri: previewOptions.fileUri,
            startTimeMs: previewOptions.startTimeMs ?? 0,
            endTimeMs: safeEnd,
            decodingOptions: {
                targetSampleRate: vadSampleRate,
                targetChannels: 1,
                targetBitDepth: 16,
            },
        })

        const pcm = pcmToFloat32(audio.pcmData as Uint8Array, audio.bitDepth ?? 16)

        onVadStatus?.({ phase: 'running-vad' })
        const segments: VoiceSegment[] = []
        const chunkSize = 4096
        for (let i = 0; i < pcm.length; i += chunkSize) {
            const slice = pcm.subarray(i, Math.min(i + chunkSize, pcm.length))
            const result = await VAD.acceptWaveform(vadSampleRate, Array.from(slice))
            if (!result.success) {
                throw new Error(result.error || 'VAD acceptWaveform failed')
            }
            for (const seg of result.segments) {
                segments.push({
                    startMs: seg.startTime * 1000,
                    endMs: seg.endTime * 1000,
                })
            }
        }

        const voiceMask = buildVoiceMask(analysis.dataPoints, segments)
        const voiceMs = segments.reduce((acc, s) => acc + (s.endMs - s.startMs), 0)
        const elapsedMs = Date.now() - startedAt
        onVadStatus?.({
            phase: 'done',
            segmentCount: segments.length,
            voiceMs,
            elapsedMs,
        })
        return {
            analysis,
            voiceSegments: segments,
            voiceMask,
            voiceMs,
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('VAD pipeline failed', message)
        onVadStatus?.({ phase: 'error', error: message })
        return {
            analysis,
            voiceSegments: [],
            voiceMask: [],
            voiceMs: 0,
        }
    }
}
