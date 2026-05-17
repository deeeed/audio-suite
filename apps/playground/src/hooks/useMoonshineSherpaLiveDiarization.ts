import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'

import {
    LiveSpeakerTurnSession,
    SpeakerId,
    VAD,
    type LiveSpeakerTurnEvent,
} from '@siteed/sherpa-onnx.rn'
import type { MoonshineTranscriptLine } from '@siteed/moonshine.rn'

import { baseLogger } from '../config'
import { resolveNativeAssetFileUri } from '../utils/resolveNativeAssetFileUri'
import {
    type MoonshineLiveChunkProcessedEvent,
    type MoonshineLiveStartOptions,
    type MoonshineLiveStopOptions,
    type MoonshineLiveStrategy,
    useMoonshineLiveSession,
} from './useMoonshineLiveSession'

const logger = baseLogger.extend('MoonshineSherpaLive')

const SAMPLE_RATE = 16000
const SPEAKER_MODEL_FILE = '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx'
const SPEAKER_MODEL_URL =
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx'
const SPEAKER_MODEL_DIR_URI = `${FileSystem.documentDirectory ?? ''}sherpa-speaker-id/`

export interface SherpaLiveTurn {
    endMs: number
    endSample: number
    speakerId?: string
    startMs: number
    startSample: number
    turnId: string
}

export interface SherpaLiveStats {
    chunks: number
    droppedChunks: number
    maxProcessingMs: number
    maxQueueDepth: number
    samples: number
    totalProcessingMs: number
}

export interface MoonshineLiveStats {
    chunks: number
    maxProcessingMs: number
    maxQueueDepth: number
    samples: number
    totalProcessingMs: number
}

export type AttributedMoonshineLine = MoonshineTranscriptLine & {
    hasSpeakerId?: boolean
    sherpaSpeakerId?: string
    sherpaTurnId?: string
    speakerId?: string
    speakerIndex?: number
}

interface UseMoonshineSherpaLiveDiarizationOptions {
    strategy?: MoonshineLiveStrategy
}

const emptySherpaStats: SherpaLiveStats = {
    chunks: 0,
    droppedChunks: 0,
    maxProcessingMs: 0,
    maxQueueDepth: 0,
    samples: 0,
    totalProcessingMs: 0,
}

const emptyMoonshineStats: MoonshineLiveStats = {
    chunks: 0,
    maxProcessingMs: 0,
    maxQueueDepth: 0,
    samples: 0,
    totalProcessingMs: 0,
}

function uriToPath(uri: string): string {
    return uri.startsWith('file://') ? uri.substring(7) : uri
}

function splitFilePath(fileUri: string): { modelDir: string; modelFile: string } {
    const path = uriToPath(fileUri)
    const lastSlash = path.lastIndexOf('/')
    if (lastSlash < 0) {
        throw new Error(`Model path is invalid: ${path}`)
    }
    return {
        modelDir: path.substring(0, lastSlash),
        modelFile: path.substring(lastSlash + 1),
    }
}

async function ensureSpeakerModel(): Promise<{ modelDir: string; modelFile: string }> {
    if (!SPEAKER_MODEL_DIR_URI) {
        throw new Error('FileSystem.documentDirectory is unavailable for speaker model storage')
    }

    await FileSystem.makeDirectoryAsync(SPEAKER_MODEL_DIR_URI, {
        intermediates: true,
    }).catch(() => null)

    const targetUri = `${SPEAKER_MODEL_DIR_URI}${SPEAKER_MODEL_FILE}`
    const info = await FileSystem.getInfoAsync(targetUri)
    if (!info.exists || info.isDirectory) {
        await FileSystem.downloadAsync(SPEAKER_MODEL_URL, targetUri)
    }

    return {
        modelDir: uriToPath(SPEAKER_MODEL_DIR_URI).replace(/\/$/, ''),
        modelFile: SPEAKER_MODEL_FILE,
    }
}

function speakerIndexFromId(speakerId?: string): number | undefined {
    const match = speakerId?.match(/speaker_(\d+)/)
    if (!match?.[1]) return undefined
    return Number.parseInt(match[1], 10) - 1
}

