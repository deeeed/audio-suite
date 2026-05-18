import type {
    MoonshineTranscriptEvent,
    MoonshineTranscriptLine,
    MoonshineTranscriber,
} from '@siteed/moonshine.rn'
import { useCallback, useEffect, useRef, useState } from 'react'

import { baseLogger } from '../config'

const logger = baseLogger.extend('LiveMoonshine')

const DEFAULT_MIN_BRIDGE_CHUNK_MS = 600
const DEFAULT_MAX_BRIDGE_CHUNK_MS = 2000
const AUDIO_DRAIN_TIMEOUT_MS = 2000
const AUDIO_DRAIN_POLL_MS = 25

interface QueuedMoonshineChunk {
    chunkCount: number
    sampleRate: number
    samples: number[]
}

interface PendingMoonshineChunk {
    chunkCount: number
    chunks: number[][]
    sampleCount: number
    sampleRate: number
}

interface UseLiveMoonshineOptions {
    maxBridgeChunkDurationMs?: number
    minBridgeChunkDurationMs?: number
    onCommit?: (text: string) => void
    onError?: (error: string) => void
    onChunkProcessed?: (info: {
        coalescedChunkCount: number
        durationMs: number
        queueDepth: number
        sampleCount: number
    }) => void
    onInterimUpdate?: (text: string) => void
    transcriber?: MoonshineTranscriber | null
}

export interface UseLiveMoonshineResult {
    clear: () => void
    committedLines: MoonshineTranscriptLine[]
    committedText: string
    feedAudio: (samples: number[], sampleRate: number) => void
    interimLines: MoonshineTranscriptLine[]
    interimText: string
    isListening: boolean
    start: () => void
    stop: () => void
    stopAudioInput: () => Promise<void>
}

function joinTranscriptParts(parts: string[]): string {
    return parts
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' ')
        .trim()
}

