import { useMemo } from 'react'

import type { DataPoint } from '@siteed/audio-studio'

export interface WaveformLayoutBar {
    index: number
    x: number
    width: number
    height: number
    silent: boolean
    amplitude: number
}

export interface UseWaveformLayoutOptions {
    width: number
    height: number
    dataPoints: DataPoint[]
    gap?: number
    minBarHeight?: number
    amplitudeRange?: { min: number; max: number }
}

export interface UseWaveformLayoutResult {
    bars: WaveformLayoutBar[]
    barWidth: number
    amplitudeMin: number
    amplitudeMax: number
}

export function useWaveformLayout({
    width,
    height,
    dataPoints,
    gap = 1,
    minBarHeight = 1,
    amplitudeRange,
}: UseWaveformLayoutOptions): UseWaveformLayoutResult {
    return useMemo(() => {
        const n = dataPoints.length
        if (n === 0 || width <= 0 || height <= 0) {
            return { bars: [], barWidth: 0, amplitudeMin: 0, amplitudeMax: 0 }
        }

        let min = amplitudeRange?.min ?? Number.POSITIVE_INFINITY
        let max = amplitudeRange?.max ?? Number.NEGATIVE_INFINITY
        if (!amplitudeRange) {
            for (let i = 0; i < n; i++) {
                const a = dataPoints[i]!.amplitude
                if (a < min) min = a
                if (a > max) max = a
            }
            if (!Number.isFinite(min)) min = 0
            if (!Number.isFinite(max)) max = 1
        }
        const range = max - min || 1

        const totalGap = gap * Math.max(0, n - 1)
        const barWidth = Math.max(1, (width - totalGap) / n)

        const bars: WaveformLayoutBar[] = new Array(n)
        for (let i = 0; i < n; i++) {
            const p = dataPoints[i]!
            const norm = (p.amplitude - min) / range
            const h = Math.max(minBarHeight, norm * height)
            bars[i] = {
                index: i,
                x: i * (barWidth + gap),
                width: barWidth,
                height: h,
                silent: p.silent,
                amplitude: p.amplitude,
            }
        }

        return { bars, barWidth, amplitudeMin: min, amplitudeMax: max }
    }, [
        width,
        height,
        dataPoints,
        gap,
        minBarHeight,
        amplitudeRange?.min,
        amplitudeRange?.max,
    ])
}
