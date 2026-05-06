import React, { useMemo, useState } from 'react'

import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Button, Text } from 'react-native-paper'

import {
    AudioPlayerWidget,
    ChatRecordWidget,
    SilenceTrack,
    WaveformPreview,
    type AudioPlayerWidgetDensity,
    type AudioPlayerWidgetTransportPlacement,
    type ChatRecordWidgetState,
    type WaveformAmplitudeScale,
    type WaveformPoint,
} from '@siteed/audio-ui'
import { Notice } from '@siteed/design-system'

import { useScreenHeader } from '../hooks/useScreenHeader'

const DURATION_MS = 24_000
const POINT_COUNT = 96

function createDemoPoints(): WaveformPoint[] {
    return Array.from({ length: POINT_COUNT }, (_, index) => {
        const progress = index / Math.max(1, POINT_COUNT - 1)
        const envelope = 0.35 + 0.55 * Math.abs(Math.sin(progress * Math.PI * 3))
        const detail = 0.18 * Math.abs(Math.sin(index * 1.7))
        const amplitude = Math.min(1, envelope + detail)
        const silent = index % 12 < 3 || (index > 54 && index < 64)
        const startTimeMs = Math.round(progress * DURATION_MS)
        const endTimeMs = Math.round(((index + 1) / POINT_COUNT) * DURATION_MS)
        return {
            id: index,
            amplitude: silent ? amplitude * 0.18 : amplitude,
            rms: silent ? 0.006 : amplitude * 0.52,
            dB: silent ? -56 : -8 - amplitude * 12,
            silent,
            startTime: startTimeMs,
            endTime: endTimeMs,
            startTimeMs,
            endTimeMs,
            samples: 512,
            speech: { isActive: !silent, speakerId: index % 2 },
        }
    })
}

const DENSITIES: AudioPlayerWidgetDensity[] = ['compact', 'comfortable', 'chat']
const PLACEMENTS: AudioPlayerWidgetTransportPlacement[] = ['left', 'bottom', 'right', 'none']
const SCALES: WaveformAmplitudeScale[] = ['linear', 'sqrt', 'log']
const CHAT_STATES: ChatRecordWidgetState[] = [
    'idle',
    'recording',
    'paused',
    'processing',
    'ready',
    'error',
    'disabled',
]

