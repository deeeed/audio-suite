import { useMemo } from 'react'

import type { WaveformPoint } from '../types/waveform'

export type WaveformAmplitudeScale = 'linear' | 'sqrt' | 'log'

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
    dataPoints: WaveformPoint[]
    gap?: number
    minBarHeight?: number
    amplitudeRange?: { min: number; max: number }
    /**
     * Bar-height scaling mode.
     * - 'linear': raw amplitude / peak — accurate, but speech looks mostly flat
     *   because peaks dwarf typical syllable amplitude.
     * - 'sqrt' (default): perceptual compression — speech and music look like
     *   the audio you hear, not a physics plot.
     * - 'log': stronger compression for whisper-quiet content.
     */
    amplitudeScale?: WaveformAmplitudeScale
}

export interface UseWaveformLayoutResult {
    bars: WaveformLayoutBar[]
    barWidth: number
    amplitudeMin: number
    amplitudeMax: number
}

const LOG_FLOOR = 1e-4

function scaleAmplitude(
    value: number,
    peak: number,
    mode: WaveformAmplitudeScale
): number {
    if (peak <= 0) return 0
    const ratio = Math.max(0, Math.min(1, value / peak))
    switch (mode) {
        case 'linear':
            return ratio
        case 'log': {
            // Map ratio in [LOG_FLOOR, 1] to [0, 1] on a log scale.
            const r = Math.max(LOG_FLOOR, ratio)
            return (
                (Math.log10(r) - Math.log10(LOG_FLOOR)) / -Math.log10(LOG_FLOOR)
            )
        }
        case 'sqrt':
        default:
            return Math.sqrt(ratio)
    }
}

export function useWaveformLayout({
    width,
    height,
    dataPoints,
    gap = 1,
    minBarHeight = 1,
    amplitudeRange,
    amplitudeScale = 'sqrt',
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
        const peak = max > 0 ? max : 1

        // When the requested gap eats more pixels than we have bars, drop the
        // gap to 0 and let bars touch — anything else clips the canvas.
        const idealBarWidth = (width - gap * Math.max(0, n - 1)) / n
        const effectiveGap = idealBarWidth < 1 ? 0 : gap
        const barWidth = Math.max(
            0.5,
            (width - effectiveGap * Math.max(0, n - 1)) / n
        )
        const stride = barWidth + effectiveGap

        const bars: WaveformLayoutBar[] = new Array(n)
        for (let i = 0; i < n; i++) {
            const p = dataPoints[i]!
            const norm = scaleAmplitude(p.amplitude, peak, amplitudeScale)
            const h = Math.max(minBarHeight, norm * height)
            bars[i] = {
                index: i,
                x: i * stride,
                width: barWidth,
                height: h,
                silent: p.silent ?? false,
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
        amplitudeScale,
    ])
}
