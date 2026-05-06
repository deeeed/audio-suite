import React, { useCallback, useMemo, useRef, useState } from 'react'

import { Asset } from 'expo-asset'
import { Stack } from 'expo-router'
import {
    Platform,
    ScrollView,
    StyleSheet,
    View,
    useWindowDimensions,
} from 'react-native'
import { Button, Text } from 'react-native-paper'

import {
    AudioFilePlayerWidget,
    type AudioFilePlayerExtractor,
} from '@siteed/audio-ui'
import { extractPreviewBars } from '@siteed/audio-studio'
import { Notice, useTheme } from '@siteed/design-system'

import { baseLogger } from '../config'
import { useAudioPlayback } from '../hooks/useAudioPlayback'
import { useScreenHeader } from '../hooks/useScreenHeader'

const logger = baseLogger.extend('WidgetComparison')

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SAMPLE_ASSET = require('@assets/jfk.mp3')

interface RenderTiming {
    extractMs: number | null
    barCount: number | null
}

export default function WidgetComparisonScreen() {
    const { width: windowWidth } = useWindowDimensions()
    const widgetWidth = Math.min(560, Math.max(280, Math.floor(windowWidth - 32)))
    const theme = useTheme()
    const colors = theme.colors

    useScreenHeader({
        title: 'Widget Comparison',
        backBehavior: { fallbackUrl: '/more' },
    })

    const [fileUri, setFileUri] = useState<string | null>(null)
    const [timing, setTiming] = useState<RenderTiming>({
        extractMs: null,
        barCount: null,
    })
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    const ourPlayback = useAudioPlayback()

    // Lazy-load simform — only on native, since it's a native module that
    // also forces an Expo prebuild + pod install. Avoid pulling it on web.
    const simformWaveform = useMemo(() => {
        if (Platform.OS === 'web') return null
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            return require('@simform_solutions/react-native-audio-waveform') as typeof import('@simform_solutions/react-native-audio-waveform')
        } catch (e) {
            logger.warn('@simform_solutions/react-native-audio-waveform unavailable', e)
            return null
        }
    }, [])

    // Wrap audio-studio's extractPreviewBars in the shape the widget expects
    // and time it so we can surface cold-extract numbers in the metrics block.
    const extractor: AudioFilePlayerExtractor = useCallback(
        async ({ fileUri: uri, numberOfBars, startTimeMs, endTimeMs }) => {
            const start = performance.now()
            const result = await extractPreviewBars({
                fileUri: uri,
                numberOfBars,
                startTimeMs,
                endTimeMs,
            })
            const extractMs = performance.now() - start
            setTiming({ extractMs, barCount: result.bars.length })
            return { bars: result.bars, durationMs: result.durationMs }
        },
        [],
    )

    const loadSample = useCallback(async () => {
        try {
            setIsLoading(true)
            setError(null)
            setTiming({ extractMs: null, barCount: null })
            const asset = Asset.fromModule(SAMPLE_ASSET)
            await asset.downloadAsync()
            const uri = asset.localUri ?? asset.uri
            if (!uri) throw new Error('Sample asset has no localUri')
            setFileUri(uri)
            ourPlayback.load(uri)
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            logger.error('loadSample failed', e)
            setError(message)
        } finally {
            setIsLoading(false)
        }
    }, [ourPlayback])

    return (
        <ScrollView
            style={{ backgroundColor: colors.background }}
            contentContainerStyle={styles.container}
            testID="widget-comparison-screen"
        >
            <Stack.Screen options={{ title: 'Widget Comparison' }} />
            <Notice
                type="info"
                title="WaveformPreview vs Simform"
                message="Loads the same audio sample into both the audio-ui AudioFilePlayerWidget (Skia bars driven from extracted PreviewBar[]) and Simform's native AudioWaveform (Kotlin/Swift bars driven from the file path). Cold extraction time is reported below."
            />

            {Platform.OS === 'web' ? (
                <Notice
                    type="warning"
                    title="Native module only"
                    message="Simform's react-native-audio-waveform ships native code only; this comparison runs on iOS / Android. Open this route on a device or simulator after `yarn expo prebuild --platform ios && pod install`."
                />
            ) : null}

            <View style={styles.controls}>
                <Button
                    mode="contained"
                    onPress={loadSample}
                    icon="music-box"
                    loading={isLoading}
                    disabled={isLoading}
                    testID="comparison-load-sample"
                    style={styles.flexBtn}
                >
                    Load JFK Sample
                </Button>
            </View>

            {error ? (
                <Text style={[styles.error, { color: colors.error }]}>
                    Error: {error}
                </Text>
            ) : null}

            <View
                style={[
                    styles.metrics,
                    { backgroundColor: colors.surfaceVariant },
                ]}
                testID="comparison-metrics"
            >
                <Text variant="titleSmall">Timing</Text>
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    Sample-extract:{' '}
                    {timing.extractMs == null
                        ? 'n/a'
                        : `${timing.extractMs.toFixed(1)}ms`}{' '}
                    · bars: {timing.barCount ?? 'n/a'}
                </Text>
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    Simform paint: native-side, not measurable from JS — watch the
                    rendered bars to compare visual quality.
                </Text>
            </View>

            <View style={[styles.section, { backgroundColor: colors.surface }]}>
                <Text variant="titleMedium">audio-ui · AudioFilePlayerWidget</Text>
                <Text
                    variant="bodySmall"
                    style={{ color: colors.onSurfaceVariant, marginBottom: 4 }}
                >
                    File-aware wrapper. Pass a `fileUri` + an `extract` impl
                    (here: audio-studio's `extractPreviewBars`); the widget
                    extracts once, caches per uri, and feeds the bars into the
                    underlying AudioPlayerWidget.
                </Text>
                {fileUri ? (
                    <AudioFilePlayerWidget
                        fileUri={fileUri}
                        extract={extractor}
                        numberOfBars={Math.min(
                            400,
                            Math.max(120, Math.floor(widgetWidth)),
                        )}
                        width={widgetWidth}
                        waveformHeight={72}
                        density="comfortable"
                        showSilenceTrack={false}
                        currentTimeMs={ourPlayback.currentTimeMs}
                        isPlaying={ourPlayback.isPlaying}
                        onPlayPause={ourPlayback.toggle}
                        onSeek={ourPlayback.seek}
                        barColor={colors.outlineVariant}
                        silentBarColor={colors.outlineVariant}
                        playedBarColor={colors.primary}
                        playedSilentBarColor={colors.primary}
                        showPlayhead={false}
                        silenceBandColor={colors.outline}
                        playheadColor={colors.onSurface}
                        backgroundColor={colors.surfaceVariant}
                        accentColor={colors.primary}
                        textColor={colors.onSurface}
                        statusColor={colors.onSurfaceVariant}
                        errorColor={colors.error}
                        disabledColor={colors.outlineVariant}
                        iconColor={colors.onPrimary}
                        testID="comparison-our-widget"
                    />
                ) : (
                    <Text
                        variant="bodySmall"
                        style={{ color: colors.onSurfaceVariant }}
                    >
                        Tap "Load JFK Sample" to feed a file into both widgets.
                    </Text>
                )}
            </View>

            {Platform.OS !== 'web' && simformWaveform && fileUri ? (
                <View
                    style={[styles.section, { backgroundColor: colors.surface }]}
                >
                    <Text variant="titleMedium">
                        Simform · @simform_solutions/react-native-audio-waveform
                    </Text>
                    <Text
                        variant="bodySmall"
                        style={{
                            color: colors.onSurfaceVariant,
                            marginBottom: 4,
                        }}
                    >
                        Native bars rendered from the file path. Audio extraction
                        and playback happen native-side (no JS PreviewBar[]).
                    </Text>
                    <SimformBlock
                        Waveform={simformWaveform.Waveform}
                        path={fileUri}
                        width={widgetWidth}
                        waveColor={colors.primary}
                        scrubColor={colors.onSurface}
                    />
                </View>
            ) : (
                <View
                    style={[styles.section, { backgroundColor: colors.surface }]}
                >
                    <Text variant="titleMedium">
                        Simform · @simform_solutions/react-native-audio-waveform
                    </Text>
                    <Text
                        variant="bodySmall"
                        style={{ color: colors.onSurfaceVariant }}
                    >
                        {Platform.OS === 'web'
                            ? 'Native module — open this route on iOS / Android.'
                            : !simformWaveform
                              ? 'Module unavailable. Run `yarn expo prebuild --platform ios && pod install && yarn ios` to autolink the native code.'
                              : 'Tap "Load JFK Sample" above to feed the same audio file into both widgets.'}
                    </Text>
                </View>
            )}
        </ScrollView>
    )
}

