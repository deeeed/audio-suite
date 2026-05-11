import React, { useCallback, useMemo, useState } from 'react'

import * as DocumentPicker from 'expo-document-picker'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Button, Checkbox, Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { AppTheme } from '@siteed/design-system'
import { Notice, NumberAdjuster, ScreenWrapper, useTheme, useToast } from '@siteed/design-system'
import type { AudioAnalysis, AudioFeaturesOptions } from '@siteed/audio-studio'
import { extractAudioAnalysis } from '@siteed/audio-studio'
import { AudioTimeRangeSelector } from '@siteed/audio-ui'

import { baseLogger, config } from '../config'
import { useSampleAudio } from '../hooks/useSampleAudio'
import { isWeb } from '../utils/utils'
import { useScreenHeader } from '../hooks/useScreenHeader'

const SAMPLE_AUDIO_WEB = `${config.baseUrl}/audio_samples/jfk.mp3`

const logger = baseLogger.extend('AudioAnalysisScreen')

interface AudioFile {
    fileUri: string
    filename: string
}

const FEATURE_KEYS: (keyof AudioFeaturesOptions)[] = [
    'energy',
    'rms',
    'zcr',
    'mfcc',
    'spectralCentroid',
    'spectralFlatness',
    'spectralRolloff',
    'spectralBandwidth',
    'chromagram',
    'hnr',
]

const getStyles = ({ theme, insets }: { theme: AppTheme; insets?: { bottom: number } }) =>
    StyleSheet.create({
        container: {
            gap: theme.spacing.gap || 16,
            paddingHorizontal: theme.padding.s,
            paddingBottom: insets?.bottom || 80,
            paddingTop: 0,
        },
        card: {
            gap: 4,
            backgroundColor: theme.colors.secondaryContainer,
            padding: 16,
            borderRadius: 8,
        },
        mono: {
            fontFamily: 'monospace',
            fontSize: 11,
        },
        featureRow: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 4,
        },
        featureChip: {
            flexDirection: 'row',
            alignItems: 'center',
        },
        segmentCard: {
            gap: 2,
            backgroundColor: theme.colors.surfaceVariant,
            padding: 12,
            borderRadius: 6,
        },
    })

function formatNumber(v: number | undefined): string {
    if (v === undefined || v === null) return '-'
    if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(3)
    return v.toFixed(4)
}

