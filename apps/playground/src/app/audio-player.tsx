import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import * as DocumentPicker from 'expo-document-picker'
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Button, Text } from 'react-native-paper'

import {
    AudioExtractionError,
    type AudioAnalysis,
    type DataPoint,
} from '@siteed/audio-studio'
import { Canvas } from '@shopify/react-native-skia'
import {
    AudioPlayerWidget,
    Waveform,
    type WaveformAmplitudeScale,
} from '@siteed/audio-ui'
import { Notice, useToast } from '@siteed/design-system'

import { baseLogger } from '../config'
import { useAudioPlayback } from '../hooks/useAudioPlayback'
import {
    extractPreviewWithVAD,
    type VadStatus,
    type VoiceSegment,
} from '../utils/extractPreviewWithVAD'
import { useSampleAudio } from '../hooks/useSampleAudio'
import { useScreenHeader } from '../hooks/useScreenHeader'
import {
    setAgenticAudioPlayerProbe,
    type AgenticAudioPlayerProbe,
} from '../agentic-bridge'

const logger = baseLogger.extend('AudioPlayerScreen')

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SAMPLE_ASSET = require('@assets/jfk.mp3')

const MIN_POINTS = 100
const MAX_POINTS = 500

interface ExtractionState {
    pointsReceived: number
    totalPoints: number
    isStreaming: boolean
    silentSegmentCount: number
    threshold: number
    elapsedMs: number | null
    lastError: { code: string; message: string; nativeMessage?: string } | null
}

