import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Canvas, Rect } from '@shopify/react-native-skia'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'

import { extractAudioData } from '@siteed/audio-studio'
import { VAD } from '@siteed/sherpa-onnx.rn'

import { baseLogger } from '../config'

const logger = baseLogger.extend('VADViewer')

export interface VADViewerProps {
    fileUri: string | null
    durationMs: number
    width: number
    height?: number
    /** Sample rate the VAD model expects. Silero v5 is 16 kHz. */
    sampleRate?: number
    /** Probability threshold the native VAD uses for speech classification. */
    threshold?: number
    voiceColor?: string
    backgroundColor?: string
    testID?: string
}

interface VADProbeState {
    status: 'idle' | 'loading-model' | 'extracting' | 'analyzing' | 'ready' | 'error'
    voiceMs: number
    segmentCount: number
    elapsedMs: number | null
    error: string | null
}

interface VoiceSegment {
    startMs: number
    endMs: number
}

let modelInitOnce: Promise<void> | null = null

async function ensureVadInitialized(threshold: number) {
    if (modelInitOnce) return modelInitOnce
    modelInitOnce = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const [asset] = await Asset.loadAsync(require('@assets/silero_vad_v5.onnx'))
        await asset.downloadAsync()
        const resolvedUri = asset.localUri ?? asset.uri
        if (!resolvedUri) {
            throw new Error('VAD asset did not resolve')
        }

        let fileUri = resolvedUri
        if (Platform.OS !== 'web' && !fileUri.startsWith('file://')) {
            const targetUri = `${FileSystem.cacheDirectory}silero_vad_v5.onnx`
            await FileSystem.downloadAsync(fileUri, targetUri)
            fileUri = targetUri
        }
        const path = fileUri.startsWith('file://') ? fileUri.substring(7) : fileUri
        const lastSlash = path.lastIndexOf('/')
        if (lastSlash < 0) {
            throw new Error(`VAD asset path invalid: ${path}`)
        }
        const modelDir = path.substring(0, lastSlash)
        const modelFile = path.substring(lastSlash + 1)

        const result = await VAD.init({ modelDir, modelFile, threshold })
        if (!result.success) {
            modelInitOnce = null
            throw new Error(result.error || 'VAD init failed')
        }
        logger.info('Silero VAD initialized', { modelDir, modelFile, threshold })
    })()
    return modelInitOnce
}

function pcmToFloat32(bytes: Uint8Array, bitDepth: number): Float32Array {
    if (bitDepth === 16) {
        const view = new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength,
        )
        const samples = bytes.byteLength / 2
        const out = new Float32Array(samples)
        for (let i = 0; i < samples; i++) {
            const v = view.getInt16(i * 2, true)
            out[i] = v / 32768
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
        const view = new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength,
        )
        const samples = bytes.byteLength / 4
        const out = new Float32Array(samples)
        for (let i = 0; i < samples; i++) {
            out[i] = view.getFloat32(i * 4, true)
        }
        return out
    }
    throw new Error(`Unsupported bit depth: ${bitDepth}`)
}

