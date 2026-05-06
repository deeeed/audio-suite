export interface WaveformPointFeatures {
    melSpectrogram?: number[]
}

export interface WaveformPointSpeech {
    isActive: boolean
    speakerId?: number
}

export interface WaveformPoint {
    id?: number | string
    amplitude: number
    rms?: number
    dB?: number
    silent?: boolean
    features?: WaveformPointFeatures
    speech?: WaveformPointSpeech
    startTime?: number
    endTime?: number
    startTimeMs?: number
    endTimeMs?: number
    startPosition?: number
    endPosition?: number
    samples?: number
}

export interface WaveformBar extends WaveformPoint {
    id: number
    amplitude: number
    rms: number
    dB: number
    silent: boolean
    startTime?: number
    endTime?: number
    startTimeMs?: number
    endTimeMs?: number
}

export interface WaveformRange {
    min: number
    max: number
}

export interface WaveformAnalysis {
    segmentDurationMs: number
    durationMs: number
    bitDepth: number
    samples: number
    numberOfChannels: number
    sampleRate: number
    dataPoints: WaveformBar[]
    amplitudeRange: WaveformRange
    rmsRange: WaveformRange
    extractionTimeMs: number
}

export interface ConsoleLike {
    log: (...args: unknown[]) => void
    debug: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
}

export function normalizeWaveformPoint(
    point: WaveformPoint,
    index: number
): WaveformBar {
    const rms = point.rms ?? point.amplitude
    return {
        ...point,
        id: typeof point.id === 'number' ? point.id : index,
        amplitude: point.amplitude,
        rms,
        dB: point.dB ?? (rms > 0 ? 20 * Math.log10(rms) : -100),
        silent: point.silent ?? false,
    }
}
