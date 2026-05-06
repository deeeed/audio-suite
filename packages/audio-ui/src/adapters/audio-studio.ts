import { normalizeWaveformPoint } from '../types/waveform'
import type {
    WaveformAnalysis,
    WaveformBar,
    WaveformPoint,
} from '../types/waveform'

export interface AudioStudioDataPointLike extends WaveformPoint {
    id: number
    rms: number
    dB: number
    silent: boolean
}

export interface AudioStudioAnalysisLike {
    durationMs: number
    segmentDurationMs?: number
    bitDepth?: number
    samples?: number
    numberOfChannels?: number
    sampleRate?: number
    dataPoints: AudioStudioDataPointLike[]
    amplitudeRange?: { min: number; max: number }
    rmsRange?: { min: number; max: number }
    extractionTimeMs?: number
}

export function waveformBarsFromAudioStudioDataPoints(
    dataPoints: readonly AudioStudioDataPointLike[]
): WaveformBar[] {
    return dataPoints.map((point, index) =>
        normalizeWaveformPoint(point, index)
    )
}

function rangeFrom(values: number[]): { min: number; max: number } {
    if (values.length === 0) {
        return { min: 0, max: 0 }
    }

    return {
        min: Math.min(...values),
        max: Math.max(...values),
    }
}

export function waveformAnalysisFromAudioStudioAnalysis(
    analysis: AudioStudioAnalysisLike
): WaveformAnalysis {
    const dataPoints = waveformBarsFromAudioStudioDataPoints(
        analysis.dataPoints
    )
    const amplitudeValues = dataPoints.map((point) => point.amplitude)
    const rmsValues = dataPoints.map((point) => point.rms)

    return {
        segmentDurationMs: analysis.segmentDurationMs ?? 0,
        durationMs: analysis.durationMs,
        bitDepth: analysis.bitDepth ?? 32,
        samples: analysis.samples ?? 0,
        numberOfChannels: analysis.numberOfChannels ?? 1,
        sampleRate: analysis.sampleRate ?? 0,
        dataPoints,
        amplitudeRange: analysis.amplitudeRange ?? rangeFrom(amplitudeValues),
        rmsRange: analysis.rmsRange ?? rangeFrom(rmsValues),
        extractionTimeMs: analysis.extractionTimeMs ?? 0,
    }
}
