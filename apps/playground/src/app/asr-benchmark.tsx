import { Redirect } from 'expo-router'
import React, { useEffect, useMemo } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'

import type { AppTheme } from '@siteed/design-system'
import { Notice, ScreenWrapper, Text, useTheme } from '@siteed/design-system'

import { setAgenticPageState } from '../agentic-bridge'
import { useAsrBenchmark, type AsrBenchmarkResult } from '../hooks/useAsrBenchmark'

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
            backgroundColor: theme.colors.surface,
            borderRadius: theme.roundness,
        },
        sectionTitle: {
            fontSize: 18,
            fontWeight: '700',
            color: theme.colors.onSurface,
        },
        sectionBody: {
            color: theme.colors.onSurfaceVariant,
        },
        recommendationGrid: {
            gap: theme.spacing.gap,
        },
        recommendationCard: {
            gap: 4,
            padding: theme.padding.s,
            backgroundColor: theme.colors.surfaceVariant,
            borderRadius: theme.roundness,
        },
        badgeRow: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 6,
        },
        badge: {
            alignSelf: 'flex-start',
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: theme.roundness,
            backgroundColor: theme.colors.secondaryContainer,
        },
        badgeText: {
            color: theme.colors.onSecondaryContainer,
            fontSize: 11,
            fontWeight: '700',
        },
        row: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing.gap,
        },
        selector: {
            flexGrow: 1,
            minWidth: 140,
            paddingHorizontal: theme.padding.s,
            paddingVertical: theme.padding.s,
            borderRadius: theme.roundness,
            borderWidth: 1,
        },
        selectorTitle: {
            fontWeight: '700',
            marginBottom: 4,
        },
        selectorBody: {
            fontSize: 12,
        },
        actionButton: {
            minWidth: 120,
            paddingHorizontal: theme.padding.m,
            paddingVertical: theme.padding.s,
            borderRadius: theme.roundness,
            alignItems: 'center',
            justifyContent: 'center',
        },
        actionLabel: {
            fontWeight: '700',
        },
        resultCard: {
            gap: 8,
            padding: theme.padding.s,
            backgroundColor: theme.colors.surfaceVariant,
            borderRadius: theme.roundness,
        },
        resultMeta: {
            color: theme.colors.onSurfaceVariant,
            fontSize: 12,
        },
        transcriptCard: {
            gap: 8,
            padding: theme.padding.s,
            borderRadius: theme.roundness,
            backgroundColor: theme.colors.secondaryContainer,
        },
        transcriptText: {
            color: theme.colors.onSecondaryContainer,
        },
    })

function formatMs(value?: number): string {
    if (value == null) return 'n/a'
    return `${Math.round(value)} ms`
}

function formatRatio(value?: number): string {
    if (value == null || !Number.isFinite(value)) return 'n/a'
    return `${value.toFixed(2)}×`
}

function ResultCard({ result }: { result: AsrBenchmarkResult }) {
    const theme = useTheme()
    const styles = useMemo(() => getStyles(theme), [theme])
    const metricLine =
        result.mode === 'sample'
            ? `init ${formatMs(result.initMs)} | recognize ${formatMs(result.recognizeMs)}`
            : `init ${formatMs(result.initMs)} | first partial ${formatMs(result.firstPartialMs)} | first commit ${formatMs(result.firstCommitMs)}`

    return (
        <View style={styles.resultCard}>
            <Text style={styles.selectorTitle}>
                {result.modelName} • {result.engine}
            </Text>
            <Text style={styles.resultMeta}>
                {result.mode === 'sample'
                    ? `Sample${result.sampleName ? ` • ${result.sampleName}` : ''}`
                    : `Simulated live${result.sampleName ? ` • ${result.sampleName}` : ''}`}
                {' • '}
                {metricLine}
                {result.sessionMs != null ? ` • session ${formatMs(result.sessionMs)}` : ''}
            </Text>
            {result.mode === 'simulated' ? (
                <>
                    <Text style={styles.resultMeta}>
                        runtime {result.runtime} • audio {formatMs(result.audioDurationMs)} • chunks{' '}
                        {result.chunkCount ?? 0}
                    </Text>
                    <Text style={styles.resultMeta}>
                        processing RTF {formatRatio(result.processingRealTimeFactor)} • wall RTF{' '}
                        {formatRatio(result.wallRealTimeFactor)} • max backlog{' '}
                        {formatMs(result.maxBacklogMs)}
                    </Text>
                    <Text style={styles.resultMeta}>
                        partials {result.partialCount ?? 0} • commits {result.commitCount ?? 0} •
                        max chunk {formatMs(result.maxChunkProcessingMs)}
                    </Text>
                </>
            ) : null}
            {result.segmentCount != null ? (
                <Text style={styles.resultMeta}>segments {result.segmentCount}</Text>
            ) : null}
            {result.validationKind === 'word-timestamps' ? (
                <Text style={styles.resultMeta}>
                    lines {result.lineCount ?? 0} • lines with words {result.linesWithWords ?? 0}
                    {' • '}
                    words {result.wordCount ?? 0}
                </Text>
            ) : null}
            <Text>{result.error || result.transcript || 'No transcript returned'}</Text>
            {result.notes ? <Text style={styles.resultMeta}>{result.notes}</Text> : null}
        </View>
    )
}

