import { MaterialIcons } from '@expo/vector-icons'
import React, { useCallback, useMemo, useState } from 'react'
import {
    GestureResponderEvent,
    LayoutChangeEvent,
    Pressable,
    StyleSheet,
    Text,
    View,
    ViewStyle,
} from 'react-native'

import { SilenceTrack } from '../WaveformPreview/SilenceTrack'
import { WaveformPreview } from '../WaveformPreview/WaveformPreview'
import type { WaveformAmplitudeScale } from '../hooks/useWaveformLayout'
import type { WaveformPoint } from '../types/waveform'
import {
    decimateDataPoints,
    decimateVoiceMask,
    pickBarCountForWidth,
} from '../utils/decimateDataPoints'

export type AudioPlayerWidgetDensity = 'compact' | 'comfortable' | 'chat'
export type AudioPlayerWidgetTransportPlacement =
    | 'bottom'
    | 'left'
    | 'right'
    | 'none'

export interface AudioPlayerWidgetProps {
    dataPoints: WaveformPoint[]
    width: number
    waveformHeight?: number
    density?: AudioPlayerWidgetDensity
    transportPlacement?: AudioPlayerWidgetTransportPlacement
    showTimeLabel?: boolean
    loading?: boolean
    disabled?: boolean
    errorMessage?: string
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
    textColor?: string
    statusColor?: string
    errorColor?: string
    disabledColor?: string
    iconColor?: string
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
    style?: ViewStyle
    testID?: string
}

function getDensityDefaults(density: AudioPlayerWidgetDensity) {
    switch (density) {
        case 'chat':
            return {
                padding: 6,
                borderRadius: 18,
                playButtonSize: 34,
                iconSize: 22,
                timeFontSize: 12,
            }
        case 'compact':
            return {
                padding: 6,
                borderRadius: 12,
                playButtonSize: 36,
                iconSize: 22,
                timeFontSize: 12,
            }
        case 'comfortable':
        default:
            return {
                padding: 8,
                borderRadius: 12,
                playButtonSize: 44,
                iconSize: 26,
                timeFontSize: 14,
            }
    }
}