function durationMsForSamples(sampleCount: number, sampleRate: number): number {
    return sampleRate > 0 ? (sampleCount / sampleRate) * 1000 : 0
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function flattenChunks(chunks: number[][], sampleCount: number): number[] {
    if (chunks.length === 1) {
        return chunks[0] ?? []
    }

    const samples = new Array<number>(sampleCount)
    let offset = 0
    for (const chunk of chunks) {
        for (let index = 0; index < chunk.length; index += 1) {
            samples[offset + index] = chunk[index] ?? 0
        }
        offset += chunk.length
    }
    return samples
}

function normalizeLine(line: MoonshineTranscriptEvent['line']): MoonshineTranscriptLine | null {
    if (!line?.lineId) return null
    return {
        ...line,
        text: line.text?.trim() ?? '',
    }
}

export function useLiveMoonshine(options: UseLiveMoonshineOptions = {}): UseLiveMoonshineResult {
    const [committedLines, setCommittedLines] = useState<MoonshineTranscriptLine[]>([])
    const [committedText, setCommittedText] = useState('')
    const [interimLines, setInterimLines] = useState<MoonshineTranscriptLine[]>([])
    const [interimText, setInterimText] = useState('')
    const [isListening, setIsListening] = useState(false)
    const processingRef = useRef(false)
    const queueRef = useRef<QueuedMoonshineChunk[]>([])
    const pendingChunkRef = useRef<PendingMoonshineChunk | null>(null)
    const pendingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const listeningRef = useRef(false)
    const transcriberRef = useRef<MoonshineTranscriber | null>(options.transcriber ?? null)
    const completedLineIdsRef = useRef(new Set<string>())
    const activeLinesRef = useRef(new Map<string, MoonshineTranscriptLine>())
    const minBridgeChunkDurationMs = options.minBridgeChunkDurationMs ?? DEFAULT_MIN_BRIDGE_CHUNK_MS
    const maxBridgeChunkDurationMs = options.maxBridgeChunkDurationMs ?? DEFAULT_MAX_BRIDGE_CHUNK_MS

    useEffect(() => {
        transcriberRef.current = options.transcriber ?? null
    }, [options.transcriber])

    const clearPendingFlushTimer = useCallback(() => {
        if (pendingFlushTimerRef.current) {
            clearTimeout(pendingFlushTimerRef.current)
            pendingFlushTimerRef.current = null
        }
    }, [])

    const enqueuePendingChunk = useCallback(() => {
        clearPendingFlushTimer()
        const pending = pendingChunkRef.current
        if (!pending) return
        pendingChunkRef.current = null
        queueRef.current.push({
            chunkCount: pending.chunkCount,
            sampleRate: pending.sampleRate,
            samples: flattenChunks(pending.chunks, pending.sampleCount),
        })
    }, [clearPendingFlushTimer])

    const processQueue = useCallback(async () => {
        const transcriber = transcriberRef.current
        if (processingRef.current || !listeningRef.current || !transcriber) return
        let next = queueRef.current.shift()
        if (!next) return

        const coalescedChunks = [next.samples]
        let coalescedChunkCount = next.chunkCount
        let sampleCount = next.samples.length
        while (queueRef.current.length > 0) {
            const candidate = queueRef.current[0]
            if (
                !candidate ||
                candidate.sampleRate !== next.sampleRate ||
                durationMsForSamples(sampleCount + candidate.samples.length, next.sampleRate) >
                    maxBridgeChunkDurationMs
            ) {
                break
            }
            queueRef.current.shift()
            coalescedChunks.push(candidate.samples)
            coalescedChunkCount += candidate.chunkCount
            sampleCount += candidate.samples.length
        }
        next = {
            chunkCount: coalescedChunkCount,
            sampleRate: next.sampleRate,
            samples: flattenChunks(coalescedChunks, sampleCount),
        }

        processingRef.current = true
        try {
            const startedAt = Date.now()
            await transcriber.addAudio(next.samples, next.sampleRate)
            options.onChunkProcessed?.({
                coalescedChunkCount: next.chunkCount,
                durationMs: Date.now() - startedAt,
                queueDepth: queueRef.current.length,
                sampleCount: next.samples.length,
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (!listeningRef.current) {
                logger.debug(`Ignoring post-stop Moonshine error: ${message}`)
            } else {
                logger.warn(`Moonshine addAudio error: ${message}`)
                options.onError?.(message)
            }
        } finally {
            processingRef.current = false
            if (queueRef.current.length > 0 && listeningRef.current) {
                void processQueue()
            }
        }
    }, [maxBridgeChunkDurationMs, options])

    const flushPendingChunk = useCallback(() => {
        enqueuePendingChunk()
        void processQueue()
    }, [enqueuePendingChunk, processQueue])

    const feedAudio = useCallback(
        (samples: number[], sampleRate: number) => {
            if (!listeningRef.current) return
            if (minBridgeChunkDurationMs <= 0) {
                queueRef.current.push({ chunkCount: 1, sampleRate, samples })
                void processQueue()
                return
            }

            const pending = pendingChunkRef.current
            if (pending && pending.sampleRate !== sampleRate) {
                flushPendingChunk()
            }

            const nextPending = pendingChunkRef.current
            if (nextPending) {
                nextPending.chunks.push(samples)
                nextPending.sampleCount += samples.length
                nextPending.chunkCount += 1
            } else {
                pendingChunkRef.current = {
                    chunkCount: 1,
                    chunks: [samples],
                    sampleCount: samples.length,
                    sampleRate,
                }
            }

            const updatedPending = pendingChunkRef.current
            if (!updatedPending) return
            const pendingDurationMs = durationMsForSamples(
                updatedPending.sampleCount,
                updatedPending.sampleRate,
            )
            if (pendingDurationMs >= minBridgeChunkDurationMs) {
                flushPendingChunk()
                return
            }
            if (!pendingFlushTimerRef.current) {
                pendingFlushTimerRef.current = setTimeout(
                    flushPendingChunk,
                    minBridgeChunkDurationMs,
                )
            }
        },
        [flushPendingChunk, minBridgeChunkDurationMs, processQueue],
    )

    const handleTranscriptEvent = useCallback(
        (event: MoonshineTranscriptEvent) => {
            if (!listeningRef.current) return
            if (event.type === 'error') {
                options.onError?.(event.error ?? 'Moonshine transcription error')
                return
            }

            const line = normalizeLine(event.line)
            const lineId = line?.lineId
            const text = line?.text ?? ''
            if (!lineId) return

            if (
                event.type === 'lineStarted' ||
                event.type === 'lineUpdated' ||
                event.type === 'lineTextChanged'
            ) {
                activeLinesRef.current.set(lineId, line)
                const activeLines = Array.from(activeLinesRef.current.values())
                const interim = joinTranscriptParts(
                    activeLines.map((activeLine) => activeLine.text),
                )
                setInterimLines(activeLines)
                setInterimText(interim)
                options.onInterimUpdate?.(interim)
                return
            }

            if (event.type === 'lineCompleted') {
                if (!completedLineIdsRef.current.has(lineId) && text) {
                    completedLineIdsRef.current.add(lineId)
                    activeLinesRef.current.delete(lineId)
                    setCommittedLines((previous) => [...previous, line])
                    setCommittedText((previous) => {
                        const nextText = previous ? `${previous} ${text}` : text
                        return nextText.trim()
                    })
                    const activeLines = Array.from(activeLinesRef.current.values())
                    const interim = joinTranscriptParts(
                        activeLines.map((activeLine) => activeLine.text),
                    )
                    setInterimLines(activeLines)
                    setInterimText(interim)
                    options.onCommit?.(text)
                    if (interim) {
                        options.onInterimUpdate?.(interim)
                    }
                }
            }
        },
        [options],
    )

    useEffect(() => {
        if (!options.transcriber) {
            return
        }
        const unsubscribe = options.transcriber.addListener(handleTranscriptEvent)
        return unsubscribe
    }, [handleTranscriptEvent, options.transcriber])

    const start = useCallback(() => {
        logger.info('Moonshine live transcription started')
        clearPendingFlushTimer()
        listeningRef.current = true
        completedLineIdsRef.current = new Set()
        activeLinesRef.current = new Map()
        queueRef.current = []
        pendingChunkRef.current = null
        setCommittedLines([])
        setCommittedText('')
        setInterimLines([])
        setInterimText('')
        setIsListening(true)
    }, [clearPendingFlushTimer])

    const stopAudioInput = useCallback(async () => {
        logger.info('Moonshine live audio input stopped')
        clearPendingFlushTimer()
        enqueuePendingChunk()
        const startedAt = Date.now()
        while (
            listeningRef.current &&
            (processingRef.current || queueRef.current.length > 0) &&
            Date.now() - startedAt < AUDIO_DRAIN_TIMEOUT_MS
        ) {
            void processQueue()
            await sleep(AUDIO_DRAIN_POLL_MS)
        }
        if (queueRef.current.length > 0) {
            logger.warn(
                `Dropping ${queueRef.current.length} Moonshine chunk(s) after ${AUDIO_DRAIN_TIMEOUT_MS}ms drain timeout`,
            )
        }
        // stop() owns flipping listeningRef to false. If the native recorder
        // delivers another chunk after this explicit drain window, discard it
        // rather than extending stop latency indefinitely.
        pendingChunkRef.current = null
        queueRef.current = []
    }, [clearPendingFlushTimer, enqueuePendingChunk, processQueue])

    const stop = useCallback(() => {
        logger.info('Moonshine live transcription stopped')
        clearPendingFlushTimer()
        listeningRef.current = false
        activeLinesRef.current = new Map()
        pendingChunkRef.current = null
        queueRef.current = []
        setInterimLines([])
        setIsListening(false)
    }, [clearPendingFlushTimer])

    const clear = useCallback(() => {
        clearPendingFlushTimer()
        completedLineIdsRef.current = new Set()
        activeLinesRef.current = new Map()
        pendingChunkRef.current = null
        queueRef.current = []
        setCommittedLines([])
        setCommittedText('')
        setInterimLines([])
        setInterimText('')
    }, [clearPendingFlushTimer])

    useEffect(() => clearPendingFlushTimer, [clearPendingFlushTimer])

    return {
        clear,
        committedLines,
        committedText,
        feedAudio,
        interimLines,
        interimText,
        isListening,
        start,
        stop,
        stopAudioInput,
    }
}
