import React from 'react'

import { MaterialIcons } from '@expo/vector-icons'
import { Canvas, Rect } from '@shopify/react-native-skia'
import { Pressable, StyleSheet, View } from 'react-native'

import type { WaveformPoint } from '../types/waveform'

import {
    useWaveformLayout,
    type WaveformAmplitudeScale,
} from '../hooks/useWaveformLayout'

export interface WaveformPreviewProps {
    dataPoints: WaveformPoint[]
    width: number
    height: number
    barColor?: string
    silentBarColor?: string
    backgroundColor?: string
    gap?: number
    showPlayButton?: boolean
    isPlaying?: boolean
    onPlayPress?: () => void
    playButtonBackgroundColor?: string
    playButtonIconColor?: string
    amplitudeScale?: WaveformAmplitudeScale
    /**
     * Optional fixed amplitude range. When supplied, bars are normalized
     * against this range instead of the running peak of `dataPoints`. Use
     * `{ min: 0, max: 1 }` for live recording so a sudden loud sample
     * doesn't rescale every previously-rendered bar (the auto-peak default
     * makes "same dB look different at different times").
     */
    amplitudeRange?: { min: number; max: number }
    /**
     * Optional voice mask, one boolean per dataPoint. When supplied it
     * overrides the per-point `silent` flag for coloring: true → barColor
     * (voice), false → silentBarColor (non-voice). Lengths that don't match
     * `dataPoints.length` are ignored.
     */
    voiceMask?: boolean[]
    /**
     * Fraction of the waveform that is "behind" the playhead (0-1). Bars
     * whose center falls within `playedRatio * width` are painted with
     * `playedBarColor` / `playedSilentBarColor` instead of the regular
     * pair, giving a Spotify-style progress fill without needing a moving
     * playhead line.
     */
    playedRatio?: number
    /** Color for played voice bars. No effect when `playedRatio` is unset. */
    playedBarColor?: string
    /** Color for played silent / non-voice bars. Defaults to playedBarColor. */
    playedSilentBarColor?: string
    testID?: string
}

const DEFAULT_BAR_COLOR = '#7C3AED'
const DEFAULT_SILENT_BAR_COLOR = '#C4B5FD'

export function WaveformPreview({
    dataPoints,
    width,
    height,
    barColor = DEFAULT_BAR_COLOR,
    silentBarColor = DEFAULT_SILENT_BAR_COLOR,
    backgroundColor = 'transparent',
    gap = 1,
    showPlayButton = false,
    isPlaying = false,
    onPlayPress,
    playButtonBackgroundColor = 'rgba(255,255,255,0.92)',
    playButtonIconColor = DEFAULT_BAR_COLOR,
    amplitudeScale = 'sqrt',
    amplitudeRange,
    voiceMask,
    playedRatio,
    playedBarColor,
    playedSilentBarColor,
    testID = 'waveform-preview',
}: WaveformPreviewProps) {
    const { bars } = useWaveformLayout({
        width,
        height,
        dataPoints,
        gap,
        amplitudeScale,
        amplitudeRange,
    })
    const centerY = height / 2
    const useVoiceMask =
        Array.isArray(voiceMask) && voiceMask.length === bars.length
    const playedX =
        typeof playedRatio === 'number' && playedBarColor
            ? Math.max(0, Math.min(1, playedRatio)) * width
            : -1
    const resolvedPlayedSilent = playedSilentBarColor ?? playedBarColor

    return (
        <View
            testID={testID}
            style={[styles.container, { width, height, backgroundColor }]}
        >
            <Canvas style={{ width, height }} testID={`${testID}-canvas`}>
                {bars.map((bar) => {
                    const inactive = useVoiceMask
                        ? !voiceMask[bar.index]
                        : bar.silent
                    const barCenter = bar.x + bar.width / 2
                    const isPlayed = playedX >= 0 && barCenter <= playedX
                    let color: string
                    if (isPlayed) {
                        color = inactive
                            ? (resolvedPlayedSilent ?? silentBarColor)
                            : (playedBarColor ?? barColor)
                    } else {
                        color = inactive ? silentBarColor : barColor
                    }
                    return (
                        <Rect
                            key={bar.index}
                            x={bar.x}
                            y={centerY - bar.height / 2}
                            width={bar.width}
                            height={bar.height}
                            color={color}
                        />
                    )
                })}
            </Canvas>
            {showPlayButton ? (
                <Pressable
                    onPress={onPlayPress}
                    style={[
                        styles.playButton,
                        { backgroundColor: playButtonBackgroundColor },
                    ]}
                    testID={`${testID}-play-btn`}
                    accessibilityRole="button"
                    accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                >
                    <MaterialIcons
                        name={isPlaying ? 'pause' : 'play-arrow'}
                        size={22}
                        color={playButtonIconColor}
                    />
                </Pressable>
            ) : null}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        position: 'relative',
        overflow: 'hidden',
    },
    playButton: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: 36,
        height: 36,
        marginLeft: -18,
        marginTop: -18,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
