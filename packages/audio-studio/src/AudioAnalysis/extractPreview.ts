import { mapExtractionError } from '../errors/AudioExtractionError'
import { PreviewOptions, AudioAnalysis, DataPoint } from './AudioAnalysis.types'
import { extractAudioAnalysis } from './extractAudioAnalysis'

const DEFAULT_SILENCE_THRESHOLD = 0.01

/**
 * Apply a silence threshold to the data points by recomputing the `silent` flag from rms.
 * Returns a new array (does not mutate the source).
 */
function applySilenceThreshold(
    dataPoints: DataPoint[],
    threshold: number,
): DataPoint[] {
    return dataPoints.map((p) => ({
        ...p,
        silent: p.rms < threshold,
    }))
}

const SMALL_TOTAL_INSTANT_THRESHOLD = 50
const PROGRESSIVE_BATCH_DELAY_MS = 30
const PROGRESSIVE_BATCH_COUNT = 8

/**
 * Schedule progressive emission of points after the native one-shot resolve.
 * Native progressive streaming is a future enhancement; today the points are
 * micro-batched on the JS side so consumers (and the agentic recipe runner)
 * can observe an in-flight `pointsReceived < totalPoints` window.
 */
function emitPointsProgressively(
    dataPoints: DataPoint[],
    onPointReady: NonNullable<PreviewOptions['onPointReady']>,
): void {
    const total = dataPoints.length
    if (total === 0) return

    const safeEmit = (point: DataPoint, index: number) => {
        try {
            onPointReady(point, index, total)
        } catch {
            // Swallow callback errors so a buggy consumer cannot break extraction.
        }
    }

    if (total <= SMALL_TOTAL_INSTANT_THRESHOLD) {
        for (let i = 0; i < total; i++) safeEmit(dataPoints[i]!, i)
        return
    }

    // First quarter flushes immediately so the UI shows something within a frame.
    const firstFlushCount = Math.max(1, Math.floor(total / 4))
    for (let i = 0; i < firstFlushCount; i++) safeEmit(dataPoints[i]!, i)

    if (firstFlushCount >= total) return

    const remaining = total - firstFlushCount
    const batchSize = Math.max(1, Math.ceil(remaining / PROGRESSIVE_BATCH_COUNT))
    let cursor = firstFlushCount
    const pump = () => {
        const end = Math.min(total, cursor + batchSize)
        for (let i = cursor; i < end; i++) safeEmit(dataPoints[i]!, i)
        cursor = end
        if (cursor < total) {
            setTimeout(pump, PROGRESSIVE_BATCH_DELAY_MS)
        }
    }
    setTimeout(pump, PROGRESSIVE_BATCH_DELAY_MS)
}

/**
 * Generates a simplified preview of the audio waveform for quick visualization.
 * Ideal for UI rendering with a specified number of points.
 *
 * @param options - The options for the preview, including file URI and time range.
 * @returns A promise that resolves to the audio preview data.
 * @throws {AudioExtractionError} when the underlying extraction fails.
 */
export async function extractPreview({
    fileUri,
    numberOfPoints = 100,
    startTimeMs = 0,
    endTimeMs = 30000,
    decodingOptions,
    logger,
    onPointReady,
}: PreviewOptions): Promise<AudioAnalysis> {
    const durationMs = Math.max(1, endTimeMs - startTimeMs)
    const segmentDurationMs = Math.max(1, Math.floor(durationMs / numberOfPoints))

    let analysis: AudioAnalysis
    try {
        analysis = await extractAudioAnalysis({
            fileUri,
            startTimeMs,
            endTimeMs,
            logger,
            segmentDurationMs,
            decodingOptions,
        })
    } catch (err) {
        throw mapExtractionError(err, fileUri)
    }

    const threshold = decodingOptions?.silenceRmsThreshold ?? DEFAULT_SILENCE_THRESHOLD
    const adjusted: AudioAnalysis = {
        ...analysis,
        dataPoints: applySilenceThreshold(analysis.dataPoints, threshold),
    }

    if (onPointReady) {
        emitPointsProgressively(adjusted.dataPoints, onPointReady)
    }

    return adjusted
}
