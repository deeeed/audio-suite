import React, { useMemo } from 'react'

import { Canvas, Rect } from '@shopify/react-native-skia'
import { View } from 'react-native'

import type { WaveformPoint } from '../types/waveform'

export interface SilenceTrackProps {
    dataPoints: WaveformPoint[]
    width: number
    height?: number
    color?: string
    backgroundColor?: string
    mergeContiguous?: boolean
    testID?: string
}

interface SilenceBand {
    x: number
    width: number
}

function computeBands(
    dataPoints: WaveformPoint[],
    width: number,
    merge: boolean
): SilenceBand[] {
    const n = dataPoints.length
    if (n === 0 || width <= 0) return []
    const segWidth = width / n
    const bands: SilenceBand[] = []

    if (!merge) {
        for (let i = 0; i < n; i++) {
            if (dataPoints[i]!.silent) {
                bands.push({ x: i * segWidth, width: segWidth })
            }
        }
        return bands
    }

    let runStart = -1
    for (let i = 0; i <= n; i++) {
        const isSilent = i < n && dataPoints[i]!.silent
        if (isSilent && runStart === -1) {
            runStart = i
        } else if (!isSilent && runStart !== -1) {
            bands.push({
                x: runStart * segWidth,
                width: (i - runStart) * segWidth,
            })
            runStart = -1
        }
    }
    return bands
}

const DEFAULT_COLOR = '#94A3B8'

export function SilenceTrack({
    dataPoints,
    width,
    height = 6,
    color = DEFAULT_COLOR,
    backgroundColor = 'transparent',
    mergeContiguous = true,
    testID = 'silence-track',
}: SilenceTrackProps) {
    const bands = useMemo(
        () => computeBands(dataPoints, width, mergeContiguous),
        [dataPoints, width, mergeContiguous]
    )

    return (
        <View testID={testID} style={{ width, height, backgroundColor }}>
            <Canvas style={{ width, height }} testID={`${testID}-canvas`}>
                {bands.map((b) => (
                    <Rect
                        key={`${b.x}:${b.width}`}
                        x={b.x}
                        y={0}
                        width={b.width}
                        height={height}
                        color={color}
                    />
                ))}
            </Canvas>
        </View>
    )
}