export default function AudioAnalysisScreen() {
    const theme = useTheme()
    const { bottom } = useSafeAreaInsets()
    const styles = useMemo(() => getStyles({ theme, insets: { bottom } }), [theme, bottom])
    const { show } = useToast()

    const [currentFile, setCurrentFile] = useState<AudioFile | null>(null)
    const [analysisResult, setAnalysisResult] = useState<AudioAnalysis | null>(null)
    const [error, setError] = useState<string>()
    const [isProcessing, setIsProcessing] = useState(false)
    const [showManualInput, setShowManualInput] = useState(false)
    const [fileDurationMs, setFileDurationMs] = useState(60000)

    // Config
    const [segmentDurationMs, setSegmentDurationMs] = useState(100)
    const [startTimeMs, setStartTimeMs] = useState(0)
    const [endTimeMs, setEndTimeMs] = useState(5000)
    const [selectedFeatures, setSelectedFeatures] = useState<AudioFeaturesOptions>({
        energy: true,
        rms: true,
        zcr: true,
        mfcc: true,
        spectralCentroid: true,
        spectralFlatness: true,
        spectralRolloff: true,
        spectralBandwidth: true,
        chromagram: true,
        hnr: false,
    })

    const { isLoading: isSampleLoading, loadSampleAudio } = useSampleAudio({
        onError: (err) => {
            logger.error('Error loading sample:', err)
            show({ type: 'error', message: 'Error loading sample audio', duration: 3000 })
        },
    })

    useScreenHeader({
        title: 'Audio Analysis',
        backBehavior: { fallbackUrl: '/more' },
    })

    const toggleFeature = useCallback((key: keyof AudioFeaturesOptions) => {
        setSelectedFeatures((prev) => ({ ...prev, [key]: !prev[key] }))
    }, [])

    const handleRangeChange = useCallback((start: number, end: number) => {
        setStartTimeMs(start)
        setEndTimeMs(end)
    }, [])

    const runExtraction = useCallback(
        async (fileUri: string) => {
            try {
                setIsProcessing(true)
                setError(undefined)
                show({ loading: true, message: 'Extracting audio analysis...' })

                const result = await extractAudioAnalysis({
                    fileUri,
                    segmentDurationMs,
                    startTimeMs: startTimeMs || undefined,
                    endTimeMs: endTimeMs || undefined,
                    features: selectedFeatures,
                })

                logger.info('Audio analysis extracted', {
                    segments: result.dataPoints.length,
                    durationMs: result.durationMs,
                    extractionTimeMs: result.extractionTimeMs,
                    sampleRate: result.sampleRate,
                })

                setAnalysisResult(result)
                // Update file duration from actual result if larger than current estimate
                if (result.durationMs > fileDurationMs) {
                    setFileDurationMs(result.durationMs)
                }
                show({
                    type: 'success',
                    message: `Extracted ${result.dataPoints.length} segments in ${result.extractionTimeMs.toFixed(0)}ms`,
                    stackBehavior: { isStackable: false },
                    duration: 2000,
                })
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Failed to extract audio analysis'
                setError(msg)
                show({ type: 'error', message: msg, duration: 3000 })
                logger.error('Error extracting audio analysis:', err)
            } finally {
                setIsProcessing(false)
            }
        },
        [segmentDurationMs, startTimeMs, endTimeMs, selectedFeatures, fileDurationMs, show]
    )

    const pickAudioFile = useCallback(async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ['audio/*'],
                copyToCacheDirectory: true,
            })
            if (result.canceled) return

            const newFile = {
                fileUri: result.assets[0].uri,
                filename: result.assets[0].name ?? 'Unknown',
            }
            setCurrentFile(newFile)
            setAnalysisResult(null)
            setError(undefined)
            // Default to 60s for picked files; user can adjust via manual input
            setFileDurationMs(60000)
            setStartTimeMs(0)
            setEndTimeMs(5000)
        } catch (err) {
            show({ type: 'error', message: 'Failed to load audio file', duration: 3000 })
        }
    }, [show])

    const handleLoadSample = useCallback(async () => {
        try {
            setIsProcessing(true)

            if (isWeb) {
                setCurrentFile({ fileUri: SAMPLE_AUDIO_WEB, filename: 'JFK Speech Sample' })
                setAnalysisResult(null)
                setError(undefined)
                setFileDurationMs(60000)
                setStartTimeMs(0)
                setEndTimeMs(5000)
                return
            }

            const sampleFile = await loadSampleAudio(require('@assets/jfk.mp3'))
            if (!sampleFile) throw new Error('Failed to load sample audio file')

            const duration = sampleFile.durationMs || 60000
            setCurrentFile({ fileUri: sampleFile.uri, filename: 'JFK Speech Sample' })
            setAnalysisResult(null)
            setError(undefined)
            setFileDurationMs(duration)
            setStartTimeMs(0)
            setEndTimeMs(Math.min(5000, duration))
        } catch (err) {
            show({ type: 'error', message: 'Failed to load sample audio', duration: 3000 })
        } finally {
            setIsProcessing(false)
        }
    }, [loadSampleAudio, show])

    // Compute summary stats for scalar features across all segments
    const summaryStats = useMemo(() => {
        if (!analysisResult) return null
        const points = analysisResult.dataPoints
        if (points.length === 0) return null

        const scalarKeys = ['energy', 'rms', 'zcr', 'spectralCentroid', 'spectralFlatness', 'spectralRolloff', 'spectralBandwidth', 'hnr'] as const
        const stats: Record<string, { min: number; max: number; mean: number }> = {}

        for (const key of scalarKeys) {
            const vals = points
                .map((p) => p.features?.[key] as number | undefined)
                .filter((v): v is number => v !== undefined && v !== null)
            if (vals.length === 0) continue
            const min = Math.min(...vals)
            const max = Math.max(...vals)
            const mean = vals.reduce((a, b) => a + b, 0) / vals.length
            stats[key] = { min, max, mean }
        }

        return Object.keys(stats).length > 0 ? stats : null
    }, [analysisResult])

    return (
        <ScreenWrapper withScrollView useInsets={false} contentContainerStyle={styles.container}>
            <View style={{ gap: 16 }}>
                <Notice
                    type="info"
                    title="Audio Analysis"
                    message="Extract spectral, MFCC, chromagram, and other audio features from audio files using the C++ analysis engine."
                />

                <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button
                        mode="contained"
                        onPress={pickAudioFile}
                        icon="file-upload"
                        disabled={isProcessing}
                        style={{ flex: 1 }}
                    >
                        Select File
                    </Button>
                    <Button
                        mode="contained-tonal"
                        onPress={handleLoadSample}
                        icon="music-box"
                        loading={isSampleLoading}
                        disabled={isProcessing}
                    >
                        Load Sample
                    </Button>
                </View>

                {currentFile && (
                    <View style={{ gap: 16 }}>
                        <View style={styles.card}>
                            <Text variant="titleMedium">File: {currentFile.filename}</Text>
                        </View>

                        <NumberAdjuster
                            label="Segment Duration (ms)"
                            value={segmentDurationMs}
                            onChange={setSegmentDurationMs}
                            min={10}
                            max={1000}
                            step={10}
                            disabled={isProcessing}
                        />

                        <View>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <Text variant="titleMedium">Analysis Range</Text>
                                <Button
                                    mode="text"
                                    icon={showManualInput ? 'keyboard-close' : 'pencil'}
                                    onPress={() => setShowManualInput((prev) => !prev)}
                                    compact
                                >
                                    {showManualInput ? 'Hide' : 'Edit'}
                                </Button>
                            </View>

                            <View style={{ paddingHorizontal: 16 }}>
                                <AudioTimeRangeSelector
                                    durationMs={fileDurationMs}
                                    startTime={startTimeMs}
                                    endTime={endTimeMs}
                                    onRangeChange={handleRangeChange}
                                    disabled={isProcessing}
                                    theme={{
                                        container: {
                                            backgroundColor: theme.colors.surfaceVariant,
                                            height: 48,
                                            borderRadius: 8,
                                        },
                                        selectedRange: {
                                            backgroundColor: theme.colors.primary,
                                            opacity: 0.5,
                                        },
                                        handle: {
                                            backgroundColor: theme.colors.primary,
                                            width: 20,
                                        },
                                    }}
                                />
                            </View>

                            {showManualInput && (
                                <View style={{ gap: 12, marginTop: 16 }}>
                                    <NumberAdjuster
                                        label="Start Time (ms)"
                                        value={startTimeMs}
                                        onChange={setStartTimeMs}
                                        min={0}
                                        max={fileDurationMs}
                                        step={100}
                                        disabled={isProcessing}
                                    />
                                    <NumberAdjuster
                                        label="End Time (ms)"
                                        value={endTimeMs}
                                        onChange={setEndTimeMs}
                                        min={0}
                                        max={fileDurationMs}
                                        step={100}
                                        disabled={isProcessing}
                                    />
                                </View>
                            )}
                        </View>

                        <View style={styles.card}>
                            <Text variant="titleMedium">Features</Text>
                            <View style={styles.featureRow}>
                                {FEATURE_KEYS.map((key) => (
                                    <View key={key} style={styles.featureChip}>
                                        <Checkbox
                                            status={selectedFeatures[key] ? 'checked' : 'unchecked'}
                                            onPress={() => toggleFeature(key)}
                                            disabled={isProcessing}
                                        />
                                        <Text
                                            variant="bodySmall"
                                            onPress={() => toggleFeature(key)}
                                        >
                                            {key}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        </View>

                        <Button
                            mode="contained"
                            onPress={() => runExtraction(currentFile.fileUri)}
                            icon="chart-bar"
                            loading={isProcessing}
                            disabled={isProcessing}
                        >
                            Extract
                        </Button>
                    </View>
                )}

                {error && <Notice type="error" title="Error" message={error} />}

                {analysisResult && !isProcessing && (
                    <View style={{ gap: 16 }}>
                        <View style={styles.card}>
                            <Text variant="titleMedium">Metadata</Text>
                            <Text>Sample Rate: {analysisResult.sampleRate} Hz</Text>
                            <Text>Duration: {(analysisResult.durationMs / 1000).toFixed(2)}s</Text>
                            <Text>Extraction Time: {analysisResult.extractionTimeMs.toFixed(0)}ms</Text>
                            <Text>Segments: {analysisResult.dataPoints.length}</Text>
                            <Text>Segment Duration: {analysisResult.segmentDurationMs}ms</Text>
                            <Text>Bit Depth: {analysisResult.bitDepth}</Text>
                            <Text>Channels: {analysisResult.numberOfChannels}</Text>
                            <Text>Amplitude Range: [{formatNumber(analysisResult.amplitudeRange.min)}, {formatNumber(analysisResult.amplitudeRange.max)}]</Text>
                            <Text>RMS Range: [{formatNumber(analysisResult.rmsRange.min)}, {formatNumber(analysisResult.rmsRange.max)}]</Text>
                        </View>

                        {summaryStats && (
                            <View style={styles.card}>
                                <Text variant="titleMedium">Summary Stats</Text>
                                <ScrollView horizontal>
                                    <View>
                                        <View style={{ flexDirection: 'row', paddingVertical: 4 }}>
                                            <Text style={[styles.mono, { width: 140 }]}>Feature</Text>
                                            <Text style={[styles.mono, { width: 100 }]}>Min</Text>
                                            <Text style={[styles.mono, { width: 100 }]}>Max</Text>
                                            <Text style={[styles.mono, { width: 100 }]}>Mean</Text>
                                        </View>
                                        {Object.entries(summaryStats).map(([key, s]) => (
                                            <View key={key} style={{ flexDirection: 'row', paddingVertical: 2 }}>
                                                <Text style={[styles.mono, { width: 140 }]}>{key}</Text>
                                                <Text style={[styles.mono, { width: 100 }]}>{formatNumber(s.min)}</Text>
                                                <Text style={[styles.mono, { width: 100 }]}>{formatNumber(s.max)}</Text>
                                                <Text style={[styles.mono, { width: 100 }]}>{formatNumber(s.mean)}</Text>
                                            </View>
                                        ))}
                                    </View>
                                </ScrollView>
                            </View>
                        )}

                        <View style={styles.card}>
                            <Text variant="titleMedium">
                                Segments ({Math.min(10, analysisResult.dataPoints.length)} of {analysisResult.dataPoints.length})
                            </Text>
                        </View>
                        {analysisResult.dataPoints.slice(0, 10).map((dp) => (
                            <View key={dp.id} style={styles.segmentCard}>
                                <Text style={styles.mono}>
                                    [{dp.id}] amp={formatNumber(dp.amplitude)} rms={formatNumber(dp.rms)} dB={formatNumber(dp.dB)} silent={String(dp.silent)}
                                </Text>
                                {dp.features && (
                                    <View style={{ gap: 1, marginTop: 2 }}>
                                        {dp.features.energy !== undefined && (
                                            <Text style={styles.mono}>  energy={formatNumber(dp.features.energy)}</Text>
                                        )}
                                        {dp.features.zcr !== undefined && (
                                            <Text style={styles.mono}>  zcr={formatNumber(dp.features.zcr)}</Text>
                                        )}
                                        {dp.features.spectralCentroid !== undefined && (
                                            <Text style={styles.mono}>  spectralCentroid={formatNumber(dp.features.spectralCentroid)}</Text>
                                        )}
                                        {dp.features.spectralFlatness !== undefined && (
                                            <Text style={styles.mono}>  spectralFlatness={formatNumber(dp.features.spectralFlatness)}</Text>
                                        )}
                                        {dp.features.spectralRolloff !== undefined && (
                                            <Text style={styles.mono}>  spectralRolloff={formatNumber(dp.features.spectralRolloff)}</Text>
                                        )}
                                        {dp.features.spectralBandwidth !== undefined && (
                                            <Text style={styles.mono}>  spectralBandwidth={formatNumber(dp.features.spectralBandwidth)}</Text>
                                        )}
                                        {dp.features.hnr !== undefined && (
                                            <Text style={styles.mono}>  hnr={formatNumber(dp.features.hnr)}</Text>
                                        )}
                                        {dp.features.mfcc && (
                                            <Text style={styles.mono}>  mfcc=[{dp.features.mfcc.slice(0, 5).map((v) => v.toFixed(2)).join(', ')}{dp.features.mfcc.length > 5 ? '...' : ''}]</Text>
                                        )}
                                        {dp.features.chromagram && (
                                            <Text style={styles.mono}>  chroma=[{dp.features.chromagram.slice(0, 5).map((v) => v.toFixed(2)).join(', ')}{dp.features.chromagram.length > 5 ? '...' : ''}]</Text>
                                        )}
                                    </View>
                                )}
                            </View>
                        ))}
                    </View>
                )}
            </View>
        </ScreenWrapper>
    )
}
