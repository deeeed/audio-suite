import type {
    MoonshineTranscriptEvent,
    MoonshineTranscriptLine,
    MoonshineTranscriber,
} from '@siteed/moonshine.rn'
import { useCallback, useEffect, useRef, useState } from 'react'

import { baseLogger } from '../config'

const logger = baseLogger.extend('LiveMoonshine')

interface UseLiveMoonshineOptions {
    onCommit?: (text: string) => void
    onError?: (error: string) => void
    onChunkProcessed?: (info: {
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
}

function joinTranscriptParts(parts: string[]): string {
    return parts.map((part) => part.trim()).filter(Boolean).join(' ').trim()
}

function normalizeLine(
    line: MoonshineTranscriptEvent['line']
): MoonshineTranscriptLine | null {
    if (!line?.lineId) return null
    return {
        ...line,
        text: line.text?.trim() ?? '',
    }
}

export function useLiveMoonshine(
    options: UseLiveMoonshineOptions = {}
): UseLiveMoonshineResult {
    const [committedLines, setCommittedLines] = useState<MoonshineTranscriptLine[]>(
        []
    )
    const [committedText, setCommittedText] = useState('')
    const [interimLines, setInterimLines] = useState<MoonshineTranscriptLine[]>([])
    const [interimText, setInterimText] = useState('')
    const [isListening, setIsListening] = useState(false)
    const processingRef = useRef(false)
    const queueRef = useRef<{ sampleRate: number; samples: number[] }[]>([])
    const listeningRef = useRef(false)
    const transcriberRef = useRef<MoonshineTranscriber | null>(
        options.transcriber ?? null
    )
    const completedLineIdsRef = useRef(new Set<string>())
    const activeLinesRef = useRef(new Map<string, MoonshineTranscriptLine>())

    useEffect(() => {
        transcriberRef.current = options.transcriber ?? null
    }, [options.transcriber])

    const processQueue = useCallback(async () => {
        const transcriber = transcriberRef.current
        if (processingRef.current || !listeningRef.current || !transcriber) return
        const next = queueRef.current.shift()
        if (!next) return

        processingRef.current = true
        try {
            const startedAt = Date.now()
            await transcriber.addAudio(next.samples, next.sampleRate)
            options.onChunkProcessed?.({
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
    }, [options])

    const feedAudio = useCallback(
        (samples: number[], sampleRate: number) => {
            if (!listeningRef.current) return
            queueRef.current.push({ sampleRate, samples })
            void processQueue()
        },
        [processQueue]
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
                    activeLines.map((activeLine) => activeLine.text)
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
                        activeLines.map((activeLine) => activeLine.text)
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
        [options]
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
        listeningRef.current = true
        completedLineIdsRef.current = new Set()
        activeLinesRef.current = new Map()
        queueRef.current = []
        setCommittedLines([])
        setCommittedText('')
        setInterimLines([])
        setInterimText('')
        setIsListening(true)
    }, [])

    const stop = useCallback(() => {
        logger.info('Moonshine live transcription stopped')
        listeningRef.current = false
        activeLinesRef.current = new Map()
        queueRef.current = []
        setInterimLines([])
        setIsListening(false)
    }, [])

    const clear = useCallback(() => {
        completedLineIdsRef.current = new Set()
        activeLinesRef.current = new Map()
        setCommittedLines([])
        setCommittedText('')
        setInterimLines([])
        setInterimText('')
    }, [])

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
    }
}