export default function AudioPlayerScreen() {
    const { width: windowWidth } = useWindowDimensions()
    const widgetWidth = Math.min(560, Math.max(280, Math.floor(windowWidth - 32)))

    const numberOfPoints = Math.min(
        MAX_POINTS,
        Math.max(MIN_POINTS, Math.floor(widgetWidth)),
    )

    const [dataPoints, setDataPoints] = useState<DataPoint[]>([])
    const [fullAnalysis, setFullAnalysis] = useState<AudioAnalysis | null>(null)
    const [showSilenceTrack, setShowSilenceTrack] = useState(false)
    const [threshold, setThreshold] = useState(0.01)
    const [amplitudeScale, setAmplitudeScale] =
        useState<WaveformAmplitudeScale>('sqrt')
    const [voiceMask, setVoiceMask] = useState<boolean[]>([])
    const [voiceSegments, setVoiceSegments] = useState<VoiceSegment[]>([])
    const [vadStatus, setVadStatus] = useState<VadStatus>({ phase: 'idle' })
    const [extraction, setExtraction] = useState<ExtractionState>({
        pointsReceived: 0,
        totalPoints: 0,
        isStreaming: false,
        silentSegmentCount: 0,
        threshold: 0.01,
        elapsedMs: null,
        lastError: null,
    })
    const [activeUri, setActiveUri] = useState<string | null>(null)

    const controller = useAudioPlayback()
    const { show } = useToast()
    const { isLoading: isSampleLoading, loadSampleAudio } = useSampleAudio({
        onError: (e) => {
            logger.error('sample load error', e)
            show({ type: 'error', message: 'Failed to load sample audio' })
        },
    })

    useScreenHeader({
        title: 'Audio Player',
        backBehavior: { fallbackUrl: '/more' },
    })

    const extractCounterRef = useRef(0)
    const lastExtractedRef = useRef<{
        uri: string | null
        durationMs: number
        threshold: number
    }>({ uri: null, durationMs: 0, threshold: -1 })

    const runExtraction = useCallback(
        async (
            fileUri: string,
            opts: { silenceThreshold: number; endTimeMs: number },
        ) => {
            const requestId = ++extractCounterRef.current
            const startedAt = Date.now()

            setDataPoints([])
            setFullAnalysis(null)
            setVoiceMask([])
            setVoiceSegments([])
            setVadStatus({ phase: 'idle' })
            setExtraction({
                pointsReceived: 0,
                totalPoints: 0,
                isStreaming: true,
                silentSegmentCount: 0,
                threshold: opts.silenceThreshold,
                elapsedMs: null,
                lastError: null,
            })

            const incoming: DataPoint[] = []
            try {
                const result = await extractPreviewWithVAD({
                    fileUri,
                    numberOfPoints,
                    startTimeMs: 0,
                    endTimeMs: opts.endTimeMs,
                    decodingOptions: { silenceRmsThreshold: opts.silenceThreshold },
                    onPointReady: (point, _index, total) => {
                        if (requestId !== extractCounterRef.current) return
                        incoming.push(point)
                        const snapshot = incoming.slice()
                        setDataPoints(snapshot)
                        setExtraction((prev) => ({
                            ...prev,
                            pointsReceived: snapshot.length,
                            totalPoints: total,
                            silentSegmentCount: snapshot.filter((p) => p.silent).length,
                            isStreaming: snapshot.length < total,
                        }))
                    },
                    onVadStatus: (status) => {
                        if (requestId !== extractCounterRef.current) return
                        setVadStatus(status)
                    },
                })
                if (requestId !== extractCounterRef.current) return
                setFullAnalysis(result.analysis)
                setVoiceMask(result.voiceMask)
                setVoiceSegments(result.voiceSegments)
                setExtraction((prev) => ({
                    ...prev,
                    isStreaming: false,
                    elapsedMs: Date.now() - startedAt,
                    lastError: null,
                }))
            } catch (err) {
                if (requestId !== extractCounterRef.current) return
                const isAudio = err instanceof AudioExtractionError
                const code = isAudio ? err.code : 'unknown'
                const message = err instanceof Error ? err.message : String(err)
                const nativeMessage = isAudio ? err.nativeMessage : undefined
                logger.error('extractPreview failed', { code, message })
                setDataPoints([])
                setFullAnalysis(null)
                setVoiceMask([])
                setVoiceSegments([])
                setVadStatus({ phase: 'error', error: message })
                setExtraction((prev) => ({
                    ...prev,
                    isStreaming: false,
                    elapsedMs: Date.now() - startedAt,
                    lastError: { code, message, nativeMessage },
                }))
            }
        },
        [numberOfPoints],
    )

    // Drive extraction off (uri, durationMs, threshold). Waits for expo-audio to
    // report duration so endTimeMs never overshoots the file (causes native NIL).
    useEffect(() => {
        if (!activeUri) return
        if (controller.durationMs <= 0) return
        const last = lastExtractedRef.current
        if (
            last.uri === activeUri &&
            last.durationMs === controller.durationMs &&
            last.threshold === threshold
        ) {
            return
        }
        lastExtractedRef.current = {
            uri: activeUri,
            durationMs: controller.durationMs,
            threshold,
        }
        // Leave a small margin: iOS native reads effectiveLength in bytes and
        // rejects when the requested range lands exactly at file end.
        const safeEnd = Math.max(500, controller.durationMs - 250)
        void runExtraction(activeUri, {
            silenceThreshold: threshold,
            endTimeMs: safeEnd,
        })
    }, [activeUri, controller.durationMs, threshold, runExtraction])

    // For an obviously-bad URI (e.g. the negative-test bogus path) expo-audio
    // never reports a duration, so we still need to surface the extraction
    // error code without waiting on the controller.
    useEffect(() => {
        if (!activeUri) return
        if (controller.durationMs > 0) return
        let cancelled = false
        const t = setTimeout(() => {
            if (cancelled) return
            const last = lastExtractedRef.current
            if (last.uri === activeUri && last.durationMs > 0) return
            lastExtractedRef.current = {
                uri: activeUri,
                durationMs: -1,
                threshold,
            }
            void runExtraction(activeUri, {
                silenceThreshold: threshold,
                endTimeMs: 10_000,
            })
        }, 1500)
        return () => {
            cancelled = true
            clearTimeout(t)
        }
    }, [activeUri, controller.durationMs, threshold, runExtraction])

    const loadSample = useCallback(async () => {
        try {
            const sampleFile = await loadSampleAudio(SAMPLE_ASSET)
            if (!sampleFile?.uri) return
            controller.load(sampleFile.uri)
            setActiveUri(sampleFile.uri)
        } catch (e) {
            logger.error('loadSample failed', e)
        }
    }, [controller, loadSampleAudio])

    const loadFromUri = useCallback(
        (uri: string) => {
            controller.load(uri)
            setActiveUri(uri)
        },
        [controller],
    )

    const pickFile = useCallback(async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ['audio/*'],
                copyToCacheDirectory: true,
            })
            if (result.canceled) return
            const asset = result.assets[0]
            if (!asset?.uri) return
            loadFromUri(asset.uri)
        } catch (e) {
            logger.error('pickFile failed', e)
        }
    }, [loadFromUri])

    const updateThreshold = useCallback((next: number) => {
        const clamped = Math.max(0, Math.min(1, next))
        setThreshold(clamped)
    }, [])

    // Snapshot refs so the agentic probe always reads the latest values
    // without re-binding the probe object every render (which would create a
    // brief null-probe window during cleanup → re-register).
    const stateRef = useRef({
        extraction,
        controller,
        activeUri,
        showSilenceTrack,
        dataPoints,
        voiceMask,
        voiceSegments,
        vadStatus,
    })
    stateRef.current = {
        extraction,
        controller,
        activeUri,
        showSilenceTrack,
        dataPoints,
        voiceMask,
        voiceSegments,
        vadStatus,
    }

    const actionsRef = useRef({
        loadSample,
        loadFromUri,
        updateThreshold,
        setShowSilenceTrack,
    })
    actionsRef.current = {
        loadSample,
        loadFromUri,
        updateThreshold,
        setShowSilenceTrack,
    }

    useEffect(() => {
        const probe: AgenticAudioPlayerProbe = {
            getState: () => {
                const snap = stateRef.current
                const voiced = snap.voiceMask.filter((v) => v).length
                const vadPhase = snap.vadStatus.phase
                const vadSegmentCount =
                    snap.vadStatus.phase === 'done'
                        ? snap.vadStatus.segmentCount
                        : snap.voiceSegments.length
                const vadVoiceMs =
                    snap.vadStatus.phase === 'done' ? snap.vadStatus.voiceMs : 0
                return {
                    pointsReceived: snap.extraction.pointsReceived,
                    totalPoints: snap.extraction.totalPoints,
                    isStreaming: snap.extraction.isStreaming,
                    durationMs: snap.controller.durationMs,
                    currentTimeMs: snap.controller.currentTimeMs,
                    isPlaying: snap.controller.isPlaying,
                    isLoaded: snap.controller.isLoaded,
                    silentSegmentCount: snap.extraction.silentSegmentCount,
                    threshold: snap.extraction.threshold,
                    elapsedMs: snap.extraction.elapsedMs,
                    fileUri: snap.activeUri,
                    showSilenceTrack: snap.showSilenceTrack,
                    lastError: snap.extraction.lastError,
                    vadPhase,
                    vadSegmentCount,
                    vadVoiceMs,
                    voiceMaskLength: snap.voiceMask.length,
                    voicedBarCount: voiced,
                }
            },
            getDataPointsSample: (count?: number) => {
                const points = stateRef.current.dataPoints
                const total = points.length
                if (total === 0) {
                    return {
                        ok: true,
                        total: 0,
                        amplitudeMin: 0,
                        amplitudeMax: 0,
                        rmsMin: 0,
                        rmsMax: 0,
                        sample: [],
                    }
                }
                let aMin = Infinity
                let aMax = -Infinity
                let rMin = Infinity
                let rMax = -Infinity
                for (const p of points) {
                    if (p.amplitude < aMin) aMin = p.amplitude
                    if (p.amplitude > aMax) aMax = p.amplitude
                    if (p.rms < rMin) rMin = p.rms
                    if (p.rms > rMax) rMax = p.rms
                }
                const sampleSize = Math.max(1, Math.min(total, count ?? 16))
                const stride = total / sampleSize
                const sample = Array.from({ length: sampleSize }, (_, k) => {
                    const i = Math.min(total - 1, Math.floor(k * stride))
                    const p = points[i]!
                    return {
                        i,
                        amplitude: p.amplitude,
                        rms: p.rms,
                        dB: p.dB,
                        silent: p.silent,
                    }
                })
                return {
                    ok: true,
                    total,
                    amplitudeMin: aMin,
                    amplitudeMax: aMax,
                    rmsMin: rMin,
                    rmsMax: rMax,
                    sample,
                }
            },
            loadSample: () => {
                void actionsRef.current.loadSample()
                return { ok: true }
            },
            loadFromUri: (uri: string) => {
                actionsRef.current.loadFromUri(uri)
                return { ok: true, uri }
            },
            setThreshold: (value: number) => {
                actionsRef.current.updateThreshold(value)
                return { ok: true, value }
            },
            setShowSilenceTrack: (value: boolean) => {
                actionsRef.current.setShowSilenceTrack(Boolean(value))
                return { ok: true, value: Boolean(value) }
            },
            play: () => {
                stateRef.current.controller.play()
                return { ok: true }
            },
            pause: () => {
                stateRef.current.controller.pause()
                return { ok: true }
            },
            toggle: () => {
                stateRef.current.controller.toggle()
                return { ok: true }
            },
            seekTo: (timeMs: number) => {
                stateRef.current.controller.seek(Number(timeMs))
                return { ok: true, timeMs: Number(timeMs) }
            },
        }
        setAgenticAudioPlayerProbe(probe)
        return () => setAgenticAudioPlayerProbe(null)
    }, [])

    const status = useMemo(() => {
        if (extraction.lastError) {
            return `Error: ${extraction.lastError.code} — ${extraction.lastError.message}`
        }
        if (extraction.isStreaming) {
            return `Streaming ${extraction.pointsReceived}/${extraction.totalPoints} points…`
        }
        if (extraction.totalPoints > 0) {
            return `Ready · ${extraction.totalPoints} points · ${extraction.silentSegmentCount} silent · ${extraction.elapsedMs ?? '?'}ms`
        }
        return 'No audio loaded'
    }, [extraction])

    return (
        <ScrollView contentContainerStyle={styles.container} testID="audio-player-screen">
            <Notice
                type="info"
                title="Audio Player Widget"
                message="Compact audio player with bar-style waveform and silence track. Driven by the controlled AudioPlayerWidget."
            />

            <View style={styles.controlsRow}>
                <Button
                    mode="contained"
                    onPress={loadSample}
                    icon="music-box"
                    loading={isSampleLoading}
                    testID="audio-player-load-sample"
                    style={styles.flexBtn}
                >
                    Load Sample
                </Button>
                <Button
                    mode="contained-tonal"
                    onPress={pickFile}
                    icon="file-upload"
                    testID="audio-player-pick-file"
                >
                    Pick File
                </Button>
            </View>

            <View style={styles.controlsRow}>
                <Button
                    mode={showSilenceTrack ? 'contained' : 'outlined'}
                    onPress={() => setShowSilenceTrack((v) => !v)}
                    icon={showSilenceTrack ? 'eye' : 'eye-off'}
                    testID="audio-player-toggle-silence"
                    style={styles.flexBtn}
                >
                    {showSilenceTrack ? 'Silence ON' : 'Silence OFF'}
                </Button>
            </View>

            <View style={styles.controlsRow}>
                <Button
                    mode="outlined"
                    onPress={() => updateThreshold(0.005)}
                    testID="audio-player-threshold-low"
                >
                    Threshold 0.005
                </Button>
                <Button
                    mode="outlined"
                    onPress={() => updateThreshold(0.05)}
                    testID="audio-player-threshold-mid"
                >
                    0.05
                </Button>
                <Button
                    mode="outlined"
                    onPress={() => updateThreshold(0.5)}
                    testID="audio-player-threshold-high"
                >
                    0.5
                </Button>
            </View>

            <View style={styles.controlsRow}>
                {(['linear', 'sqrt', 'log'] as const).map((mode) => (
                    <Button
                        key={mode}
                        mode={amplitudeScale === mode ? 'contained' : 'outlined'}
                        onPress={() => setAmplitudeScale(mode)}
                        testID={`audio-player-scale-${mode}`}
                    >
                        {`Scale: ${mode}`}
                    </Button>
                ))}
            </View>

            <View style={styles.widgetWrap}>
                <Text variant="titleSmall">AudioPlayerWidget (new bar viz)</Text>
                <AudioPlayerWidget
                    dataPoints={dataPoints}
                    width={widgetWidth}
                    waveformHeight={72}
                    silenceTrackHeight={6}
                    showSilenceTrack={showSilenceTrack}
                    currentTimeMs={controller.currentTimeMs}
                    durationMs={controller.durationMs}
                    isPlaying={controller.isPlaying}
                    onPlayPause={controller.toggle}
                    onSeek={controller.seek}
                    amplitudeScale={amplitudeScale}
                    voiceMask={voiceMask.length === dataPoints.length ? voiceMask : undefined}
                />
            </View>

            {fullAnalysis && fullAnalysis.dataPoints.length > 0 ? (
                <View style={styles.widgetWrap}>
                    <Text variant="titleSmall" testID="audio-player-comparison-label">
                        Smooth path (`Waveform` primitive)
                    </Text>
                    <View
                        style={[
                            styles.referenceWrap,
                            { width: widgetWidth, height: 80 },
                        ]}
                        testID="audio-player-comparison"
                    >
                        <Canvas style={{ width: widgetWidth, height: 80 }}>
                            <Waveform
                                activePoints={fullAnalysis.dataPoints.map((p) => ({
                                    ...p,
                                    visible: true,
                                }))}
                                canvasWidth={widgetWidth}
                                canvasHeight={80}
                                minAmplitude={fullAnalysis.amplitudeRange?.min ?? 0}
                                maxAmplitude={fullAnalysis.amplitudeRange?.max ?? 1}
                                theme={{ color: '#7C3AED', strokeWidth: 1.5 }}
                                smoothing
                            />
                        </Canvas>
                    </View>
                </View>
            ) : null}

            {voiceSegments.length > 0 || vadStatus.phase !== 'idle' ? (
                <View style={styles.statusBlock} testID="audio-player-vad-block">
                    <Text variant="titleSmall">Silero VAD</Text>
                    <Text testID="audio-player-vad-status">
                        {vadStatus.phase === 'done'
                            ? `${vadStatus.segmentCount} voice segment(s) · ${(vadStatus.voiceMs / 1000).toFixed(1)}s of speech · ${vadStatus.elapsedMs}ms`
                            : vadStatus.phase === 'error'
                                ? `Error: ${vadStatus.error}`
                                : `Phase: ${vadStatus.phase}`}
                    </Text>
                    <Text>
                        Bars colored by Silero voice mask
                        {voiceMask.filter((v) => v).length > 0
                            ? ` · ${voiceMask.filter((v) => v).length} of ${voiceMask.length} bars marked voice`
                            : ''}
                    </Text>
                </View>
            ) : null}

            <View style={styles.statusBlock}>
                <Text variant="titleSmall">Status</Text>
                <Text testID="audio-player-status">{status}</Text>
                <Text testID="audio-player-threshold-display">
                    Silence threshold: {extraction.threshold.toFixed(3)}
                </Text>
                <Text>Platform: {Platform.OS}</Text>
                {extraction.lastError ? (
                    <Text testID="audio-player-error-code">
                        Error code: {extraction.lastError.code}
                    </Text>
                ) : null}
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: {
        padding: 16,
        gap: 16,
        paddingBottom: 80,
    },
    controlsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    flexBtn: {
        flex: 1,
        minWidth: 140,
    },
    widgetWrap: {
        alignItems: 'center',
        gap: 6,
    },
    referenceWrap: {
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: 'rgba(124,58,237,0.05)',
    },
    statusBlock: {
        gap: 4,
        padding: 12,
        borderRadius: 8,
        backgroundColor: 'rgba(124,58,237,0.06)',
    },
})
