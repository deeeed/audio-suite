import React, { useEffect, useMemo, useRef, useState } from 'react'

import { AudioPlayerWidget } from './AudioPlayerWidget'
import type { AudioPlayerWidgetProps } from './AudioPlayerWidget'
import type { WaveformPoint } from '../types/waveform'

/**
 * The minimum shape we need from the extractor — usually
 * `extractPreviewBars` from `@siteed/audio-studio`, but anything that turns
 * a file URI into compact bars works (e.g. an FFmpeg-based extractor on a
 * desktop bridge, a server-side preview).
 */
export interface AudioFilePlayerExtractInput {
    fileUri: string
    numberOfBars: number
    startTimeMs?: number
    endTimeMs?: number
    signal?: AbortSignal
}

export interface AudioFilePlayerExtractResult {
    bars: WaveformPoint[]
    /** Total clip duration in ms. Used as the playback duration fallback. */
    durationMs?: number
}

export type AudioFilePlayerExtractor = (
    input: AudioFilePlayerExtractInput,
) => Promise<AudioFilePlayerExtractResult>

const DEFAULT_MAX_CACHED_FILES = 16

export interface AudioFilePlayerWidgetProps
    extends Omit<AudioPlayerWidgetProps, 'dataPoints' | 'durationMs' | 'errorMessage' | 'loading'> {
    /**
     * Local file URI to the already-recorded audio. The widget extracts
     * preview bars once per (fileUri, resolved bar count) pair, caches the
     * result, and feeds it into the underlying AudioPlayerWidget.
     */
    fileUri: string
    /**
     * How many bars to ask the extractor for. Defaults to 240 — enough for
     * most phone widths at the default `pixelsPerBar` of 3 without forcing
     * the extractor to over-resolve. Ignored when `barDurationMs` and
     * `durationMs` are both set (resolved count is computed from those).
     */
    numberOfBars?: number
    /**
     * Time-per-bar in ms. Mirrors the same field on `PreviewBarsResult` from
     * @siteed/audio-studio: when set together with a known `durationMs`,
     * the widget computes `numberOfBars = floor(durationMs / barDurationMs)`
     * — useful for "1 bar per N ms" layouts on long-form audio. Requires the
     * caller to pass `durationMs` (file length is unknown until extraction
     * completes; we won't probe twice).
     */
    barDurationMs?: number
    /**
     * Implementation of the file-to-bars step. Usually
     * `(opts) => extractPreviewBars(opts).then((r) => ({ bars: r.bars, durationMs: r.durationMs }))`.
     * Kept as a prop so audio-ui doesn't take a hard dependency on
     * @siteed/audio-studio.
     *
     * IMPORTANT: this function's identity is part of the effect's
     * dependency array. Wrap it in `useCallback` (or hoist outside the
     * component) — passing an inline arrow `() => ...` will re-run
     * extraction on every render and bypass the cache.
     */
    extract: AudioFilePlayerExtractor
    /**
     * Override the duration the widget displays. Otherwise inferred from the
     * extractor result. Also acts as the duration hint for `barDurationMs`.
     */
    durationMs?: number
    /** Surfaces the extractor's error to the caller without breaking render. */
    onExtractError?: (error: Error) => void
    /**
     * Cap on the per-instance LRU cache. Default 16. The cache is keyed by
     * `${fileUri}:${resolvedNumberOfBars}`, so the same file at two
     * densities counts as two entries. Bump this for surfaces that browse
     * many files (file pickers, long chat threads); leave the default for
     * single-file players.
     */
    maxCachedFiles?: number
}

interface ExtractedEntry {
    bars: WaveformPoint[]
    durationMs: number
    error: string | null
}

/**
 * Insertion-order Map<string, ExtractedEntry> used as a poor-man's LRU.
 * On each get-hit we re-insert the entry to push it to the back. On set
 * we evict the front entry when size exceeds the cap.
 */
