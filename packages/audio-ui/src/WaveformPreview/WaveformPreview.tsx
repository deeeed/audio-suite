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
    amplitudeScale?: WaveformAmplitudeScale
    /**
     * Optional voice mask, one boolean per dataPoint. When supplied it
     * overrides the per-point `silent` flag for coloring: true → barColor
     * (voice), false → silentBarColor (non-voice). Lengths that don't match
     * `dataPoints.length` are ignored.
     */
    voiceMask?: boolean[]
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
    amplitudeScale = 'sqrt',
    voiceMask,
    testID = 'waveform-preview',
}: WaveformPreviewProps) {
    const { bars } = useWaveformLayout({
        width,
        height,
        dataPoints,
        gap,
        amplitudeScale,
    })
    const centerY = height / 2
    const useVoiceMask =
        Array.isArray(voiceMask) && voiceMask.length === bars.length

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
                    return (
                        <Rect
                            key={bar.index}
                            x={bar.x}
                            y={centerY - bar.height / 2}
                            width={bar.width}
                            height={bar.height}
                            color={inactive ? silentBarColor : barColor}
                        />
                    )
                })}
            </Canvas>
            {showPlayButton ? (
                <Pressable
                    onPress={onPlayPress}
                    style={styles.playButton}
                    testID={`${testID}-play-btn`}
                    accessibilityRole="button"
                    accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                >
                    <MaterialIcons
                        name={isPlaying ? 'pause' : 'play-arrow'}
                        size={22}
                        color={DEFAULT_BAR_COLOR}
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
        backgroundColor: 'rgba(255,255,255,0.92)',
        alignItems: 'center',
        justifyContent: 'center',
    },
})
