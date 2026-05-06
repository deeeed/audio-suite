import {
    AudioAnalysis,
    DataPoint,
    PreviewBar,
    PreviewBarsOptions,
    PreviewBarsResult,
} from './AudioAnalysis.types'
import { extractPreview } from './extractPreview'
import AudioStudioModule from '../AudioStudioModule'
import { mapExtractionError } from '../errors/AudioExtractionError'
import { cleanNativeOptions } from '../utils/cleanNativeOptions'

const DEFAULT_PREVIEW_BARS = 100
const DEFAULT_PREVIEW_END_TIME_MS = 30000
const DEFAULT_SILENCE_THRESHOLD = 0.01

interface NativePreviewBarsModule {
    extractPreviewBars: (
        options: Record<string, unknown>
    ) => Promise<PreviewBarsResult>
}

function hasNativePreviewBars(
    module: unknown
): module is NativePreviewBarsModule {
    return (
        module !== null &&
        (typeof module === 'object' || typeof module === 'function') &&
        typeof (module as NativePreviewBarsModule).extractPreviewBars ===
            'function'
    )
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(1, value))
}

function pointToPreviewBar(
    point: DataPoint,
    index: number,
    fallbackBarDurationMs: number,
    silenceRmsThreshold: number
): PreviewBar {
    // Existing DataPoint start/end units vary across older native paths. Compact
    // bars define millisecond ranges explicitly, so the compatibility adapter
    // derives them from bar index and duration instead of leaking legacy units.
    const startTimeMs = Math.round(index * fallbackBarDurationMs)
    const endTimeMs = Math.round((index + 1) * fallbackBarDurationMs)
    const rms = clamp01(point.rms)

    return {
        id: point.id ?? index,
        amplitude: clamp01(point.amplitude),
        rms,
        silent: point.silent ?? rms < silenceRmsThreshold,
        startTimeMs,
        endTimeMs: Math.max(startTimeMs, endTimeMs),
    }
}

function calculateRange(values: number[]): { min: number; max: number } {
    if (values.length === 0) {
        return { min: 0, max: 0 }
    }

    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY

    for (const value of values) {
        const safeValue = clamp01(value)
        min = Math.min(min, safeValue)
        max = Math.max(max, safeValue)
    }

    return { min, max }
}

function fromAudioAnalysis(
    analysis: AudioAnalysis,
    requestedNumberOfBars: number,
    silenceRmsThreshold: number
): PreviewBarsResult {
    const barDurationMs =
        analysis.segmentDurationMs ||
        Math.max(
            1,
            analysis.durationMs / Math.max(1, analysis.dataPoints.length)
        )
    const bars = analysis.dataPoints.map((point, index) =>
        pointToPreviewBar(point, index, barDurationMs, silenceRmsThreshold)
    )

    return {
        bars,
        durationMs: analysis.durationMs,
        sampleRate: analysis.sampleRate,
        numberOfChannels: analysis.numberOfChannels,
        bitDepth: analysis.bitDepth,
        samples: analysis.samples,
        requestedNumberOfBars,
        barDurationMs,
        amplitudeRange: calculateRange(bars.map((bar) => bar.amplitude)),
        rmsRange: calculateRange(bars.map((bar) => bar.rms)),
        extractionTimeMs: analysis.extractionTimeMs,
    }
}

function emitBarsProgressively(
    bars: PreviewBar[],
    onBarReady: NonNullable<PreviewBarsOptions['onBarReady']>
): void {
    const total = bars.length
    for (let index = 0; index < total; index++) {
        onBarReady(bars[index]!, index, total)
    }
}

/**
 * Extracts compact waveform preview bars for UI rendering.
 *
 * Native platforms may provide a compact `extractPreviewBars` bridge. Until that
 * bridge is available, this safely falls back to the existing `extractPreview`
 * compatibility path and adapts `DataPoint` objects into compact bars.
 *
 * @throws {AudioExtractionError} when the underlying extraction fails.
 */
export async function extractPreviewBars({
    fileUri,
    numberOfBars = DEFAULT_PREVIEW_BARS,
    startTimeMs = 0,
    endTimeMs = DEFAULT_PREVIEW_END_TIME_MS,
    decodingOptions,
    logger,
    onBarReady,
}: PreviewBarsOptions): Promise<PreviewBarsResult> {
    const requestedNumberOfBars = Math.max(1, Math.floor(numberOfBars))
    const nativeOptions = {
        fileUri,
        numberOfBars: requestedNumberOfBars,
        startTimeMs,
        endTimeMs,
        decodingOptions,
    }

    const nativeModule = AudioStudioModule as unknown
    if (hasNativePreviewBars(nativeModule)) {
        let result: PreviewBarsResult
        try {
            result = await nativeModule.extractPreviewBars(
                cleanNativeOptions(nativeOptions)
            )
        } catch (err) {
            throw mapExtractionError(err, fileUri)
        }

        if (onBarReady) {
            emitBarsProgressively(result.bars, onBarReady)
        }
        return result
    }

    let analysis: AudioAnalysis
    try {
        analysis = await extractPreview({
            fileUri,
            numberOfPoints: requestedNumberOfBars,
            startTimeMs,
            endTimeMs,
            decodingOptions,
            logger,
        })
    } catch (err) {
        throw mapExtractionError(err, fileUri)
    }

    const result = fromAudioAnalysis(
        analysis,
        requestedNumberOfBars,
        decodingOptions?.silenceRmsThreshold ?? DEFAULT_SILENCE_THRESHOLD
    )

    if (onBarReady) {
        emitBarsProgressively(result.bars, onBarReady)
    }

    return result
}
