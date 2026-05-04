import React, { useCallback, useMemo } from 'react'

import { MaterialIcons } from '@expo/vector-icons'
import {
    GestureResponderEvent,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native'

import type { DataPoint } from '@siteed/audio-studio'

import type { WaveformAmplitudeScale } from '../hooks/useWaveformLayout'
import {
    decimateDataPoints,
    decimateVoiceMask,
    pickBarCountForWidth,
} from '../utils/decimateDataPoints'
import { SilenceTrack } from '../WaveformPreview/SilenceTrack'
import { WaveformPreview } from '../WaveformPreview/WaveformPreview'

export interface AudioPlayerWidgetProps {
    dataPoints: DataPoint[]
    width: number
    waveformHeight?: number
    silenceTrackHeight?: number
    showSilenceTrack?: boolean
    currentTimeMs: number
    durationMs: number
    isPlaying: boolean
    onPlayPause: () => void
    onSeek: (timeMs: number) => void
    barColor?: string
    silentBarColor?: string
    silenceBandColor?: string
    playheadColor?: string
    backgroundColor?: string
    accentColor?: string
    amplitudeScale?: WaveformAmplitudeScale
    /**
     * Approximate pixels-per-bar density. Used to decimate the data points
     * down to a screen-friendly count. Default 3 — renders cleanly on phone
     * widths without sub-pixel overlap.
     */
    pixelsPerBar?: number
    /**
     * Optional per-`dataPoint` voice mask. When supplied (length matching
     * `dataPoints`), bars are colored by voice activity instead of the
     * amplitude-threshold `silent` flag. Real-VAD callers should drive this.
     */
    voiceMask?: boolean[]
    testID?: string
}

function formatTime(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '00:00'
    const totalSec = Math.floor(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function AudioPlayerWidget({
    dataPoints,
    width,
    waveformHeight = 64,
    silenceTrackHeight = 6,
    /**
     * Whether to render the amplitude-threshold silence ribbon below the bars.
     * Off by default — RMS-threshold silence is fragile for speech (it confuses
     * background noise with voice). For real voice/silence detection, layer
     * a VAD-driven track above this widget instead.
     */
    showSilenceTrack = false,
    currentTimeMs,
    durationMs,
    isPlaying,
    onPlayPause,
    onSeek,
    barColor,
    silentBarColor,
    silenceBandColor,
    playheadColor = '#1F2937',
    backgroundColor = '#F8FAFC',
    accentColor = '#7C3AED',
    amplitudeScale = 'sqrt',
    pixelsPerBar = 3,
    voiceMask,
    testID = 'audio-player',
}: AudioPlayerWidgetProps) {
    const renderPoints = useMemo(() => {
        const target = pickBarCountForWidth(width, pixelsPerBar)
        return decimateDataPoints(dataPoints, target)
    }, [dataPoints, width, pixelsPerBar])

    const renderVoiceMask = useMemo(() => {
        if (!voiceMask || voiceMask.length === 0) return undefined
        if (voiceMask.length !== dataPoints.length) return undefined
        return decimateVoiceMask(voiceMask, dataPoints.length, renderPoints.length)
    }, [voiceMask, dataPoints.length, renderPoints.length])

    const playheadX = useMemo(() => {
        if (durationMs <= 0) return 0
        const ratio = currentTimeMs / durationMs
        return Math.max(0, Math.min(width, ratio * width))
    }, [currentTimeMs, durationMs, width])

    const handleCanvasPress = useCallback(
        (e: GestureResponderEvent) => {
            if (durationMs <= 0) return
            const x = e.nativeEvent.locationX
            const ratio = Math.max(0, Math.min(1, x / width))
            onSeek(ratio * durationMs)
        },
        [durationMs, width, onSeek],
    )

    return (
        <View
            testID={testID}
            style={[styles.container, { width, backgroundColor }]}
        >
            <Pressable
                onPress={handleCanvasPress}
                testID={`${testID}-canvas`}
                accessibilityRole="adjustable"
                accessibilityLabel="Seek bar"
            >
                <View style={{ width, height: waveformHeight }}>
                    <WaveformPreview
                        dataPoints={renderPoints}
                        width={width}
                        height={waveformHeight}
                        barColor={barColor}
                        silentBarColor={silentBarColor}
                        amplitudeScale={amplitudeScale}
                        voiceMask={renderVoiceMask}
                        testID="waveform-preview"
                    />
                    <View
                        pointerEvents="none"
                        style={[
                            styles.playhead,
                            {
                                left: playheadX,
                                height: waveformHeight,
                                backgroundColor: playheadColor,
                            },
                        ]}
                    />
                </View>
            </Pressable>
            {showSilenceTrack ? (
                <SilenceTrack
                    dataPoints={renderPoints}
                    width={width}
                    height={silenceTrackHeight}
                    color={silenceBandColor}
                    testID="silence-track"
                />
            ) : null}
            <View style={styles.transport}>
                <Pressable
                    onPress={onPlayPause}
                    style={[styles.playButton, { backgroundColor: accentColor }]}
                    testID={isPlaying ? `${testID}-pause` : `${testID}-play`}
                    accessibilityRole="button"
                    accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                >
                    <MaterialIcons
                        name={isPlaying ? 'pause' : 'play-arrow'}
                        size={26}
                        color="#FFFFFF"
                    />
                </Pressable>
                <Text testID={`${testID}-time`} style={styles.time}>
                    {formatTime(currentTimeMs)} / {formatTime(durationMs)}
                </Text>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        gap: 6,
        padding: 8,
        borderRadius: 12,
    },
    playhead: {
        position: 'absolute',
        top: 0,
        width: 2,
    },
    transport: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 6,
    },
    playButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    time: {
        fontVariant: ['tabular-nums'],
        color: '#1F2937',
        fontSize: 14,
    },
})