function formatTime(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '00:00'
    const totalSec = Math.floor(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function hasSideTransport(placement: AudioPlayerWidgetTransportPlacement) {
    return placement === 'left' || placement === 'right'
}

function getStatusMessage(loading: boolean, errorMessage?: string) {
    if (errorMessage) return errorMessage
    return loading ? 'Loading audio…' : undefined
}

export function AudioPlayerWidget({
    dataPoints,
    width,
    waveformHeight,
    density = 'comfortable',
    transportPlacement = 'bottom',
    showTimeLabel = true,
    loading = false,
    disabled = false,
    errorMessage,
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
    textColor = '#1F2937',
    statusColor = '#64748B',
    errorColor = '#DC2626',
    disabledColor = '#CBD5E1',
    iconColor = '#FFFFFF',
    amplitudeScale = 'sqrt',
    pixelsPerBar = 3,
    voiceMask,
    style,
    testID = 'audio-player',
}: AudioPlayerWidgetProps) {
    const densityDefaults = getDensityDefaults(density)
    const resolvedWaveformHeight =
        waveformHeight ?? (density === 'chat' ? 40 : 64)
    const isDisabled = disabled || loading || Boolean(errorMessage)
    const inline = hasSideTransport(transportPlacement)
    const statusMessage = getStatusMessage(loading, errorMessage)

    // Measured width of the waveform area. Drives bar layout, playhead
    // position, and silence-track width — replaces the old hardcoded
    // `width - playButtonSize - 20` formula that ignored the time label and
    // produced visible truncation under side-transport placements.
    const [waveformWidth, setWaveformWidth] = useState(0)
    const handleWaveformLayout = useCallback((e: LayoutChangeEvent) => {
        const next = Math.floor(e.nativeEvent.layout.width)
        if (next > 0) {
            setWaveformWidth((prev) => (prev === next ? prev : next))
        }
    }, [])

    const renderPoints = useMemo(() => {
        if (waveformWidth <= 0) return []
        const target = pickBarCountForWidth(waveformWidth, pixelsPerBar)
        return decimateDataPoints(dataPoints, target)
    }, [dataPoints, waveformWidth, pixelsPerBar])

    const renderVoiceMask = useMemo(() => {
        if (!voiceMask || voiceMask.length === 0) return undefined
        if (voiceMask.length !== dataPoints.length) return undefined
        if (renderPoints.length === 0) return undefined
        return decimateVoiceMask(
            voiceMask,
            dataPoints.length,
            renderPoints.length
        )
    }, [voiceMask, dataPoints.length, renderPoints.length])

    const playheadX = useMemo(() => {
        if (durationMs <= 0 || waveformWidth <= 0) return 0
        const ratio = currentTimeMs / durationMs
        return Math.max(0, Math.min(waveformWidth, ratio * waveformWidth))
    }, [currentTimeMs, durationMs, waveformWidth])

    const handleCanvasPress = useCallback(
        (e: GestureResponderEvent) => {
            if (durationMs <= 0 || isDisabled || waveformWidth <= 0) return
            const x = e.nativeEvent.locationX
            const ratio = Math.max(0, Math.min(1, x / waveformWidth))
            onSeek(ratio * durationMs)
        },
        [durationMs, waveformWidth, onSeek, isDisabled]
    )

    const transport =
        transportPlacement === 'none' ? null : (
            <View style={styles.transport}>
                <Pressable
                    onPress={onPlayPause}
                    disabled={isDisabled}
                    style={[
                        styles.playButton,
                        {
                            width: densityDefaults.playButtonSize,
                            height: densityDefaults.playButtonSize,
                            borderRadius: densityDefaults.playButtonSize / 2,
                            backgroundColor: isDisabled
                                ? disabledColor
                                : accentColor,
                        },
                    ]}
                    testID={isPlaying ? `${testID}-pause` : `${testID}-play`}
                    accessibilityRole="button"
                    accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                >
                    <MaterialIcons
                        name={isPlaying ? 'pause' : 'play-arrow'}
                        size={densityDefaults.iconSize}
                        color={iconColor}
                    />
                </Pressable>
                {showTimeLabel ? (
                    <Text
                        testID={`${testID}-time`}
                        style={[
                            styles.time,
                            {
                                fontSize: densityDefaults.timeFontSize,
                                color: textColor,
                            },
                        ]}
                        numberOfLines={1}
                    >
                        {formatTime(currentTimeMs)} / {formatTime(durationMs)}
                    </Text>
                ) : null}
            </View>
        )

    return (
        <View
            testID={testID}
            style={[
                styles.container,
                {
                    width,
                    backgroundColor,
                    padding: densityDefaults.padding,
                    borderRadius: densityDefaults.borderRadius,
                },
                inline && styles.inlineContainer,
                style,
            ]}
        >
            {transportPlacement === 'left' ? transport : null}
            <View style={styles.waveformColumn}>
                <Pressable
                    onPress={handleCanvasPress}
                    disabled={isDisabled}
                    testID={`${testID}-canvas`}
                    accessibilityRole="adjustable"
                    accessibilityLabel="Seek bar"
                    style={styles.canvasPress}
                >
                    <View
                        onLayout={handleWaveformLayout}
                        style={[
                            styles.waveformArea,
                            { height: resolvedWaveformHeight },
                        ]}
                    >
                        {waveformWidth > 0 ? (
                            <>
                                <WaveformPreview
                                    dataPoints={renderPoints}
                                    width={waveformWidth}
                                    height={resolvedWaveformHeight}
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
                                            height: resolvedWaveformHeight,
                                            backgroundColor: playheadColor,
                                            opacity: isDisabled ? 0.4 : 1,
                                        },
                                    ]}
                                />
                            </>
                        ) : null}
                    </View>
                </Pressable>
                {showSilenceTrack && waveformWidth > 0 ? (
                    <SilenceTrack
                        dataPoints={renderPoints}
                        width={waveformWidth}
                        height={silenceTrackHeight}
                        color={silenceBandColor}
                        testID="silence-track"
                    />
                ) : null}
                {statusMessage ? (
                    <Text
                        testID={`${testID}-status`}
                        style={[
                            styles.status,
                            { color: statusColor },
                            errorMessage ? { color: errorColor } : undefined,
                        ]}
                        numberOfLines={1}
                    >
                        {statusMessage}
                    </Text>
                ) : null}
            </View>
            {transportPlacement === 'right' ? transport : null}
            {transportPlacement === 'bottom' ? transport : null}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        gap: 6,
    },
    playhead: {
        position: 'absolute',
        top: 0,
        width: 2,
    },
    inlineContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    waveformColumn: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    canvasPress: {
        width: '100%',
    },
    waveformArea: {
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
    },
    transport: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 6,
    },
    playButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    time: {
        fontVariant: ['tabular-nums'],
    },
    status: {
        fontSize: 12,
    },
})
