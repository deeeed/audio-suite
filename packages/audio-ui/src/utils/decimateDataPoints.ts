import type { DataPoint } from '@siteed/audio-studio'

/**
 * Reduce a `DataPoint[]` down to `target` bins using peak-preserving binning.
 * - amplitude / rms: take the maximum in the bin (waveform readability)
 * - dB: take the minimum (most negative) so quiet bins stay quiet
 * - silent: a bin is silent only if every sub-point is silent
 *
 * If `target` is greater than or equal to the input length, the input is
 * returned unchanged.
 */
export function decimateDataPoints(
    points: DataPoint[],
    target: number,
): DataPoint[] {
    const n = points.length
    if (target <= 0 || n === 0) return []
    if (target >= n) return points

    const stride = n / target
    const out: DataPoint[] = new Array(target)
    for (let i = 0; i < target; i++) {
        const start = Math.floor(i * stride)
        const end = Math.max(start + 1, Math.min(n, Math.floor((i + 1) * stride)))

        let maxAmp = -Infinity
        let maxRms = -Infinity
        let minDb = Infinity
        let allSilent = true
        let firstId = -1
        let firstStart: number | undefined
        let lastEnd: number | undefined

        for (let k = start; k < end; k++) {
            const p = points[k]!
            if (p.amplitude > maxAmp) maxAmp = p.amplitude
            if (p.rms > maxRms) maxRms = p.rms
            if (p.dB < minDb) minDb = p.dB
            if (!p.silent) allSilent = false
            if (firstId === -1) {
                firstId = p.id
                firstStart = p.startTime
            }
            lastEnd = p.endTime
        }

        out[i] = {
            id: firstId,
            amplitude: Number.isFinite(maxAmp) ? maxAmp : 0,
            rms: Number.isFinite(maxRms) ? maxRms : 0,
            dB: Number.isFinite(minDb) ? minDb : -100,
            silent: allSilent,
            startTime: firstStart,
            endTime: lastEnd,
        }
    }
    return out
}

/**
 * Choose a sensible bar count for a given canvas width.
 * Default density is one bar per ~3 pixels — gives clean readability without
 * sub-pixel overlap and matches typical music-app waveform thumbnails.
 */
export function pickBarCountForWidth(
    width: number,
    pixelsPerBar = 3,
): number {
    if (width <= 0) return 0
    return Math.max(1, Math.floor(width / Math.max(1, pixelsPerBar)))
}
