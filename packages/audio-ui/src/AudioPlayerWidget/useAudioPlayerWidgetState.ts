import { useCallback, useMemo, useState } from 'react'

import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native'

import type { WaveformBar, WaveformPoint } from '../types/waveform'
import {
    decimateDataPoints,
    decimateVoiceMask,
    pickBarCountForWidth,
} from '../utils/decimateDataPoints'

export interface UseAudioPlayerWidgetStateProps {
    dataPoints: WaveformPoint[]
    voiceMask?: boolean[]
    currentTimeMs: number
    durationMs: number
    onSeek?: (timeMs: number) => void
    /** Default 3. Approximate pixels-per-bar for decimation. */
    pixelsPerBar?: number
    /**
     * If true, `handleCanvasPress` is a no-op. Lets callers gate seek behind
     * loading / error / disabled states without re-implementing the guard.
     */
    disabled?: boolean
    /** Override the default `MM:SS` formatter for time labels. */
    formatTime?: (ms: number) => string
}

export interface UseAudioPlayerWidgetStateResult {
    /** Attach to the View that wraps your bars so this hook can measure it. */
    onLayout: (e: LayoutChangeEvent) => void
    /** Measured width of the bar area. 0 until the first layout pass. */
    measuredWidth: number
    /** Decimated bars matching the measured width and `pixelsPerBar`. */
    renderPoints: WaveformBar[]
    /** Voice mask aligned with `renderPoints`, or undefined when unusable. */
    renderVoiceMask: boolean[] | undefined
    /** Pixel offset of the playhead within `measuredWidth`. */
    playheadX: number
    /** Press handler that maps `locationX` to a seek call. */
    handleCanvasPress: (e: GestureResponderEvent) => void
    /** Time formatter — defaults to `MM:SS`, override via the prop. */
    formatTime: (ms: number) => string
}

function defaultFormatTime(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '00:00'
    const totalSec = Math.floor(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Headless state machine for AudioPlayerWidget. Lets callers build a fully
 * custom UI on top of the same decimation, playhead, and seek math the
 * built-in widget uses.
 */
export function useAudioPlayerWidgetState({
    dataPoints,
    voiceMask,
    currentTimeMs,
    durationMs,
    onSeek,
    pixelsPerBar = 3,
    disabled = false,
    formatTime,
}: UseAudioPlayerWidgetStateProps): UseAudioPlayerWidgetStateResult {
    const [measuredWidth, setMeasuredWidth] = useState(0)

    const onLayout = useCallback((e: LayoutChangeEvent) => {
        const next = Math.floor(e.nativeEvent.layout.width)
        if (next > 0) {
            setMeasuredWidth((prev) => (prev === next ? prev : next))
        }
    }, [])

    const renderPoints = useMemo(() => {
        if (measuredWidth <= 0) return []
        const target = pickBarCountForWidth(measuredWidth, pixelsPerBar)
        return decimateDataPoints(dataPoints, target)
    }, [dataPoints, measuredWidth, pixelsPerBar])

    const renderVoiceMask = useMemo(() => {
        if (!voiceMask || voiceMask.length === 0) return undefined
        if (voiceMask.length !== dataPoints.length) return undefined
        if (renderPoints.length === 0) return undefined
        return decimateVoiceMask(
            voiceMask,
            dataPoints.length,
            renderPoints.length
        )
    }, [voiceMask, dataPoints.length, renderPoints.length])

    const playheadX = useMemo(() => {
        if (durationMs <= 0 || measuredWidth <= 0) return 0
        const ratio = currentTimeMs / durationMs
        return Math.max(0, Math.min(measuredWidth, ratio * measuredWidth))
    }, [currentTimeMs, durationMs, measuredWidth])

    const handleCanvasPress = useCallback(
        (e: GestureResponderEvent) => {
            if (durationMs <= 0 || disabled || measuredWidth <= 0 || !onSeek) return
            const x = e.nativeEvent.locationX
            const ratio = Math.max(0, Math.min(1, x / measuredWidth))
            onSeek(ratio * durationMs)
        },
        [durationMs, measuredWidth, onSeek, disabled]
    )

    const resolvedFormatTime = formatTime ?? defaultFormatTime

    return {
        onLayout,
        measuredWidth,
        renderPoints,
        renderVoiceMask,
        playheadX,
        handleCanvasPress,
        formatTime: resolvedFormatTime,
    }
}