function lruGet(
    cache: Map<string, ExtractedEntry>,
    key: string,
): ExtractedEntry | undefined {
    const entry = cache.get(key)
    if (entry) {
        cache.delete(key)
        cache.set(key, entry)
    }
    return entry
}

function lruSet(
    cache: Map<string, ExtractedEntry>,
    key: string,
    value: ExtractedEntry,
    cap: number,
) {
    if (cache.has(key)) cache.delete(key)
    cache.set(key, value)
    while (cache.size > cap) {
        const oldest = cache.keys().next().value
        if (typeof oldest !== 'string') break
        cache.delete(oldest)
    }
}

/**
 * File-based wrapper around AudioPlayerWidget. Skips re-extraction when the
 * (fileUri, numberOfBars) pair is already cached, and aborts in-flight work
 * when either changes mid-extract. All other AudioPlayerWidget props pass
 * through unchanged.
 */
export function AudioFilePlayerWidget({
    fileUri,
    numberOfBars = 240,
    barDurationMs,
    extract,
    durationMs: durationMsOverride,
    onExtractError,
    maxCachedFiles = DEFAULT_MAX_CACHED_FILES,
    ...rest
}: AudioFilePlayerWidgetProps) {
    const [entry, setEntry] = useState<ExtractedEntry | null>(null)
    const [loading, setLoading] = useState(true)
    const cacheRef = useRef<Map<string, ExtractedEntry>>(new Map())

    if (
        __DEV__ &&
        typeof barDurationMs === 'number' &&
        barDurationMs > 0 &&
        (typeof durationMsOverride !== 'number' || durationMsOverride <= 0)
    ) {
        // eslint-disable-next-line no-console
        console.warn(
            'AudioFilePlayerWidget: `barDurationMs` was set without a positive `durationMs` hint. Falling back to `numberOfBars` since the file length is unknown until extraction completes.',
        )
    }

    const resolvedNumberOfBars = useMemo(() => {
        if (
            typeof barDurationMs === 'number' &&
            barDurationMs > 0 &&
            typeof durationMsOverride === 'number' &&
            durationMsOverride > 0
        ) {
            return Math.max(1, Math.floor(durationMsOverride / barDurationMs))
        }
        return numberOfBars
    }, [barDurationMs, durationMsOverride, numberOfBars])

    useEffect(() => {
        const cacheKey = `${fileUri}:${resolvedNumberOfBars}`
        const cached = lruGet(cacheRef.current, cacheKey)
        if (cached) {
            setEntry(cached)
            setLoading(false)
            return
        }
        const controller = new AbortController()
        let cancelled = false

        setLoading(true)
        setEntry(null)
        ;(async () => {
            try {
                const result = await extract({
                    fileUri,
                    numberOfBars: resolvedNumberOfBars,
                    signal: controller.signal,
                })
                if (cancelled) return
                const next: ExtractedEntry = {
                    bars: result.bars ?? [],
                    durationMs: result.durationMs ?? 0,
                    error: null,
                }
                lruSet(cacheRef.current, cacheKey, next, maxCachedFiles)
                setEntry(next)
            } catch (err) {
                if (cancelled) return
                const message = err instanceof Error ? err.message : String(err)
                onExtractError?.(err instanceof Error ? err : new Error(message))
                setEntry({ bars: [], durationMs: 0, error: message })
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()

        return () => {
            cancelled = true
            controller.abort()
        }
    }, [fileUri, resolvedNumberOfBars, extract, onExtractError, maxCachedFiles])

    const dataPoints = entry?.bars ?? []
    const resolvedDuration = useMemo(() => {
        if (typeof durationMsOverride === 'number') return durationMsOverride
        return entry?.durationMs ?? 0
    }, [durationMsOverride, entry?.durationMs])

    const errorMessage = entry?.error ?? undefined

    return (
        <AudioPlayerWidget
            {...rest}
            dataPoints={dataPoints}
            durationMs={resolvedDuration}
            loading={loading}
            errorMessage={errorMessage}
        />
    )
}