function lineInterval(line: MoonshineTranscriptLine): { startMs?: number; endMs?: number } {
    const words = line.words ?? []
    const firstWord = words.find((word) => word.startTimeMs != null)
    const lastWord = [...words].reverse().find((word) => word.endTimeMs != null)
    const startMs =
        firstWord?.startTimeMs ??
        line.startedAtMs ??
        (line.completedAtMs != null && line.durationMs != null
            ? line.completedAtMs - line.durationMs
            : undefined)
    const endMs =
        lastWord?.endTimeMs ??
        line.completedAtMs ??
        (startMs != null && line.durationMs != null ? startMs + line.durationMs : undefined)
    return { startMs, endMs }
}

function overlapMs(
    a: { startMs?: number; endMs?: number },
    b: { startMs: number; endMs: number }
): number {
    if (a.startMs == null || a.endMs == null) return 0
    return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs))
}

function selectTurnForLine(
    line: MoonshineTranscriptLine,
    turns: SherpaLiveTurn[],
    activeSpeakerId?: string
): SherpaLiveTurn | null {
    if (turns.length === 0) return null

    const interval = lineInterval(line)
    let bestTurn: SherpaLiveTurn | null = null
    let bestOverlap = 0
    for (const turn of turns) {
        const nextOverlap = overlapMs(interval, turn)
        if (nextOverlap > bestOverlap) {
            bestOverlap = nextOverlap
            bestTurn = turn
        }
    }
    if (bestTurn) return bestTurn

    if (interval.endMs != null) {
        const previousTurn = [...turns]
            .reverse()
            .find((turn) => turn.endMs <= (interval.endMs ?? 0) && turn.speakerId)
        if (previousTurn) return previousTurn
    }

    if (activeSpeakerId) {
        for (let index = turns.length - 1; index >= 0; index -= 1) {
            const turn = turns[index]
            if (turn?.speakerId === activeSpeakerId) return turn
        }
        return null
    }

    return turns[turns.length - 1] ?? null
}

function attributeLines(
    lines: MoonshineTranscriptLine[],
    turns: SherpaLiveTurn[],
    activeSpeakerId?: string
): AttributedMoonshineLine[] {
    return lines.map((line) => {
        const turn = selectTurnForLine(line, turns, activeSpeakerId)
        const speakerId = turn?.speakerId ?? activeSpeakerId
        const speakerIndex = speakerIndexFromId(speakerId)
        return {
            ...line,
            hasSpeakerId: Boolean(speakerId),
            sherpaSpeakerId: speakerId,
            sherpaTurnId: turn?.turnId,
            speakerId,
            speakerIndex,
        }
    })
}

