import { normalizeWaveformPoint } from '../types/waveform'
import type { WaveformBar, WaveformPoint } from '../types/waveform'

interface BarAccumulator {
    maxAmp: number
    maxRms: number
    minDb: number
    allSilent: boolean
    firstId: number
    firstStart?: number
    lastEnd?: number
}

function updateAccumulator(
    accumulator: BarAccumulator,
    point: WaveformPoint,
    fallbackId: number
): void {
    const rms = point.rms ?? point.amplitude
    const dB = point.dB ?? (rms > 0 ? 20 * Math.log10(rms) : -100)

    accumulator.maxAmp = Math.max(accumulator.maxAmp, point.amplitude)
    accumulator.maxRms = Math.max(accumulator.maxRms, rms)
    accumulator.minDb = Math.min(accumulator.minDb, dB)
    accumulator.allSilent &&= point.silent ?? false

    if (accumulator.firstId === -1) {
        accumulator.firstId =
            typeof point.id === 'number' ? point.id : fallbackId
        accumulator.firstStart = point.startTime
    }
    accumulator.lastEnd = point.endTime
}

function createBar(
    points: WaveformPoint[],
    start: number,
    end: number
): WaveformBar {
    const accumulator: BarAccumulator = {
        maxAmp: -Infinity,
        maxRms: -Infinity,
        minDb: Infinity,
        allSilent: true,
        firstId: -1,
    }

    points.slice(start, end).forEach((point, offset) => {
        updateAccumulator(accumulator, point, start + offset)
    })

    return {
        id: accumulator.firstId,
        amplitude: Number.isFinite(accumulator.maxAmp) ? accumulator.maxAmp : 0,
        rms: Number.isFinite(accumulator.maxRms) ? accumulator.maxRms : 0,
        dB: Number.isFinite(accumulator.minDb) ? accumulator.minDb : -100,
        silent: accumulator.allSilent,
        startTime: accumulator.firstStart,
        endTime: accumulator.lastEnd,
    }
}

function getBinRange(index: number, stride: number, sourceLength: number) {
    const start = Math.floor(index * stride)
    const end = Math.max(
        start + 1,
        Math.min(sourceLength, Math.floor((index + 1) * stride))
    )
    return { start, end }
}

/**
 * Reduce a `WaveformPoint[]` down to `target` bins using peak-preserving binning.
 * - amplitude / rms: take the maximum in the bin (waveform readability)
 * - dB: take the minimum (most negative) so quiet bins stay quiet
 * - silent: a bin is silent only if every sub-point is silent
 *
 * If `target` is greater than or equal to the input length, the input is
 * returned unchanged.
 */
export function decimateDataPoints(
    points: WaveformPoint[],
    target: number
): WaveformBar[] {
    const sourceLength = points.length
    if (target <= 0 || sourceLength === 0) return []
    if (target >= sourceLength) {
        return points.map((point, index) =>
            normalizeWaveformPoint(point, index)
        )
    }

    const stride = sourceLength / target
    return Array.from({ length: target }, (_, index) => {
        const { start, end } = getBinRange(index, stride, sourceLength)
        return createBar(points, start, end)
    })
}

/**
 * Choose a sensible bar count for a given canvas width.
 * Default density is one bar per ~3 pixels — gives clean readability without
 * sub-pixel overlap and matches typical music-app waveform thumbnails.
 */
export function pickBarCountForWidth(width: number, pixelsPerBar = 3): number {
    if (width <= 0) return 0
    return Math.max(1, Math.floor(width / Math.max(1, pixelsPerBar)))
}

/**
 * Decimate a boolean voice mask in lockstep with `decimateDataPoints` so
 * `voiceMask[i]` lines up with `dataPoints[i]` after binning.
 * Reduction is OR — a bin is "voice" if any sub-point is voice.
 */
export function decimateVoiceMask(
    mask: boolean[],
    sourceLength: number,
    target: number
): boolean[] {
    if (target <= 0 || sourceLength === 0) return []
    if (target >= sourceLength) return mask.slice(0, sourceLength)

    const stride = sourceLength / target
    return Array.from({ length: target }, (_, index) => {
        const { start, end } = getBinRange(index, stride, sourceLength)
        return mask.slice(start, end).some(Boolean)
    })
}