export function VADViewer({
    fileUri,
    durationMs,
    width,
    height = 16,
    sampleRate = 16000,
    threshold = 0.5,
    voiceColor = '#10B981',
    backgroundColor = 'rgba(16,185,129,0.08)',
    testID = 'vad-viewer',
}: VADViewerProps) {
    const [state, setState] = useState<VADProbeState>({
        status: 'idle',
        voiceMs: 0,
        segmentCount: 0,
        elapsedMs: null,
        error: null,
    })
    const [segments, setSegments] = useState<VoiceSegment[]>([])
    const runIdRef = useRef(0)

    const analyze = useCallback(async () => {
        if (!fileUri || durationMs <= 0) return
        const runId = ++runIdRef.current
        const startedAt = Date.now()
        setSegments([])
        setState({
            status: 'loading-model',
            voiceMs: 0,
            segmentCount: 0,
            elapsedMs: null,
            error: null,
        })

        try {
            await ensureVadInitialized(threshold)
            await VAD.reset()

            if (runId !== runIdRef.current) return
            setState((s) => ({ ...s, status: 'extracting' }))

            // Native extractAudioData requires an explicit range. Trim a small
            // tail so the byte-range conversion never overshoots the file end.
            const safeEnd = Math.max(500, durationMs - 250)
            const audio = await extractAudioData({
                fileUri,
                startTimeMs: 0,
                endTimeMs: safeEnd,
                decodingOptions: {
                    targetSampleRate: sampleRate,
                    targetChannels: 1,
                    targetBitDepth: 16,
                },
            })
            if (runId !== runIdRef.current) return

            const bytes = audio.pcmData as Uint8Array
            const samples = pcmToFloat32(bytes, audio.bitDepth ?? 16)

            setState((s) => ({ ...s, status: 'analyzing' }))

            const collected: VoiceSegment[] = []
            const chunkSize = 4096
            for (let i = 0; i < samples.length; i += chunkSize) {
                if (runId !== runIdRef.current) return
                const slice = samples.subarray(i, Math.min(i + chunkSize, samples.length))
                const result = await VAD.acceptWaveform(sampleRate, Array.from(slice))
                if (!result.success) {
                    throw new Error(result.error || 'VAD acceptWaveform failed')
                }
                for (const seg of result.segments) {
                    collected.push({
                        startMs: seg.startTime * 1000,
                        endMs: seg.endTime * 1000,
                    })
                }
            }

            if (runId !== runIdRef.current) return

            const totalVoiceMs = collected.reduce(
                (acc, s) => acc + (s.endMs - s.startMs),
                0,
            )
            setSegments(collected)
            setState({
                status: 'ready',
                voiceMs: totalVoiceMs,
                segmentCount: collected.length,
                elapsedMs: Date.now() - startedAt,
                error: null,
            })
        } catch (e) {
            if (runId !== runIdRef.current) return
            const message = e instanceof Error ? e.message : String(e)
            logger.error('VAD analyze failed', message)
            setSegments([])
            setState({
                status: 'error',
                voiceMs: 0,
                segmentCount: 0,
                elapsedMs: Date.now() - startedAt,
                error: message,
            })
        }
    }, [fileUri, durationMs, sampleRate, threshold])

    useEffect(() => {
        void analyze()
    }, [analyze])

    const bands = useMemo(() => {
        if (durationMs <= 0 || width <= 0) return []
        return segments.map((s) => {
            const x = (s.startMs / durationMs) * width
            const w = Math.max(2, ((s.endMs - s.startMs) / durationMs) * width)
            return { x, width: w }
        })
    }, [segments, durationMs, width])

    const statusLabel = useMemo(() => {
        switch (state.status) {
            case 'idle':
                return 'Idle'
            case 'loading-model':
                return 'Loading Silero VAD model…'
            case 'extracting':
                return 'Decoding PCM…'
            case 'analyzing':
                return 'Running Silero VAD…'
            case 'ready':
                return `${state.segmentCount} voice segment(s) · ${(state.voiceMs / 1000).toFixed(1)}s of speech · ${state.elapsedMs ?? '?'}ms`
            case 'error':
                return `Error: ${state.error}`
        }
    }, [state])

    return (
        <View style={[styles.wrap, { width }]} testID={testID}>
            <View style={styles.header}>
                <Text variant="labelMedium" testID={`${testID}-status`}>
                    Silero VAD
                </Text>
                <Text style={styles.statusText} testID={`${testID}-status-text`}>
                    {statusLabel}
                </Text>
            </View>
            <View
                style={[
                    styles.canvasWrap,
                    { width, height, backgroundColor },
                ]}
            >
                <Canvas style={{ width, height }}>
                    {bands.map((b, i) => (
                        <Rect
                            key={i}
                            x={b.x}
                            y={0}
                            width={b.width}
                            height={height}
                            color={voiceColor}
                        />
                    ))}
                </Canvas>
                {state.status === 'loading-model' ||
                state.status === 'extracting' ||
                state.status === 'analyzing' ? (
                    <View style={styles.spinner}>
                        <ActivityIndicator size="small" color={voiceColor} />
                    </View>
                ) : null}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    wrap: {
        gap: 4,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    statusText: {
        fontSize: 12,
        opacity: 0.7,
    },
    canvasWrap: {
        position: 'relative',
        borderRadius: 4,
        overflow: 'hidden',
    },
    spinner: {
        position: 'absolute',
        right: 6,
        top: 0,
        bottom: 0,
        justifyContent: 'center',
    },
})