export function useMoonshineSherpaLiveDiarization(
    options: UseMoonshineSherpaLiveDiarizationOptions = {}
) {
    const [isPreparingSherpa, setIsPreparingSherpa] = useState(false)
    const [isSherpaReady, setIsSherpaReady] = useState(false)
    const [sherpaError, setSherpaError] = useState<string | null>(null)
    const [sherpaStatusMessage, setSherpaStatusMessage] = useState<string | null>(null)
    const [speakerEvents, setSpeakerEvents] = useState<LiveSpeakerTurnEvent[]>([])
    const [speakerEventCounts, setSpeakerEventCounts] = useState<Record<string, number>>({})
    const [sherpaTurns, setSherpaTurns] = useState<SherpaLiveTurn[]>([])
    const [activeSpeakerId, setActiveSpeakerId] = useState<string | undefined>()
    const [sherpaStats, setSherpaStats] = useState<SherpaLiveStats>(emptySherpaStats)
    const [moonshineStats, setMoonshineStats] = useState<MoonshineLiveStats>(emptyMoonshineStats)

    const mountedRef = useRef(true)
    const speakerSessionRef = useRef<LiveSpeakerTurnSession | null>(null)
    const speakerChainRef = useRef<Promise<void>>(Promise.resolve())
    const speakerQueueDepthRef = useRef(0)

    const handleSpeakerEvent = useCallback((event: LiveSpeakerTurnEvent) => {
        if (!mountedRef.current) return
        setSpeakerEvents((previous) => [...previous.slice(-99), event])
        setSpeakerEventCounts((previous) => ({
            ...previous,
            [event.type]: (previous[event.type] ?? 0) + 1,
        }))

        if (event.type === 'speaker_resolved') {
            setActiveSpeakerId(event.speakerId)
            return
        }
        if (event.type === 'turn_final') {
            setSherpaTurns((previous) => [
                ...previous,
                {
                    endMs: event.endMs,
                    endSample: event.endSample,
                    speakerId: event.speakerId,
                    startMs: event.startMs,
                    startSample: event.startSample,
                    turnId: event.turnId,
                },
            ])
            if (event.speakerId) setActiveSpeakerId(event.speakerId)
            return
        }
        if (event.type === 'error') {
            setSherpaError(event.error)
        }
    }, [])

    const releaseSherpa = useCallback(async () => {
        const session = speakerSessionRef.current
        speakerSessionRef.current = null
        session?.release()
        await Promise.all([
            VAD.release().catch(() => ({ released: false })),
            SpeakerId.release().catch(() => ({ released: false })),
        ])
        if (mountedRef.current) {
            setIsSherpaReady(false)
        }
    }, [])

    useEffect(() => {
        return () => {
            mountedRef.current = false
            void releaseSherpa()
        }
    }, [releaseSherpa])

    const prepareSherpa = useCallback(async () => {
        // Keep the native-only web guard before preparation state mutations so
        // web never gets stuck in a "preparing" state.
        if (Platform.OS === 'web') {
            setSherpaStatusMessage('Sherpa speaker turns are disabled in this native-only live demo on web.')
            return
        }
        if (speakerSessionRef.current && isSherpaReady) return

        setSherpaError(null)
        setIsPreparingSherpa(true)
        setSherpaStatusMessage('Preparing Sherpa VAD + Speaker ID...')
        try {
            await releaseSherpa()
            const vadFileUri = await resolveNativeAssetFileUri(
                require('@assets/silero_vad_v5.onnx'),
                'silero_vad_v5.onnx',
                'VAD model'
            )
            const vadPath = splitFilePath(vadFileUri)
            const speakerPath = await ensureSpeakerModel()

            const vadInit = await VAD.init({
                modelDir: vadPath.modelDir,
                modelFile: vadPath.modelFile,
                numThreads: 1,
                provider: 'cpu',
                debug: false,
            })
            if (!vadInit.success) {
                throw new Error(vadInit.error || 'VAD init failed')
            }

            const speakerInit = await SpeakerId.init({
                modelDir: speakerPath.modelDir,
                modelFile: speakerPath.modelFile,
                numThreads: 2,
                provider: 'cpu',
                debug: false,
            })
            if (!speakerInit.success) {
                throw new Error(speakerInit.error || 'Speaker ID init failed')
            }

            speakerSessionRef.current = new LiveSpeakerTurnSession({
                sampleRate: SAMPLE_RATE,
                vad: VAD,
                speakerId: SpeakerId,
                minTurnDurationMs: 1000,
                speechPadMs: 120,
                speakerThreshold: 0.55,
                maxRingBufferDurationMs: 90_000,
                onEvent: handleSpeakerEvent,
            })

            if (mountedRef.current) {
                setIsSherpaReady(true)
                setSherpaStatusMessage('Sherpa VAD + Speaker ID ready.')
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.warn(`Sherpa live speaker-turn init failed: ${message}`)
            await releaseSherpa()
            if (mountedRef.current) {
                setSherpaError(message)
                setSherpaStatusMessage('Sherpa speaker-turn preparation failed.')
            }
            throw error
        } finally {
            if (mountedRef.current) {
                setIsPreparingSherpa(false)
            }
        }
    }, [handleSpeakerEvent, isSherpaReady, releaseSherpa])

    const handleAudioSamples = useCallback(
        ({ samples, sampleRate, startSample }: { samples: number[]; sampleRate: number; startSample: number }) => {
            const session = speakerSessionRef.current
            if (!session || Platform.OS === 'web') return

            speakerQueueDepthRef.current += 1
            setSherpaStats((previous) => ({
                ...previous,
                maxQueueDepth: Math.max(previous.maxQueueDepth, speakerQueueDepthRef.current),
            }))

            speakerChainRef.current = speakerChainRef.current
                .then(async () => {
                    const startedAt = Date.now()
                    await session.acceptChunk({ sampleRate, samples, startSample })
                    const durationMs = Date.now() - startedAt
                    if (!mountedRef.current) return
                    setSherpaStats((previous) => ({
                        chunks: previous.chunks + 1,
                        droppedChunks: previous.droppedChunks,
                        maxProcessingMs: Math.max(previous.maxProcessingMs, durationMs),
                        maxQueueDepth: Math.max(previous.maxQueueDepth, speakerQueueDepthRef.current),
                        samples: previous.samples + samples.length,
                        totalProcessingMs: previous.totalProcessingMs + durationMs,
                    }))
                    return undefined
                })
                .catch((error) => {
                    const message = error instanceof Error ? error.message : String(error)
                    logger.warn(`Sherpa speaker-turn chunk failed: ${message}`)
                    if (mountedRef.current) {
                        setSherpaError(message)
                        setSherpaStats((previous) => ({
                            ...previous,
                            droppedChunks: previous.droppedChunks + 1,
                        }))
                    }
                })
                .finally(() => {
                    speakerQueueDepthRef.current = Math.max(0, speakerQueueDepthRef.current - 1)
                })
        },
        []
    )

    const handleMoonshineChunkProcessed = useCallback((event: MoonshineLiveChunkProcessedEvent) => {
        setMoonshineStats((previous) => ({
            chunks: previous.chunks + 1,
            maxProcessingMs: Math.max(previous.maxProcessingMs, event.durationMs),
            maxQueueDepth: Math.max(previous.maxQueueDepth, event.queueDepth),
            samples: previous.samples + event.sampleCount,
            totalProcessingMs: previous.totalProcessingMs + event.durationMs,
        }))
    }, [])

    const moonshine = useMoonshineLiveSession({
        strategy: options.strategy,
        onAudioSamples: handleAudioSamples,
        onMoonshineChunkProcessed: handleMoonshineChunkProcessed,
    })

    const startSession = useCallback(async (options?: MoonshineLiveStartOptions) => {
        setSpeakerEvents([])
        setSpeakerEventCounts({})
        setSherpaTurns([])
        setActiveSpeakerId(undefined)
        setSherpaStats(emptySherpaStats)
        setMoonshineStats(emptyMoonshineStats)
        speakerQueueDepthRef.current = 0
        speakerChainRef.current = Promise.resolve()
        await prepareSherpa()
        speakerSessionRef.current?.reset()
        await moonshine.startSession(options)
    }, [moonshine, prepareSherpa])

    const stopSession = useCallback(async (options?: MoonshineLiveStopOptions) => {
        await moonshine.stopSession(options)
        await speakerChainRef.current
        await speakerSessionRef.current?.flush().catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            logger.warn(`Sherpa live speaker-turn flush failed: ${message}`)
            setSherpaError(message)
        })
    }, [moonshine])

    const clear = useCallback(() => {
        moonshine.clear()
        speakerSessionRef.current?.reset()
        speakerChainRef.current = Promise.resolve()
        speakerQueueDepthRef.current = 0
        setSpeakerEvents([])
        setSpeakerEventCounts({})
        setSherpaTurns([])
        setActiveSpeakerId(undefined)
        setSherpaStats(emptySherpaStats)
        setMoonshineStats(emptyMoonshineStats)
        setSherpaError(null)
    }, [moonshine])

    const attributedCommittedLines = useMemo(
        () => attributeLines(moonshine.liveCommittedLines, sherpaTurns, activeSpeakerId),
        [activeSpeakerId, moonshine.liveCommittedLines, sherpaTurns]
    )
    const attributedInterimLines = useMemo(
        () => attributeLines(moonshine.liveInterimLines, sherpaTurns, activeSpeakerId),
        [activeSpeakerId, moonshine.liveInterimLines, sherpaTurns]
    )

    return {
        ...moonshine,
        attributedCommittedLines,
        attributedInterimLines,
        clear,
        isBusy: moonshine.isBusy || isPreparingSherpa,
        isPreparingSherpa,
        isSherpaReady,
        moonshineStats,
        sherpaError,
        sherpaStats,
        sherpaStatusMessage,
        sherpaTurns,
        speakerEventCounts,
        speakerEvents,
        processAudioEvent: moonshine.processAudioEvent,
        startSession,
        stopSession,
    }
}
