import { MaterialIcons } from '@expo/vector-icons'
import React from 'react'
import {
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

import { useAudioPlayerWidgetState } from './useAudioPlayerWidgetState'

export type AudioPlayerWidgetDensity = 'compact' | 'comfortable' | 'chat'
export type AudioPlayerWidgetTransportPlacement =
    | 'bottom'
    | 'left'
    | 'right'
    | 'none'

export type AudioPlayerWidgetIconName = keyof typeof MaterialIcons.glyphMap

/**
 * Context handed to `renderTransport`. Lets a custom transport render anything
 * (compound buttons, volume sliders, scrubbers) while staying in sync with the
 * widget's playback state.
 */
export interface AudioPlayerWidgetTransportContext {
    isPlaying: boolean
    isDisabled: boolean
    currentTimeMs: number
    durationMs: number
    formatTime: (ms: number) => string
    onPlayPause: () => void
    /**
     * Default density-derived sizing — caller can ignore or honor.
     * Tweak via the `playButtonSize` / `iconSize` / `timeFontSize` overrides.
     */
    sizing: {
        playButtonSize: number
        iconSize: number
        timeFontSize: number
    }
    /** Resolved colors so custom transports stay theme-aware. */
    colors: {
        accentColor: string
        disabledColor: string
        iconColor: string
        textColor: string
    }
}

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
    /** Color for bars behind the playhead. Off by default. */
    playedBarColor?: string
    /** Color for silent / non-voice bars behind the playhead. Defaults to playedBarColor. */
    playedSilentBarColor?: string
    /** Render the moving playhead line. Default true. Pair with `playedBarColor` for a fill-only look. */
    showPlayhead?: boolean
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
     * Optional fixed amplitude range. When set, bars are normalized against
     * this range instead of the running peak — pin to `{ min: 0, max: 1 }`
     * for live recording so previously-rendered bars don't rescale when a
     * loud sample arrives.
     */
    amplitudeRange?: { min: number; max: number }
    /**
     * Approximate pixels-per-bar density. Default 3 — renders cleanly on phone
     * widths without sub-pixel overlap.
     */
    pixelsPerBar?: number
    /**
     * Pixels of empty space between adjacent bars. Default 1. Bump to 2-3 to
     * mimic Simform's `candleSpace` look; drop to 0 for a continuous wash.
     */
    barGap?: number
    /**
     * Optional per-`dataPoint` voice mask. Same length as `dataPoints` —
     * bars are colored by voice activity instead of the amplitude-threshold
     * `silent` flag. Real-VAD callers should drive this.
     */
    voiceMask?: boolean[]
    /**
     * Replace the default play button + time label with a fully custom node.
     * Receives playback state, computed sizing, and resolved colors so a
     * custom transport stays theme- and density-aware.
     */
    renderTransport?: (ctx: AudioPlayerWidgetTransportContext) => React.ReactNode
    /** Override the default `MM:SS` time formatter. */
    formatTime?: (ms: number) => string
    /** MaterialIcons name to use when paused (default `play-arrow`). */
    playIcon?: AudioPlayerWidgetIconName
    /** MaterialIcons name to use when playing (default `pause`). */
    pauseIcon?: AudioPlayerWidgetIconName
    /** Render arbitrary content above the waveform area. */
    topSlot?: React.ReactNode
    /** Render arbitrary content below the waveform / silence track. */
    bottomSlot?: React.ReactNode
    /** Override density's play button diameter. */
    playButtonSize?: number
    /** Override density's icon size. */
    iconSize?: number
    /** Override density's container padding. */
    padding?: number
    /** Override density's container border radius. */
    borderRadius?: number
    /** Override density's time-label font size. */
    timeFontSize?: number
    style?: ViewStyle
    testID?: string
}

interface DensityDefaults {
    padding: number
    borderRadius: number
    playButtonSize: number
    iconSize: number
    timeFontSize: number
}