interface SimformBlockProps {
    Waveform: typeof import('@simform_solutions/react-native-audio-waveform').Waveform
    path: string
    width: number
    waveColor: string
    scrubColor: string
}

function SimformBlock({
    Waveform,
    path,
    width,
    waveColor,
    scrubColor,
}: SimformBlockProps) {
    const ref = useRef<import('@simform_solutions/react-native-audio-waveform').IWaveformRef | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)

    const togglePlayback = useCallback(async () => {
        const handle = ref.current
        if (!handle) return
        try {
            if (isPlaying) {
                await handle.pausePlayer()
                setIsPlaying(false)
            } else {
                await handle.startPlayer()
                setIsPlaying(true)
            }
        } catch (e) {
            logger.warn('simform playback toggle failed', e)
        }
    }, [isPlaying])

    return (
        <View>
            <Waveform
                mode="static"
                ref={ref}
                path={path}
                candleSpace={2}
                candleWidth={3}
                waveColor={waveColor}
                scrubColor={scrubColor}
                containerStyle={{
                    height: 72,
                    width,
                }}
                onPlayerStateChange={(state) => {
                    setIsPlaying(state === 'playing')
                }}
            />
            <View style={styles.simformControls}>
                <Button
                    mode="contained-tonal"
                    icon={isPlaying ? 'pause' : 'play'}
                    onPress={togglePlayback}
                    testID="comparison-simform-toggle"
                >
                    {isPlaying ? 'Pause' : 'Play'} Simform
                </Button>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        padding: 16,
        gap: 16,
        paddingBottom: 80,
    },
    controls: {
        flexDirection: 'row',
        gap: 8,
    },
    flexBtn: {
        flex: 1,
    },
    metrics: {
        padding: 12,
        borderRadius: 12,
        gap: 4,
    },
    section: {
        padding: 12,
        borderRadius: 12,
        gap: 6,
    },
    simformControls: {
        marginTop: 8,
        flexDirection: 'row',
    },
    error: {
        fontSize: 14,
    },
})