export default function AudioUiWidgetsScreen() {
    const { width: windowWidth } = useWindowDimensions()
    const width = Math.min(560, Math.max(280, Math.floor(windowWidth - 32)))
    const compactWidth = Math.min(width, 420)
    const dataPoints = useMemo(createDemoPoints, [])
    const voiceMask = useMemo(() => dataPoints.map((point) => !point.silent), [dataPoints])
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTimeMs, setCurrentTimeMs] = useState(7_200)

    useScreenHeader({
        title: 'Audio UI Widgets',
        backBehavior: { fallbackUrl: '/more' },
    })

    return (
        <ScrollView contentContainerStyle={styles.container} testID="audio-ui-widgets-screen">
            <Notice
                type="info"
                title="Audio UI widget gallery"
                message="Static and interactive variants for the new waveform widgets. Use this page to visually smoke-test density, transport, silence, VAD coloring, and chat-recorder states without loading audio."
            />

            <Section title="WaveformPreview variants">
                <WaveformPreview
                    dataPoints={dataPoints}
                    width={width}
                    height={72}
                    showPlayButton
                    isPlaying={isPlaying}
                    onPlayPress={() => setIsPlaying((value) => !value)}
                    testID="audio-ui-waveform-preview-play"
                />
                {SCALES.map((scale) => (
                    <View key={scale} style={styles.variantBlock}>
                        <Text variant="labelLarge">Scale: {scale}</Text>
                        <WaveformPreview
                            dataPoints={dataPoints}
                            width={width}
                            height={56}
                            amplitudeScale={scale}
                            voiceMask={voiceMask}
                            barColor="#10B981"
                            silentBarColor="#CBD5E1"
                            backgroundColor="#F8FAFC"
                            testID={`audio-ui-waveform-preview-${scale}`}
                        />
                    </View>
                ))}
            </Section>

            <Section title="SilenceTrack variants">
                <Text variant="bodySmall">Merged contiguous silence bands</Text>
                <SilenceTrack
                    dataPoints={dataPoints}
                    width={width}
                    height={10}
                    color="#F97316"
                    backgroundColor="#FFF7ED"
                    testID="audio-ui-silence-track-merged"
                />
                <Text variant="bodySmall">Unmerged per-bar silence bands</Text>
                <SilenceTrack
                    dataPoints={dataPoints}
                    width={width}
                    height={10}
                    color="#7C3AED"
                    backgroundColor="#F5F3FF"
                    mergeContiguous={false}
                    testID="audio-ui-silence-track-unmerged"
                />
            </Section>

            <Section title="AudioPlayerWidget densities">
                {DENSITIES.map((density) => (
                    <View key={density} style={styles.variantBlock}>
                        <Text variant="labelLarge">Density: {density}</Text>
                        <AudioPlayerWidget
                            dataPoints={dataPoints}
                            width={width}
                            density={density}
                            currentTimeMs={currentTimeMs}
                            durationMs={DURATION_MS}
                            isPlaying={isPlaying}
                            showSilenceTrack
                            voiceMask={voiceMask}
                            onPlayPause={() => setIsPlaying((value) => !value)}
                            onSeek={setCurrentTimeMs}
                            testID={`audio-ui-player-density-${density}`}
                        />
                    </View>
                ))}
            </Section>

            <Section title="AudioPlayerWidget transport placements">
                {PLACEMENTS.map((placement) => (
                    <View key={placement} style={styles.variantBlock}>
                        <Text variant="labelLarge">Transport: {placement}</Text>
                        <AudioPlayerWidget
                            dataPoints={dataPoints}
                            width={width}
                            transportPlacement={placement}
                            currentTimeMs={currentTimeMs}
                            durationMs={DURATION_MS}
                            isPlaying={placement !== 'none' && isPlaying}
                            showSilenceTrack={placement !== 'none'}
                            onPlayPause={() => setIsPlaying((value) => !value)}
                            onSeek={setCurrentTimeMs}
                            testID={`audio-ui-player-transport-${placement}`}
                        />
                    </View>
                ))}
            </Section>

            <Section title="AudioPlayerWidget loading and error states">
                <AudioPlayerWidget
                    dataPoints={[]}
                    width={width}
                    loading
                    currentTimeMs={0}
                    durationMs={0}
                    isPlaying={false}
                    onPlayPause={() => undefined}
                    onSeek={() => undefined}
                    testID="audio-ui-player-loading"
                />
                <AudioPlayerWidget
                    dataPoints={dataPoints}
                    width={width}
                    errorMessage="Preview extraction failed"
                    currentTimeMs={0}
                    durationMs={DURATION_MS}
                    isPlaying={false}
                    onPlayPause={() => undefined}
                    onSeek={() => undefined}
                    testID="audio-ui-player-error"
                />
            </Section>

            <Section title="ChatRecordWidget states">
                {CHAT_STATES.map((state) => (
                    <ChatRecordWidget
                        key={state}
                        state={state}
                        width={compactWidth}
                        dataPoints={
                            state === 'idle' || state === 'error' ? [] : dataPoints.slice(0, 56)
                        }
                        elapsedMs={state === 'idle' ? 0 : 42_000}
                        errorMessage="Microphone unavailable"
                        onRecordPress={() => undefined}
                        onStopPress={() => undefined}
                        onPausePress={() => undefined}
                        onResumePress={() => undefined}
                        onRetryPress={() => undefined}
                        cancelSlot={<Button compact>Cancel</Button>}
                        sendSlot={state === 'ready' ? <Button compact>Send</Button> : undefined}
                        testID={`audio-ui-chat-record-${state}`}
                    />
                ))}
            </Section>
        </ScrollView>
    )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={styles.section}>
            <Text variant="titleMedium">{title}</Text>
            {children}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        padding: 16,
        gap: 16,
    },
    section: {
        gap: 12,
        padding: 12,
        borderRadius: 12,
        backgroundColor: '#FFFFFF',
    },
    variantBlock: {
        gap: 6,
    },
})
