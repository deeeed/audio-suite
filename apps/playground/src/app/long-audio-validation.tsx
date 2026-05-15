import Constants from 'expo-constants'
import { Redirect } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Platform, StyleSheet, TextInput, View } from 'react-native'
import { Button, ProgressBar } from 'react-native-paper'

import type { AppTheme } from '@siteed/design-system'
import { Notice, ScreenWrapper, Text, useTheme } from '@siteed/design-system'
import type { AsrModelConfig } from '@siteed/sherpa-onnx.rn'

import {
    cancelLongAudioValidation,
    getLongAudioValidationProgress,
    setAgenticPageState,
    validateLongAudioStream,
    type LongAudioValidationMode,
    type LongAudioValidationProgress,
} from '../agentic-bridge'

const APP_VARIANT =
    typeof Constants.expoConfig?.extra?.APP_VARIANT === 'string'
        ? Constants.expoConfig.extra.APP_VARIANT
        : 'development'
const ANDROID_PACKAGE_NAME =
    APP_VARIANT === 'production'
        ? 'net.siteed.audioplayground'
        : `net.siteed.audioplayground.${APP_VARIANT}`
const ANDROID_STAGED_FIXTURE = `/data/user/0/${ANDROID_PACKAGE_NAME}/files/agent-fixtures/perps_controller_refactor_100m.opus`
const WEB_SAFE_RANGE_LIMIT_MS = 5 * 60 * 1000

const DEFAULT_FIXTURE_URI = Platform.select({
    android: ANDROID_STAGED_FIXTURE,
    default: '',
})

const DEFAULT_SHERPA_CONFIG = JSON.stringify(
    {
        modelDir: `/data/user/0/${ANDROID_PACKAGE_NAME}/files/sherpa-onnx/asr/qwen3-asr-0.6B-int8-2026-03-25`,
        modelType: 'qwen3',
        streaming: false,
        numThreads: 4,
        decodingMethod: 'greedy_search',
        maxActivePaths: 4,
        provider: 'cpu',
        modelFiles: {
            encoder: 'encoder.int8.onnx',
            decoder: 'decoder.int8.onnx',
            convFrontend: 'conv_frontend.onnx',
            tokenizer: 'tokenizer',
        },
        qwen3: {
            maxTotalLen: 512,
            maxNewTokens: 128,
            temperature: 0.000001,
            topP: 0.8,
            seed: 42,
        },
    },
    null,
    2,
)

const getStyles = (theme: AppTheme) =>
    StyleSheet.create({
        container: {
            gap: theme.spacing.gap,
            paddingHorizontal: theme.padding.s,
            paddingBottom: theme.padding.l,
            paddingTop: theme.padding.s,
        },
        section: {
            gap: theme.spacing.gap,
            padding: theme.padding.s,
            borderRadius: theme.roundness,
            backgroundColor: theme.colors.surface,
        },
        sectionTitle: {
            fontSize: 18,
            fontWeight: '700',
            color: theme.colors.onSurface,
        },
        body: {
            color: theme.colors.onSurfaceVariant,
        },
        input: {
            minHeight: 48,
            paddingHorizontal: theme.padding.s,
            paddingVertical: theme.padding.s,
            borderRadius: theme.roundness,
            borderWidth: 1,
            borderColor: theme.colors.outline,
            color: theme.colors.onSurface,
            backgroundColor: theme.colors.surfaceVariant,
        },
        row: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing.gap,
        },
        metricCard: {
            flexGrow: 1,
            minWidth: 140,
            gap: 4,
            padding: theme.padding.s,
            borderRadius: theme.roundness,
            backgroundColor: theme.colors.surfaceVariant,
        },
        metricLabel: {
            fontSize: 12,
            color: theme.colors.onSurfaceVariant,
        },
        metricValue: {
            fontSize: 18,
            fontWeight: '700',
            color: theme.colors.onSurface,
        },
        error: {
            color: theme.colors.error,
        },
        monospace: {
            fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
            fontSize: 12,
            color: theme.colors.onSurfaceVariant,
        },
    })