export default function AsrBenchmarkScreen() {
    const theme = useTheme()
    const styles = useMemo(() => getStyles(theme), [theme])
    const {
        benchmarkModels,
        clearResults,
        error,
        mobileRecommendationModels,
        mode,
        modelStatuses,
        prepareSelectedModel,
        processing,
        results,
        runAllSampleBenchmarks,
        runSelectedSampleBenchmark,
        runSelectedSimulatedBenchmark,
        runSelectedWordTimestampValidation,
        samples,
        selectedModel,
        selectedModelId,
        selectedModelStatus,
        selectedSample,
        selectedSampleId,
        setMode,
        setSelectedModelId,
        setSelectedSampleId,
        simulatedBenchmarkModels,
        simulatedCommittedText,
        simulatedInterimText,
        simulationIsRunning,
        statusMessage,
    } = useAsrBenchmark()

    const visibleModels = mode === 'simulated' ? simulatedBenchmarkModels : benchmarkModels
    const modeSwitchDisabled = processing || simulationIsRunning
    const practicalMatrixDisabled = processing || simulationIsRunning || Platform.OS === 'web'
    const mobileRecommendationModelIds = useMemo(
        () => mobileRecommendationModels.map((model) => model.id),
        [mobileRecommendationModels],
    )
    const mobileRecommendationModelCountLabel =
        mobileRecommendationModels.length === 1
            ? '1 mobile-safe row'
            : `${mobileRecommendationModels.length} mobile-safe rows`

    useEffect(() => {
        setAgenticPageState({
            benchmarkModelCount: benchmarkModels.length,
            error: error || null,
            mobileRecommendationModelCount: mobileRecommendationModelIds.length,
            mobileRecommendationModelIds,
            simulatedBenchmarkModelCount: simulatedBenchmarkModels.length,
            simulatedCommittedText: simulatedCommittedText || null,
            simulatedInterimText: simulatedInterimText || null,
            simulationIsRunning,
            mode,
            processing,
            resultsCount: results.length,
            selectedModelDownloaded: selectedModelStatus.downloaded,
            selectedModelEngine: selectedModel?.engine ?? null,
            selectedModelId,
            selectedModelLocalPath: selectedModelStatus.localPath,
            selectedModelName: selectedModel?.name ?? null,
            selectedSampleId,
            selectedSampleName: selectedSample?.name ?? null,
            statusMessage: statusMessage || null,
            statuses: Object.fromEntries(
                Object.entries(modelStatuses).map(([key, value]) => [
                    key,
                    {
                        downloaded: value.downloaded,
                        localPath: value.localPath,
                    },
                ]),
            ),
            latestResult: results[0] ?? null,
        })
    }, [
        benchmarkModels.length,
        error,
        mobileRecommendationModelIds,
        mode,
        modelStatuses,
        processing,
        results,
        selectedModel?.engine,
        selectedModel?.name,
        selectedModelId,
        selectedModelStatus.downloaded,
        selectedModelStatus.localPath,
        selectedSample?.name,
        selectedSampleId,
        simulatedBenchmarkModels.length,
        simulatedCommittedText,
        simulatedInterimText,
        simulationIsRunning,
        statusMessage,
    ])

    if (!__DEV__) {
        return <Redirect href="/(tabs)/more" />
    }

    return (
        <ScreenWrapper withScrollView useInsets={false} contentContainerStyle={styles.container}>
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>ASR Benchmark</Text>
                <Text style={styles.sectionBody}>
                    Dev-only recommendation surface for live Moonshine transcription, Sherpa speaker
                    turns, segmented offline Sherpa ASR, and EchoBridge Whisper parity.
                </Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Mobile Recommendation Workflow</Text>
                <View style={styles.recommendationGrid}>
                    {[
                        {
                            title: 'True live transcript',
                            body: 'Benchmark Moonshine with RTF/backlog gates before choosing a default. Use Qwen3/Whisper as delayed or final-quality passes, not instant captions.',
                        },
                        {
                            title: 'Live speaker turns',
                            body: 'Use Sherpa VAD + Speaker ID for tentative live speaker turns, then rely on offline diarization for final quality.',
                        },
                        {
                            title: 'Delayed high-quality live',
                            body: 'Use Sherpa Qwen3 INT8 as a rolling-window candidate when higher quality is worth delayed segment updates.',
                        },
                        {
                            title: 'Default file matrix',
                            body: `The Practical File Matrix runs ${mobileRecommendationModelCountLabel}: Moonshine, Qwen3, and Whisper rows for repeatable file-quality comparison. Use Simulated Live per Moonshine model, or the direct runner, for RTF/backlog gates.`,
                        },
                    ].map((item) => (
                        <View key={item.title} style={styles.recommendationCard}>
                            <Text style={styles.selectorTitle}>{item.title}</Text>
                            <Text style={styles.selectorBody}>{item.body}</Text>
                        </View>
                    ))}
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Mode</Text>
                <View style={styles.row}>
                    {/*
                      Live mic replay is intentionally disabled for now because speaker-to-room-to-mic
                      acoustics make engine-to-engine comparisons noisy. Re-enable it later as a
                      separate robustness pass once the file-driven benchmark is stable.
                    */}
                    {[
                        { id: 'sample', label: 'Bundled Sample' },
                        { id: 'simulated', label: 'Simulated Live' },
                    ].map((item) => {
                        const selected = mode === item.id
                        return (
                            <Pressable
                                key={item.id}
                                testID={`asr-benchmark-mode-${item.id}`}
                                accessibilityRole="button"
                                disabled={modeSwitchDisabled}
                                onPress={() => setMode(item.id as 'sample' | 'simulated')}
                                style={[
                                    styles.selector,
                                    {
                                        borderColor: selected
                                            ? theme.colors.primary
                                            : theme.colors.outlineVariant,
                                        backgroundColor: selected
                                            ? theme.colors.primaryContainer
                                            : theme.colors.surface,
                                        opacity: modeSwitchDisabled ? 0.6 : 1,
                                    },
                                ]}
                            >
                                <Text style={styles.selectorTitle}>{item.label}</Text>
                                <Text style={styles.selectorBody}>
                                    {item.id === 'sample'
                                        ? 'Transcribe the exact file as-is'
                                        : 'Feed the exact file in timed chunks'}
                                </Text>
                            </Pressable>
                        )
                    })}
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Model</Text>
                <View style={styles.row}>
                    {visibleModels.map((model) => {
                        const selected = model.id === selectedModelId
                        const downloaded = modelStatuses[model.id]?.downloaded ?? false
                        return (
                            <Pressable
                                key={model.id}
                                testID={`asr-benchmark-model-${model.id}`}
                                accessibilityRole="button"
                                disabled={processing || simulationIsRunning}
                                onPress={() => setSelectedModelId(model.id)}
                                style={[
                                    styles.selector,
                                    {
                                        borderColor: selected
                                            ? theme.colors.primary
                                            : theme.colors.outlineVariant,
                                        backgroundColor: selected
                                            ? theme.colors.primaryContainer
                                            : theme.colors.surface,
                                        opacity: processing || simulationIsRunning ? 0.6 : 1,
                                    },
                                ]}
                            >
                                <Text style={styles.selectorTitle}>{model.name}</Text>
                                <Text style={styles.selectorBody}>
                                    {model.engine} • {downloaded ? 'downloaded' : 'not downloaded'}
                                </Text>
                                {model.recommendationLabel ? (
                                    <View style={styles.badgeRow}>
                                        <View style={styles.badge}>
                                            <Text style={styles.badgeText}>
                                                {model.recommendationTier === 'avoid-default'
                                                    ? `Default-off: ${model.recommendationLabel}`
                                                    : model.recommendationLabel}
                                            </Text>
                                        </View>
                                        {model.estimatedSizeLabel ? (
                                            <View style={styles.badge}>
                                                <Text style={styles.badgeText}>
                                                    {model.estimatedSizeLabel}
                                                </Text>
                                            </View>
                                        ) : null}
                                    </View>
                                ) : null}
                                {model.recommendedUse ? (
                                    <Text style={styles.selectorBody}>{model.recommendedUse}</Text>
                                ) : null}
                                <Text style={styles.selectorBody}>{model.rationale}</Text>
                                {model.warningLabel ? (
                                    <Text style={styles.selectorBody}>
                                        Note: {model.warningLabel}
                                    </Text>
                                ) : null}
                            </Pressable>
                        )
                    })}
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Sample</Text>
                <View style={styles.row}>
                    {samples.map((sample) => {
                        const selected = sample.id === selectedSampleId
                        return (
                            <Pressable
                                key={sample.id}
                                testID={`asr-benchmark-sample-${sample.id}`}
                                accessibilityRole="button"
                                disabled={processing || simulationIsRunning}
                                onPress={() => setSelectedSampleId(sample.id)}
                                style={[
                                    styles.selector,
                                    {
                                        borderColor: selected
                                            ? theme.colors.primary
                                            : theme.colors.outlineVariant,
                                        backgroundColor: selected
                                            ? theme.colors.primaryContainer
                                            : theme.colors.surface,
                                        opacity: processing || simulationIsRunning ? 0.6 : 1,
                                    },
                                ]}
                            >
                                <Text style={styles.selectorTitle}>{sample.name}</Text>
                            </Pressable>
                        )
                    })}
                </View>
            </View>

            {mode === 'sample' ? (
                <View style={styles.section}>
                    <Text style={styles.sectionBody}>
                        Offline file transcription on the exact sample bytes.
                    </Text>
                </View>
            ) : (
                <View style={styles.section}>
                    <Text style={styles.sectionBody}>
                        Simulated live feeds the exact sample into the engine in timed chunks,
                        without room or microphone acoustics.
                    </Text>
                </View>
            )}

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Actions</Text>
                <View style={styles.row}>
                    <Pressable
                        testID="asr-benchmark-prepare-model"
                        accessibilityRole="button"
                        disabled={processing || simulationIsRunning}
                        onPress={() => {
                            void prepareSelectedModel()
                        }}
                        style={[
                            styles.actionButton,
                            {
                                backgroundColor: theme.colors.secondaryContainer,
                                opacity: processing || simulationIsRunning ? 0.6 : 1,
                            },
                        ]}
                    >
                        <Text
                            style={[
                                styles.actionLabel,
                                { color: theme.colors.onSecondaryContainer },
                            ]}
                        >
                            Prepare Model
                        </Text>
                    </Pressable>

                    {mode === 'sample' ? (
                        <>
                            <Pressable
                                testID="asr-benchmark-run-sample"
                                accessibilityRole="button"
                                disabled={processing || simulationIsRunning}
                                onPress={() => {
                                    void runSelectedSampleBenchmark()
                                }}
                                style={[
                                    styles.actionButton,
                                    {
                                        backgroundColor: theme.colors.primary,
                                        opacity: processing || simulationIsRunning ? 0.6 : 1,
                                    },
                                ]}
                            >
                                <Text
                                    style={[styles.actionLabel, { color: theme.colors.onPrimary }]}
                                >
                                    Run Sample
                                </Text>
                            </Pressable>

                            <Pressable
                                testID="asr-benchmark-run-all"
                                accessibilityRole="button"
                                disabled={practicalMatrixDisabled}
                                onPress={() => {
                                    void runAllSampleBenchmarks()
                                }}
                                style={[
                                    styles.actionButton,
                                    {
                                        backgroundColor: theme.colors.tertiaryContainer,
                                        opacity: practicalMatrixDisabled ? 0.6 : 1,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.actionLabel,
                                        {
                                            color: theme.colors.onTertiaryContainer,
                                        },
                                    ]}
                                >
                                    Run Practical File Matrix
                                </Text>
                            </Pressable>
                            <Text style={styles.sectionBody}>
                                {Platform.OS === 'web'
                                    ? `Practical Matrix is Android/iOS-only; it covers ${mobileRecommendationModelCountLabel} when run on device.`
                                    : `Runs ${mobileRecommendationModelCountLabel} on the selected sample; skips opt-in stress models.`}
                            </Text>

                            <Pressable
                                testID="asr-benchmark-run-word-timestamps"
                                accessibilityRole="button"
                                disabled={processing || simulationIsRunning}
                                onPress={() => {
                                    void runSelectedWordTimestampValidation()
                                }}
                                style={[
                                    styles.actionButton,
                                    {
                                        backgroundColor: theme.colors.secondaryContainer,
                                        opacity: processing || simulationIsRunning ? 0.6 : 1,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.actionLabel,
                                        {
                                            color: theme.colors.onSecondaryContainer,
                                        },
                                    ]}
                                >
                                    Validate Word Timestamps
                                </Text>
                            </Pressable>
                        </>
                    ) : (
                        <Pressable
                            testID="asr-benchmark-run-simulated"
                            accessibilityRole="button"
                            disabled={processing}
                            onPress={() => {
                                void runSelectedSimulatedBenchmark()
                            }}
                            style={[
                                styles.actionButton,
                                {
                                    backgroundColor: theme.colors.primary,
                                    opacity: processing ? 0.6 : 1,
                                },
                            ]}
                        >
                            <Text style={[styles.actionLabel, { color: theme.colors.onPrimary }]}>
                                Run Simulated Live
                            </Text>
                        </Pressable>
                    )}

                    <Pressable
                        testID="asr-benchmark-clear-results"
                        accessibilityRole="button"
                        disabled={processing || simulationIsRunning}
                        onPress={clearResults}
                        style={[
                            styles.actionButton,
                            {
                                backgroundColor: theme.colors.surfaceVariant,
                                opacity: processing || simulationIsRunning ? 0.6 : 1,
                            },
                        ]}
                    >
                        <Text
                            style={[styles.actionLabel, { color: theme.colors.onSurfaceVariant }]}
                        >
                            Clear Results
                        </Text>
                    </Pressable>
                </View>
            </View>

            {statusMessage ? <Notice type="info" title="Status" message={statusMessage} /> : null}

            {error ? <Notice type="error" title="Error" message={error} /> : null}

            {mode === 'simulated' ? (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Simulated Live Transcript</Text>
                    <View style={styles.transcriptCard}>
                        <Text style={styles.transcriptText}>
                            {simulatedCommittedText || 'No committed text yet'}
                        </Text>
                        <Text style={styles.transcriptText}>
                            {simulatedInterimText
                                ? `… ${simulatedInterimText}`
                                : 'Waiting for partials'}
                        </Text>
                        <Text style={styles.sectionBody}>
                            {simulationIsRunning
                                ? 'Running simulated live benchmark'
                                : 'Simulation idle'}
                        </Text>
                    </View>
                </View>
            ) : null}

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Results</Text>
                {results.length === 0 ? (
                    <Text style={styles.sectionBody}>No benchmark results yet.</Text>
                ) : (
                    <View style={{ gap: theme.spacing.gap }}>
                        {results.map((result) => (
                            <ResultCard
                                key={`${result.createdAt}-${result.modelId}-${result.mode}`}
                                result={result}
                            />
                        ))}
                    </View>
                )}
            </View>
        </ScreenWrapper>
    )
}
