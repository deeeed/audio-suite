export const MIN_RANGE_DURATION_MS = 100

export interface TimeRange {
    start: number
    end: number
}

export const clamp = (value: number, min: number, max: number) => {
    return Math.min(Math.max(value, min), max)
}

export const getMinRangeDuration = (durationMs: number) => {
    return Math.min(MIN_RANGE_DURATION_MS, Math.max(0, durationMs))
}

export const sanitizeTimeRange = (
    startTime: number,
    endTime: number,
    durationMs: number
): TimeRange => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return { start: 0, end: 0 }
    }

    const minRange = getMinRangeDuration(durationMs)
    const maxStart = Math.max(0, durationMs - minRange)
    const start = clamp(Number.isFinite(startTime) ? startTime : 0, 0, maxStart)
    const end = clamp(
        Number.isFinite(endTime) ? endTime : durationMs,
        start + minRange,
        durationMs
    )

    return { start, end }
}
