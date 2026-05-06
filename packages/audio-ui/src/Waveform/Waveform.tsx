import { Path } from '@shopify/react-native-skia'
import React, { useMemo } from 'react'

import type { WaveformBar } from '../types/waveform'

export interface WaveformTheme {
    color?: string
    strokeWidth?: number
    opacity?: number
}

export interface WaveformProps {
    activePoints: WaveformBar[]
    canvasHeight: number
    canvasWidth: number
    minAmplitude: number
    maxAmplitude: number
    theme?: WaveformTheme
    smoothing?: boolean
}

const DEFAULT_THEME: WaveformTheme = {
    color: '#007AFF',
    strokeWidth: 2,
    opacity: 1,
}

export function Waveform({
    activePoints,
    canvasHeight,
    canvasWidth,
    minAmplitude,
    maxAmplitude,
    theme = DEFAULT_THEME,
    smoothing = true,
}: WaveformProps) {
    const path = useMemo(() => {
        if (activePoints.length === 0) return ''

        const centerY = canvasHeight / 2
        const totalPoints = activePoints.length
        const pathData = activePoints.map(({ amplitude }, index) => {
            const x = (index / (totalPoints - 1)) * canvasWidth
            const normalizedAmplitude =
                (amplitude - minAmplitude) / (maxAmplitude - minAmplitude)
            const y = centerY - normalizedAmplitude * (canvasHeight / 2)
            return { x, y }
        })

        if (!pathData[0]) return ''

        let waveformPath = `M${pathData[0].x},${pathData[0].y}`

        if (smoothing) {
            // Create smooth curve using cubic bezier
            for (let i = 0; i < pathData.length - 1; i++) {
                const current = pathData[i]
                const next = pathData[i + 1]

                // Skip if either point is undefined
                if (!current || !next) continue

                const controlX = (current.x + next.x) / 2
                waveformPath += ` C${controlX},${current.y} ${controlX},${next.y} ${next.x},${next.y}`
            }
        } else {
            // Use linear interpolation for non-smooth path
            pathData.slice(1).forEach((point) => {
                if (point) {
                    waveformPath += ` L${point.x},${point.y}`
                }
            })
        }

        return waveformPath
    }, [
        activePoints,
        canvasHeight,
        canvasWidth,
        minAmplitude,
        maxAmplitude,
        smoothing,
    ])

    return path ? (
        <Path
            path={path}
            color={theme.color ?? DEFAULT_THEME.color}
            style="stroke"
            strokeWidth={theme.strokeWidth ?? DEFAULT_THEME.strokeWidth}
            opacity={theme.opacity ?? DEFAULT_THEME.opacity}
        />
    ) : null
}