function getDensityDefaults(density: AudioPlayerWidgetDensity): DensityDefaults {
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
    playedBarColor,
    playedSilentBarColor,
    showPlayhead = true,
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
    amplitudeRange,
    pixelsPerBar = 3,
    barGap = 1,
    voiceMask,
    renderTransport,
    formatTime,
    playIcon = 'play-arrow',
    pauseIcon = 'pause',
    topSlot,
    bottomSlot,
    playButtonSize: playButtonSizeOverride,
    iconSize: iconSizeOverride,
    padding: paddingOverride,
    borderRadius: borderRadiusOverride,
    timeFontSize: timeFontSizeOverride,
    style,
    testID = 'audio-player',
}: AudioPlayerWidgetProps) {
    const densityDefaults = getDensityDefaults(density)
    const sizing: DensityDefaults = {
        padding: paddingOverride ?? densityDefaults.padding,
        borderRadius: borderRadiusOverride ?? densityDefaults.borderRadius,
        playButtonSize: playButtonSizeOverride ?? densityDefaults.playButtonSize,
        iconSize: iconSizeOverride ?? densityDefaults.iconSize,
        timeFontSize: timeFontSizeOverride ?? densityDefaults.timeFontSize,
    }
    const resolvedWaveformHeight =
        waveformHeight ?? (density === 'chat' ? 40 : 64)
    const isDisabled = disabled || loading || Boolean(errorMessage)
    const inline = hasSideTransport(transportPlacement)
    const statusMessage = getStatusMessage(loading, errorMessage)

    const {
        onLayout: handleWaveformLayout,
        measuredWidth: waveformWidth,
        renderPoints,
        renderVoiceMask,
        playheadX,
        handleCanvasPress,
        formatTime: resolvedFormatTime,
    } = useAudioPlayerWidgetState({
        dataPoints,
        voiceMask,
        currentTimeMs,
        durationMs,
        onSeek,
        pixelsPerBar,
        disabled: isDisabled,
        formatTime,
    })

    const transport: React.ReactNode = (() => {
        if (transportPlacement === 'none') return null
        if (renderTransport) {
            return renderTransport({
                isPlaying,
                isDisabled,
                currentTimeMs,
                durationMs,
                formatTime: resolvedFormatTime,
                onPlayPause,
                sizing: {
                    playButtonSize: sizing.playButtonSize,
                    iconSize: sizing.iconSize,
                    timeFontSize: sizing.timeFontSize,
                },
                colors: { accentColor, disabledColor, iconColor, textColor },
            })
        }
        return (
            <View style={styles.transport}>
                <Pressable
                    onPress={onPlayPause}
                    disabled={isDisabled}
                    style={[
                        styles.playButton,
                        {
                            width: sizing.playButtonSize,
                            height: sizing.playButtonSize,
                            borderRadius: sizing.playButtonSize / 2,
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
                        name={isPlaying ? pauseIcon : playIcon}
                        size={sizing.iconSize}
                        color={iconColor}
                    />
                </Pressable>
                {showTimeLabel ? (
                    <Text
                        testID={`${testID}-time`}
                        style={[
                            styles.time,
                            { fontSize: sizing.timeFontSize, color: textColor },
                        ]}
                        numberOfLines={1}
                    >
                        {resolvedFormatTime(currentTimeMs)} /{' '}
                        {resolvedFormatTime(durationMs)}
                    </Text>
                ) : null}
            </View>
        )
    })()

    return (
        <View
            testID={testID}
            style={[
                styles.container,
                {
                    width,
                    backgroundColor,
                    padding: sizing.padding,
                    borderRadius: sizing.borderRadius,
                },
                inline && styles.inlineContainer,
                style,
            ]}
        >
            {transportPlacement === 'left' ? transport : null}
            <View style={styles.waveformColumn}>
                {topSlot}
                <View
                    onLayout={handleWaveformLayout}
                    onStartShouldSetResponder={() => !isDisabled}
                    onMoveShouldSetResponder={() => !isDisabled}
                    onResponderGrant={handleCanvasPress}
                    onResponderMove={handleCanvasPress}
                    onResponderRelease={handleCanvasPress}
                    onResponderTerminationRequest={() => false}
                    testID={`${testID}-canvas`}
                    accessible
                    accessibilityRole="adjustable"
                    accessibilityLabel="Seek bar"
                    accessibilityState={{ disabled: isDisabled }}
                    accessibilityValue={
                        durationMs > 0
                            ? {
                                  min: 0,
                                  max: Math.max(1, Math.round(durationMs)),
                                  now: Math.max(0, Math.round(currentTimeMs)),
                                  text: `${resolvedFormatTime(currentTimeMs)} of ${resolvedFormatTime(durationMs)}`,
                              }
                            : undefined
                    }
                    onAccessibilityAction={(event) => {
                        if (durationMs <= 0 || isDisabled || !onSeek) return
                        // VoiceOver / TalkBack call increment/decrement on
                        // role="adjustable". Step by 1/20th of the clip so
                        // both ends are reachable in 20 swipes.
                        const step = durationMs / 20
                        if (event.nativeEvent.actionName === 'increment') {
                            onSeek(Math.min(durationMs, currentTimeMs + step))
                        } else if (
                            event.nativeEvent.actionName === 'decrement'
                        ) {
                            onSeek(Math.max(0, currentTimeMs - step))
                        }
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
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
                                gap={barGap}
                                barColor={barColor}
                                silentBarColor={silentBarColor}
                                amplitudeScale={amplitudeScale}
                                amplitudeRange={amplitudeRange}
                                voiceMask={renderVoiceMask}
                                playedRatio={
                                    durationMs > 0
                                        ? currentTimeMs / durationMs
                                        : undefined
                                }
                                playedBarColor={playedBarColor}
                                playedSilentBarColor={playedSilentBarColor}
                                testID="waveform-preview"
                            />
                            {showPlayhead ? (
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
                            ) : null}
                        </>
                    ) : null}
                </View>
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
                {bottomSlot}
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