function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return 'n/a'
    const totalSeconds = Math.round(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`
}

function formatPercent(value: number): string {
    if (!Number.isFinite(value)) return 'n/a'
    return `${Math.max(0, Math.min(100, value * 100)).toFixed(2)}%`
}

interface ParsedRangeEnd {
    readonly error?: string
    readonly value?: number
}

function parseRangeEndMs(input: string): ParsedRangeEnd {
    const trimmed = input.trim()
    if (!trimmed) return {}
    const value = Number.parseInt(trimmed, 10)
    if (!Number.isFinite(value) || value <= 0) {
        return { error: 'Range end must be a positive millisecond value' }
    }
    return { value }
}

interface MetricProps {
    readonly label: string
    readonly value: string | number
}

function Metric({ label, value }: MetricProps) {
    const theme = useTheme()
    const styles = useMemo(() => getStyles(theme), [theme])
    return (
        <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>{label}</Text>
            <Text style={styles.metricValue}>{value}</Text>
        </View>
    )
}

export default function LongAudioValidationScreen() {
    const theme = useTheme()
    const styles = useMemo(() => getStyles(theme), [theme])
    const [fileUri, setFileUri] = useState(DEFAULT_FIXTURE_URI ?? '')
    const [modelId, setModelId] = useState('moonshine-small-streaming-en')
    const [sherpaConfigJson, setSherpaConfigJson] = useState(DEFAULT_SHERPA_CONFIG)
    const [sherpaSegmentDurationMs, setSherpaSegmentDurationMs] = useState('30000')
    const [rangeEndMs, setRangeEndMs] = useState('')
    const [uiError, setUiError] = useState<string | null>(null)
    const [progress, setProgress] = useState<LongAudioValidationProgress | null>(() =>
        getLongAudioValidationProgress(),
    )
    const [lastStartMode, setLastStartMode] = useState<LongAudioValidationMode>('decode-only')
    const running = progress?.status === 'pending'
    const error = progress?.lastError
    const parsedRangeEnd = useMemo(() => parseRangeEndMs(rangeEndMs), [rangeEndMs])
    const webLongRangeBlocked =
        Platform.OS === 'web' &&
        (!parsedRangeEnd.value || parsedRangeEnd.value > WEB_SAFE_RANGE_LIMIT_MS)
    const startDisabled = running || !fileUri.trim() || webLongRangeBlocked

    useEffect(() => {
        const interval = setInterval(() => {
            const next = getLongAudioValidationProgress()
            setProgress(next)
        }, 1000)
        return () => clearInterval(interval)
    }, [])

    useEffect(() => {
        setAgenticPageState({
            route: '/long-audio-validation',
            fileUri,
            modelId,
            sherpaSegmentDurationMs,
            rangeEndMs,
            sherpaConfigJson,
            lastStartMode,
            status: progress?.status ?? 'idle',
            progress,
            running,
            error: error ?? uiError,
        })
    }, [
        error,
        fileUri,
        lastStartMode,
        modelId,
        progress,
        rangeEndMs,
        running,
        sherpaConfigJson,
        sherpaSegmentDurationMs,
        uiError,
    ])

    const start = useCallback(
        (mode: LongAudioValidationMode) => {
            if (!fileUri.trim()) return
            let sherpaAsrConfig: AsrModelConfig | undefined
            if (mode === 'sherpa-online' || mode === 'sherpa-offline-segments') {
                try {
                    sherpaAsrConfig = JSON.parse(sherpaConfigJson) as AsrModelConfig
                    setUiError(null)
                } catch (e) {
                    setUiError(`Invalid Sherpa config JSON: ${String(e)}`)
                    return
                }
            }
            const parsedSherpaSegmentDurationMs =
                Number.parseInt(sherpaSegmentDurationMs, 10) || 30_000
            if (parsedRangeEnd.error) {
                setUiError(parsedRangeEnd.error)
                return
            }
            setLastStartMode(mode)
            validateLongAudioStream({
                fileUri: fileUri.trim(),
                mode,
                modelId: mode === 'moonshine' ? modelId.trim() : undefined,
                moonshineFeedMode: mode === 'moonshine' ? 'typed-array' : undefined,
                sherpaAsrConfig,
                sherpaSegmentDurationMs: parsedSherpaSegmentDurationMs,
                endTimeMs: parsedRangeEnd.value,
                chunkDurationMs: 250,
                maxBufferedChunks: 4,
                progressEveryChunks: 40,
            }).catch((e) => {
                console.error('[LongAudioValidation] start failed', e)
            })
        },
        [fileUri, modelId, parsedRangeEnd, sherpaConfigJson, sherpaSegmentDurationMs],
    )

    const cancel = useCallback(() => {
        cancelLongAudioValidation('cancelled-from-long-audio-validation-ui')
    }, [])

    if (!__DEV__) {
        return <Redirect href="/(tabs)/more" />
    }

    const progressValue =
        progress?.progress && Number.isFinite(progress.progress)
            ? Math.max(0, Math.min(1, progress.progress))
            : 0

    return (
        <ScreenWrapper withScrollView useInsets={false} contentContainerStyle={styles.container}>
            <Notice
                type="info"
                message="Stage the 100-minute Opus fixture first, then use this page to watch decode-only or decode + Moonshine progress from inside the app."
            />
            {webLongRangeBlocked ? (
                <Notice
                    type="warning"
                    message="Web decoding uses AudioContext.decodeAudioData and loads the whole range into memory. Set range end to 300000 ms or less for web smoke tests; use iOS/Android for full long-audio validation."
                />
            ) : null}

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Long audio validation</Text>
                <Text style={styles.body}>
                    The default Android fixture path follows the current Expo app variant (
                    {APP_VARIANT}) and matches the agentic harness staging location. For iOS, paste
                    the file:// URI staged by the validation harness, or edit this for another path.
                </Text>
                <TextInput
                    testID="long-audio-fixture-uri"
                    style={styles.input}
                    value={fileUri}
                    onChangeText={setFileUri}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="file URI or absolute path"
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                />
                <Text style={styles.body}>
                    Moonshine model ID (for the decode + transcription run)
                </Text>
                <TextInput
                    testID="long-audio-model-id"
                    style={styles.input}
                    value={modelId}
                    onChangeText={setModelId}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="moonshine-small-streaming-en"
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                />
                <Text style={styles.body}>
                    Sherpa ASR JSON config. Default follows the sherpa-voice Qwen3-ASR 0.6B int8
                    config and runs as bounded offline segments over the streaming decoder. The safe
                    default segment is 30 seconds; set 300000 ms to explicitly test a 5-minute
                    segment against the full long fixture. Qwen3 releases and reinitializes Sherpa
                    between segments by default to reduce retained native heap. Use Sherpa online
                    only for truly streaming-capable models.
                </Text>
                <TextInput
                    testID="long-audio-sherpa-config-json"
                    style={[styles.input, { minHeight: 160, textAlignVertical: 'top' }]}
                    value={sherpaConfigJson}
                    onChangeText={setSherpaConfigJson}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    placeholder="{ ... AsrModelConfig ... }"
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                />
                <Text style={styles.body}>Sherpa segment duration ms</Text>
                <TextInput
                    testID="long-audio-sherpa-segment-duration-ms"
                    style={styles.input}
                    value={sherpaSegmentDurationMs}
                    onChangeText={setSherpaSegmentDurationMs}
                    keyboardType="numeric"
                    placeholder="30000"
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                />
                <Text style={styles.body}>
                    Optional range end ms. Set to 300000 to benchmark just the first 5 minutes, or
                    leave empty for the full long fixture.
                </Text>
                <TextInput
                    testID="long-audio-range-end-ms"
                    style={styles.input}
                    value={rangeEndMs}
                    onChangeText={setRangeEndMs}
                    keyboardType="numeric"
                    placeholder="empty = full fixture"
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                />
                <View style={styles.row}>
                    <Button
                        testID="long-audio-start-decode"
                        mode="contained"
                        disabled={startDisabled}
                        onPress={() => start('decode-only')}
                    >
                        Decode only
                    </Button>
                    <Button
                        testID="long-audio-start-full-decode"
                        mode="outlined"
                        disabled={startDisabled}
                        onPress={() => start('full-decode')}
                    >
                        Full decode
                    </Button>
                    <Button
                        testID="long-audio-start-moonshine"
                        mode="contained-tonal"
                        disabled={startDisabled}
                        onPress={() => start('moonshine')}
                    >
                        Decode + Moonshine
                    </Button>
                    <Button
                        testID="long-audio-start-sherpa-online"
                        mode="contained-tonal"
                        disabled={startDisabled || !sherpaConfigJson.trim()}
                        onPress={() => start('sherpa-online')}
                    >
                        Decode + Sherpa online
                    </Button>
                    <Button
                        testID="long-audio-start-sherpa-segments"
                        mode="contained-tonal"
                        disabled={startDisabled || !sherpaConfigJson.trim()}
                        onPress={() => start('sherpa-offline-segments')}
                    >
                        Decode + Sherpa Qwen3 segments
                    </Button>
                    <Button
                        testID="long-audio-cancel"
                        mode="outlined"
                        disabled={!running}
                        onPress={cancel}
                    >
                        Cancel
                    </Button>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Progress</Text>
                <ProgressBar progress={progressValue} />
                <View style={styles.row}>
                    <Metric label="Status" value={progress?.status ?? 'idle'} />
                    <Metric label="Mode" value={progress?.mode ?? lastStartMode} />
                    <Metric label="Progress" value={formatPercent(progressValue)} />
                    <Metric
                        label="Processed"
                        value={formatDuration(progress?.processedAudioMs ?? 0)}
                    />
                    <Metric label="Duration" value={formatDuration(progress?.durationMs ?? 0)} />
                    <Metric label="Chunks" value={progress?.chunkCount ?? 0} />
                    <Metric label="Samples" value={progress?.sampleCount ?? 0} />
                    <Metric label="Sample rate" value={progress?.sampleRate ?? 0} />
                    <Metric label="Transcript lines" value={progress?.transcriptLineCount ?? 0} />
                    <Metric label="Transcript chars" value={progress?.transcriptCharCount ?? 0} />
                </View>
                {error || uiError ? <Text style={styles.error}>{error ?? uiError}</Text> : null}
                <Text style={styles.monospace}>
                    {JSON.stringify(progress ?? { status: 'idle' }, null, 2)}
                </Text>
            </View>
        </ScreenWrapper>
    )
}
