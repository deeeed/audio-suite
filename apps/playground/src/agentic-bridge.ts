/**
 * Agentic CDP Bridge — app-side runtime for CDP-based automation.
 *
 * Installs `globalThis.__AGENTIC__` with navigate, getRoute, getState,
 * and recording control (startRecording, stopRecording, etc.).
 * Only active in __DEV__ mode. Import this file from _layout.tsx for side effects.
 *
 * Audio/route state is kept in sync by the AgenticBridgeSync component.
 */

import { Platform } from 'react-native'
import { router } from 'expo-router'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import {
    createAgenticHudStore,
    getFiberRoots,
    findFiberByTestId,
    setInputByTestId,
    type AgenticHudCallback,
    type AgenticHudStep,
} from '@siteed/agentic-dev'

import type { UseAudioRecorderState } from '@siteed/audio-studio'
import {
    extractPreview,
    extractAudioData,
    extractAudioAnalysis,
    extractMelSpectrogram,
    trimAudio,
    AudioDeviceManager,
} from '@siteed/audio-studio'
import { OnnxInference, typedArrayToBase64, base64ToTypedArray } from '@siteed/sherpa-onnx.rn'
import type { OnnxTensorData } from '@siteed/sherpa-onnx.rn'
import {
    getBenchmarkModelOrThrow,
    getMoonshineRuntimeConfig,
    getMoonshineWordTimestampValidationConfig,
    runBenchmarkFile,
    runBenchmarkSimulatedLive,
    runMoonshineSpeakerTurnValidation,
    runMoonshineWordTimestampValidation,
    safeReleaseMoonshine,
    safeReleaseMoonshineTranscriber,
} from './utils/asrBenchmarkRuntime'
import Moonshine, {
    type MoonshineTranscriber,
    type MoonshineTranscriptEvent,
} from '@siteed/moonshine.rn'
import { readMonoPcm16Wav } from './utils/wav'

// State holders updated by AgenticBridgeSync component
let _audioState: Record<string, unknown> = {}
let _routeInfo: { pathname: string; segments: string[] } = {
    pathname: '',
    segments: [],
}
let _pageState: Record<string, unknown> = {}
const stepHudStore = createAgenticHudStore()

// Recorder instance wired by AgenticBridgeSync
let _recorder: UseAudioRecorderState | null = null

export function setAgenticAudioState(state: Record<string, unknown>) {
    _audioState = state
}

export function setAgenticPageState(state: Record<string, unknown>) {
    _pageState = state
}

export function setAgenticRouteInfo(pathname: string, segments: string[]) {
    _routeInfo = { pathname, segments }
}

export function setAgenticStepHud(step: AgenticHudStep | null) {
    stepHudStore.setStep(step)
}

export function registerAgenticStepHudCallback(fn: AgenticHudCallback) {
    stepHudStore.register(fn)
}

export function setAgenticRecorder(recorder: UseAudioRecorderState) {
    _recorder = recorder
}

/**
 * Strip non-serializable (function) properties from a config object.
 * CDP page.evaluate() cannot transport functions across the protocol.
 */
function stripFunctions(obj: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value !== 'function') {
            clean[key] = value
        }
    }
    return clean
}

// --- Async result store for fire-and-store pattern (CDP awaitPromise:false) ---
let _lastAsyncResult: {
    op: string
    status: 'pending' | 'success' | 'error'
    result?: unknown
    error?: string
} | null = null

/**
 * Load jfk.mp3 sample audio to a local file URI (standalone, not a hook).
 */
async function loadSampleFileUri(): Promise<string> {
    const asset = Asset.fromModule(require('@assets/jfk.mp3'))
    await asset.downloadAsync()
    if (!asset.localUri) throw new Error('Failed to load sample audio asset')
    if (Platform.OS === 'web') {
        return asset.localUri
    }
    const dest = `${FileSystem.cacheDirectory}jfk_test.mp3`
    await FileSystem.copyAsync({ from: asset.localUri, to: dest })
    return dest
}

async function loadSpeechWavSampleFileUri(): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asset = Asset.fromModule(require('../public/audio_samples/recorder_hello_world.wav'))
    await asset.downloadAsync()
    if (!asset.localUri) throw new Error('Failed to load speech WAV sample asset')
    if (Platform.OS === 'web') {
        return asset.localUri
    }
    const dest = `${FileSystem.cacheDirectory}speech_sample.wav`
    await FileSystem.copyAsync({ from: asset.localUri, to: dest })
    return dest
}

async function loadJfkWavSampleFileUri(): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asset = Asset.fromModule(require('../public/audio_samples/jfk.wav'))
    await asset.downloadAsync()
    if (!asset.localUri) throw new Error('Failed to load JFK WAV sample asset')
    if (Platform.OS === 'web') {
        return asset.localUri
    }
    const dest = `${FileSystem.cacheDirectory}jfk_sample.wav`
    await FileSystem.copyAsync({ from: asset.localUri, to: dest })
    return dest
}

function resolveMoonshineProbeModelPath(modelPath: string, appendTrailingSlash?: boolean): string {
    if (!appendTrailingSlash || modelPath.endsWith('/')) {
        return modelPath
    }
    return `${modelPath}/`
}

async function runMoonshineProbe(
    modelId: string,
    op: string,
    options:
        | {
              appendTrailingSlash?: boolean
              transcriberOptions?: Record<string, unknown>
          }
        | undefined,
    afterCreate?: (transcriber: MoonshineTranscriber) => Promise<void>,
): Promise<void> {
    let transcriber: MoonshineTranscriber | null = null
    try {
        if (!modelId) {
            throw new Error(`${op} requires a modelId`)
        }

        const config = await getMoonshineRuntimeConfig(modelId)
        const resolvedModelPath =
            typeof config.modelPath === 'string'
                ? resolveMoonshineProbeModelPath(config.modelPath, options?.appendTrailingSlash)
                : config.modelPath

        const mergedOptions =
            config.options != null || options?.transcriberOptions != null
                ? {
                      ...config.options,
                      ...options?.transcriberOptions,
                  }
                : undefined

        transcriber = await Moonshine.createTranscriberFromFiles({
            ...config,
            modelPath: resolvedModelPath,
            ...(mergedOptions ? { options: mergedOptions } : {}),
        })

        if (afterCreate) {
            await afterCreate(transcriber)
        }

        _lastAsyncResult = {
            op,
            status: 'success',
            result: {
                modelArch: config.modelArch,
                modelId,
                modelPath: resolvedModelPath,
                transcriberId: transcriber.transcriberId,
            },
        }
    } catch (e) {
        _lastAsyncResult = {
            op,
            status: 'error',
            error: String(e),
            result: { modelId },
        }
    } finally {
        await safeReleaseMoonshineTranscriber(transcriber)
    }
}

if (__DEV__) {
    const agenticGlobal = globalThis as Record<string, unknown>
    agenticGlobal.__AGENTIC__ = {
        platform: Platform.OS,

        navigate: (path: string) => {
            try {
                router.push(path as never)
                return true
            } catch (e) {
                return { error: String(e) }
            }
        },

        getRoute: () => {
            return _routeInfo
        },

        getState: () => {
            return {
                ..._audioState,
                pageState: _pageState,
                route: _routeInfo.pathname,
                segments: _routeInfo.segments,
            }
        },

        getPageState: () => {
            return {
                route: _routeInfo.pathname,
                ..._pageState,
            }
        },

        getStepHud: () => {
            return stepHudStore.getStep()
        },

        setStepHud: (step: AgenticHudStep | null) => {
            setAgenticStepHud(step)
            return { ok: true, supported: true, step }
        },

        clearStepHud: () => {
            setAgenticStepHud(null)
            return { ok: true, supported: true }
        },

        canGoBack: () => {
            return router.canGoBack()
        },

        goBack: () => {
            router.back()
            return true
        },

        // --- Recording control ---

        startRecording: async (config: Record<string, unknown> = {}) => {
            if (!_recorder) {
                return { error: 'Recorder not available (AgenticBridgeSync not mounted)' }
            }
            try {
                const safeConfig = stripFunctions(config)
                const result = await _recorder.startRecording(safeConfig as never)
                return result
            } catch (e) {
                return { error: String(e) }
            }
        },

        stopRecording: async () => {
            if (!_recorder) {
                return { error: 'Recorder not available (AgenticBridgeSync not mounted)' }
            }
            try {
                const result = await _recorder.stopRecording()
                return result
            } catch (e) {
                return { error: String(e) }
            }
        },

        pauseRecording: async () => {
            if (!_recorder) {
                return { error: 'Recorder not available (AgenticBridgeSync not mounted)' }
            }
            try {
                await _recorder.pauseRecording()
                return true
            } catch (e) {
                return { error: String(e) }
            }
        },

        resumeRecording: async () => {
            if (!_recorder) {
                return { error: 'Recorder not available (AgenticBridgeSync not mounted)' }
            }
            try {
                await _recorder.resumeRecording()
                return true
            } catch (e) {
                return { error: String(e) }
            }
        },

        prepareRecording: async (config: Record<string, unknown> = {}) => {
            if (!_recorder) {
                return { error: 'Recorder not available (AgenticBridgeSync not mounted)' }
            }
            try {
                const safeConfig = stripFunctions(config)
                await _recorder.prepareRecording(safeConfig as never)
                return { prepared: true }
            } catch (e) {
                return { error: String(e) }
            }
        },

        // --- Native module validation tests (fire-and-store pattern) ---

        getLastResult: () => {
            return _lastAsyncResult
        },

        benchmarkAsrFile: (modelId: string, audioUri: string) => {
            const op = 'benchmarkAsrFile'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!modelId) {
                        throw new Error('benchmarkAsrFile requires a modelId')
                    }
                    if (!audioUri) {
                        throw new Error('benchmarkAsrFile requires an audioUri')
                    }

                    const model = getBenchmarkModelOrThrow(modelId)
                    const result = await runBenchmarkFile(modelId, audioUri)
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            audioUri,
                            engine: model.engine,
                            initMs: result.initMs,
                            modelId,
                            modelName: model.name,
                            recognizeMs: result.recognizeMs,
                            transcript: result.transcript,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { audioUri, modelId },
                    }
                } finally {
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        benchmarkAsrSimulatedLive: (modelId: string, audioUri: string) => {
            const op = 'benchmarkAsrSimulatedLive'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!modelId) {
                        throw new Error('benchmarkAsrSimulatedLive requires a modelId')
                    }
                    if (!audioUri) {
                        throw new Error('benchmarkAsrSimulatedLive requires an audioUri')
                    }

                    const model = getBenchmarkModelOrThrow(modelId)
                    const result = await runBenchmarkSimulatedLive(modelId, audioUri)
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            audioUri,
                            commitCount: result.commitCount,
                            engine: model.engine,
                            firstCommitMs: result.firstCommitMs,
                            firstPartialMs: result.firstPartialMs,
                            initMs: result.initMs,
                            modelId,
                            modelName: model.name,
                            partialCount: result.partialCount,
                            runtime: 'streaming',
                            sessionMs: result.sessionMs,
                            transcript: result.transcript,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { audioUri, modelId },
                    }
                } finally {
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        benchmarkMoonshineSpeakerTurns: (modelId: string, audioUri: string) => {
            const op = 'benchmarkMoonshineSpeakerTurns'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!modelId) {
                        throw new Error('benchmarkMoonshineSpeakerTurns requires a modelId')
                    }
                    if (!audioUri) {
                        throw new Error('benchmarkMoonshineSpeakerTurns requires an audioUri')
                    }

                    const model = getBenchmarkModelOrThrow(modelId)
                    if (model.engine !== 'moonshine') {
                        throw new Error(
                            'benchmarkMoonshineSpeakerTurns only supports Moonshine models',
                        )
                    }

                    const result = await runMoonshineSpeakerTurnValidation(modelId, audioUri)
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            audioUri,
                            commitCount: result.commitCount,
                            firstCommitMs: result.firstCommitMs,
                            firstPartialMs: result.firstPartialMs,
                            initMs: result.initMs,
                            lines: result.lines,
                            modelId,
                            modelName: model.name,
                            partialCount: result.partialCount,
                            runtime: 'streaming',
                            sessionMs: result.sessionMs,
                            transcript: result.transcript,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { audioUri, modelId },
                    }
                } finally {
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        benchmarkMoonshineSampleFile: (modelId: string) => {
            const op = 'benchmarkMoonshineSampleFile'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!modelId) {
                        throw new Error('benchmarkMoonshineSampleFile requires a modelId')
                    }
                    const fileUri = await loadSpeechWavSampleFileUri()
                    const model = getBenchmarkModelOrThrow(modelId)
                    const result = await runBenchmarkFile(modelId, fileUri)
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            audioUri: fileUri,
                            engine: model.engine,
                            initMs: result.initMs,
                            modelId,
                            modelName: model.name,
                            recognizeMs: result.recognizeMs,
                            transcript: result.transcript,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { modelId },
                    }
                } finally {
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        benchmarkMoonshineWordTimestamps: (modelId: string, audioUri: string) => {
            const op = 'benchmarkMoonshineWordTimestamps'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    if (!modelId) {
                        throw new Error('benchmarkMoonshineWordTimestamps requires a modelId')
                    }
                    if (!audioUri) {
                        throw new Error('benchmarkMoonshineWordTimestamps requires an audioUri')
                    }

                    const model = getBenchmarkModelOrThrow(modelId)
                    if (model.engine !== 'moonshine') {
                        throw new Error(
                            'benchmarkMoonshineWordTimestamps only supports Moonshine models',
                        )
                    }

                    const result = await runMoonshineWordTimestampValidation(modelId, audioUri)
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            audioUri,
                            initMs: result.initMs,
                            lineCount: result.lineCount,
                            linesWithWords: result.linesWithWords,
                            modelId,
                            modelName: result.validationModelLabel,
                            note: result.note,
                            recognizeMs: result.recognizeMs,
                            transcript: result.transcript,
                            wordCount: result.wordCount,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { audioUri, modelId },
                    }
                } finally {
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        validateMoonshineOfflineContract: (
            modelId: string,
            options?: {
                sample?: 'jfk' | 'speech'
                wordTimestamps?: boolean
            },
        ) => {
            const op = 'validateMoonshineOfflineContract'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                let transcriber: MoonshineTranscriber | null = null
                let removeListener: (() => void) | null = null

                try {
                    if (!modelId) {
                        throw new Error('validateMoonshineOfflineContract requires a modelId')
                    }

                    const sample = options?.sample ?? 'speech'
                    const wordTimestamps = options?.wordTimestamps === true
                    const audioUri =
                        sample === 'jfk'
                            ? await loadJfkWavSampleFileUri()
                            : await loadSpeechWavSampleFileUri()

                    const validation = wordTimestamps
                        ? await getMoonshineWordTimestampValidationConfig(modelId)
                        : {
                              config: await getMoonshineRuntimeConfig(modelId),
                              validationModelId: modelId,
                              validationModelLabel:
                                  getBenchmarkModelOrThrow(modelId).name,
                              note: undefined,
                          }

                    transcriber = await Moonshine.createTranscriberFromFiles(validation.config)

                    const probeStartedAtMs = Date.now()
                    const events: (MoonshineTranscriptEvent & { atMs: number })[] = []
                    removeListener = transcriber.addListener((event) => {
                        events.push({
                            ...event,
                            atMs: Date.now() - probeStartedAtMs,
                        })
                    })

                    const wav = await readMonoPcm16Wav(audioUri)
                    const result = await transcriber.transcribeWithoutStreaming(
                        wav.sampleRate,
                        wav.samples,
                    )

                    const eventTypes = events.map((event) => event.type)
                    const eventTimeline = events.map((event) => ({
                        atMs: event.atMs,
                        error: event.error ?? null,
                        type: event.type,
                    }))
                    const hasIntermediateProgress = eventTypes.some(
                        (type) =>
                            type === 'lineStarted' ||
                            type === 'lineUpdated' ||
                            type === 'lineTextChanged',
                    )
                    const eventSpanMs =
                        events.length >= 2
                            ? (events.at(-1)?.atMs ?? 0) - (events[0]?.atMs ?? 0)
                            : 0
                    const progressSemantics = (() => {
                        if (events.length === 0) return 'none'
                        if (!hasIntermediateProgress) return 'terminal-only'
                        if (eventSpanMs <= 5) return 'terminal-burst'
                        return 'granular'
                    })()
                    const wordCount = result.lines.reduce(
                        (total, line) => total + (line.words?.length ?? 0),
                        0,
                    )
                    const linesWithWords = result.lines.filter(
                        (line) => (line.words?.length ?? 0) > 0,
                    ).length

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            audioUri,
                            eventCount: events.length,
                            eventSpanMs,
                            eventTimeline,
                            eventTypes,
                            hasIntermediateProgress,
                            linesWithWords,
                            modelId,
                            progressSemantics,
                            sample,
                            transcript: result.text,
                            validationModelId: validation.validationModelId,
                            validationModelLabel: validation.validationModelLabel,
                            wordCount,
                            wordTimestamps,
                            wordsReturned: wordCount > 0,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = {
                        op,
                        status: 'error',
                        error: String(e),
                        result: { modelId },
                    }
                } finally {
                    removeListener?.()
                    await safeReleaseMoonshineTranscriber(transcriber)
                    await safeReleaseMoonshine()
                }
            })()
            return { op, status: 'pending' }
        },

        testMoonshineLoad: (
            modelId: string,
            options?: {
                appendTrailingSlash?: boolean
                transcriberOptions?: Record<string, unknown>
            },
        ) => {
            const op = 'testMoonshineLoad'
            _lastAsyncResult = { op, status: 'pending' }
            void runMoonshineProbe(modelId, op, options)
            return { op, status: 'pending' }
        },

        testMoonshineStart: (
            modelId: string,
            options?: {
                appendTrailingSlash?: boolean
                transcriberOptions?: Record<string, unknown>
            },
        ) => {
            const op = 'testMoonshineStart'
            _lastAsyncResult = { op, status: 'pending' }
            void runMoonshineProbe(modelId, op, options, async (transcriber) => {
                await transcriber.start()
            })
            return { op, status: 'pending' }
        },

        testExtractPreview: () => {
            const op = 'extractPreview'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const fileUri = await loadSampleFileUri()
                    const result = await extractPreview({
                        fileUri,
                        numberOfPoints: 50,
                        startTimeMs: 0,
                        endTimeMs: 10000,
                    })
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            dataPointCount: result.dataPoints.length,
                            durationMs: result.durationMs,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testExtractAudioData: () => {
            const op = 'extractAudioData'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const fileUri = await loadSampleFileUri()
                    const result = await extractAudioData({
                        fileUri,
                        startTimeMs: 0,
                        endTimeMs: 5000,
                    })
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            sampleRate: result.sampleRate,
                            channels: result.channels,
                            durationMs: result.durationMs,
                            samples: result.samples,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testTrimAudio: () => {
            const op = 'trimAudio'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const fileUri = await loadSampleFileUri()
                    const result = await trimAudio({ fileUri, startTimeMs: 0, endTimeMs: 5000 })
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            uri: result.uri,
                            durationMs: result.durationMs,
                            size: result.size,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testExtractMelSpectrogram: () => {
            const op = 'extractMelSpectrogram'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const fileUri = await loadSampleFileUri()
                    const result = await extractMelSpectrogram({
                        fileUri,
                        windowSizeMs: 25,
                        hopLengthMs: 10,
                        nMels: 40,
                        startTimeMs: 0,
                        endTimeMs: 5000,
                    })
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            timeSteps: result.timeSteps,
                            nMels: result.nMels,
                            durationMs: result.durationMs,
                            sampleValues: result.spectrogram
                                .slice(0, 3)
                                .map((row) => row.slice(0, 5)),
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testAudioFeatures: () => {
            const op = 'audioFeatures'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    let analysisInput: { fileUri?: string; arrayBuffer?: ArrayBuffer }
                    if (Platform.OS === 'web') {
                        const asset = Asset.fromModule(require('@assets/jfk.mp3'))
                        await asset.downloadAsync()
                        const uri = asset.localUri ?? asset.uri
                        const resp = await fetch(uri)
                        const arrayBuffer = await resp.arrayBuffer()
                        analysisInput = { arrayBuffer }
                    } else {
                        const fileUri = await loadSampleFileUri()
                        analysisInput = { fileUri }
                    }
                    const result = await extractAudioAnalysis({
                        ...analysisInput,
                        startTimeMs: 0,
                        endTimeMs: 5000,
                        segmentDurationMs: 500,
                        features: {
                            spectralCentroid: true,
                            spectralFlatness: true,
                            spectralRolloff: true,
                            spectralBandwidth: true,
                            mfcc: true,
                            chromagram: true,
                        },
                    })
                    const dp = result.dataPoints?.[0]
                    const f = dp?.features
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            platform: Platform.OS,
                            dataPointCount: result.dataPoints?.length ?? 0,
                            extractionTimeMs: result.extractionTimeMs,
                            spectralCentroid: f?.spectralCentroid ?? null,
                            spectralFlatness: f?.spectralFlatness ?? null,
                            spectralRolloff: f?.spectralRolloff ?? null,
                            spectralBandwidth: f?.spectralBandwidth ?? null,
                            mfccLength: f?.mfcc?.length ?? 0,
                            mfccSample: f?.mfcc?.slice(0, 3) ?? [],
                            chromagramLength: f?.chromagram?.length ?? 0,
                            chromagramSample: f?.chromagram?.slice(0, 3) ?? [],
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        getDevices: () => {
            const op = 'getDevices'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const mgr = new AudioDeviceManager()
                    const devices = await mgr.getAvailableDevices()
                    _lastAsyncResult = { op, status: 'success', result: devices }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testSelectInputDevice: (deviceId: string) => {
            const op = 'selectInputDevice'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const mgr = new AudioDeviceManager()
                    const success = await mgr.selectDevice(deviceId)
                    await new Promise((resolve) => setTimeout(resolve, 500))
                    const state = _audioState
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: { success, isRecording: state.isRecording, deviceId },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        testResetToDefaultDevice: () => {
            const op = 'resetToDefaultDevice'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    const mgr = new AudioDeviceManager()
                    const success = await mgr.resetToDefaultDevice()
                    await new Promise((resolve) => setTimeout(resolve, 500))
                    const state = _audioState
                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: { success, isRecording: state.isRecording },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        findFiberByTestId,

        pressTestId: (testId: string) => {
            try {
                const fiber = findFiberByTestId(testId)
                if (!fiber) {
                    return { ok: false, error: `No component with testID="${testId}" found` }
                }

                const props = fiber.memoizedProps as Record<string, unknown> | null
                const onPress = props?.onPress as ((...args: unknown[]) => unknown) | undefined
                const click = (fiber.stateNode as { click?: () => void } | null)?.click
                if (typeof onPress !== 'function' && typeof click !== 'function') {
                    return {
                        ok: false,
                        error: `Component with testID="${testId}" has no onPress prop`,
                    }
                }

                if (typeof onPress === 'function') {
                    onPress()
                } else {
                    click?.()
                }
                return { ok: true, testId }
            } catch (e) {
                return { ok: false, error: String(e) }
            }
        },

        setInputByTestId,

        testOnnxInference: () => {
            const op = 'onnxInference'
            _lastAsyncResult = { op, status: 'pending' }
            void (async () => {
                try {
                    // Resolve model path via expo-asset (works on all platforms)
                    const assetModule = require('@assets/silero_vad_v5.onnx')
                    const [asset] = await Asset.loadAsync(assetModule)
                    let modelPath: string
                    if (Platform.OS === 'web') {
                        // On web, expo-asset provides an HTTP URI
                        modelPath = asset.localUri ?? asset.uri
                    } else {
                        const localUri = asset.localUri ?? asset.uri
                        if (!localUri) throw new Error('Failed to load model asset')
                        modelPath = localUri.startsWith('file://')
                            ? localUri.substring(7)
                            : localUri
                    }

                    // 1. Create session via the OnnxInference service (works on native + web)
                    const session = await OnnxInference.createSession({ modelPath })
                    const sessionInfo = {
                        sessionId: session.sessionId,
                        inputNames: session.inputNames,
                        outputNames: session.outputNames,
                        inputTypes: session.inputTypes,
                        outputTypes: session.outputTypes,
                    }

                    // 2. Prepare test inputs based on actual session input names
                    //    Silero VAD v5 inputs: input(float32 [1,512]), sr(int64 [1]),
                    //    h(float32 [2,1,64]), c(float32 [2,1,64])
                    const audioChunk = new Float32Array(512) // silence
                    const srData = new BigInt64Array([BigInt(16000)])
                    const h = new Float32Array(2 * 1 * 64) // LSTM hidden state
                    const c = new Float32Array(2 * 1 * 64) // LSTM cell state

                    const inputs: Record<string, OnnxTensorData> = {
                        input: {
                            type: 'float32',
                            dims: [1, 512],
                            data: typedArrayToBase64(audioChunk),
                        },
                        sr: { type: 'int64', dims: [1], data: typedArrayToBase64(srData) },
                        h: { type: 'float32', dims: [2, 1, 64], data: typedArrayToBase64(h) },
                        c: { type: 'float32', dims: [2, 1, 64], data: typedArrayToBase64(c) },
                    }

                    const runResult = await OnnxInference.run(session.sessionId, inputs)
                    if (!runResult.success || !runResult.outputs) {
                        await OnnxInference.releaseSession(session.sessionId)
                        _lastAsyncResult = {
                            op,
                            status: 'error',
                            error: runResult.error || 'run returned no outputs',
                        }
                        return
                    }

                    // 3. Inspect outputs
                    const outputSummary: Record<
                        string,
                        { type: string; dims: number[]; sampleValues: number[] }
                    > = {}
                    for (const [name, td] of Object.entries(runResult.outputs)) {
                        const typed = base64ToTypedArray(td.data, td.type)
                        const sample: number[] = []
                        for (let i = 0; i < Math.min(5, typed.length); i++) {
                            const v = typed[i]
                            sample.push(typeof v === 'bigint' ? Number(v) : (v as number))
                        }
                        outputSummary[name] = { type: td.type, dims: td.dims, sampleValues: sample }
                    }

                    // 4. Release session
                    const releaseResult = await OnnxInference.releaseSession(session.sessionId)

                    _lastAsyncResult = {
                        op,
                        status: 'success',
                        result: {
                            platform: Platform.OS,
                            sessionInfo,
                            outputSummary,
                            released: releaseResult.released,
                        },
                    }
                } catch (e) {
                    _lastAsyncResult = { op, status: 'error', error: String(e) }
                }
            })()
            return { op, status: 'pending' }
        },

        scrollView: (options: { testId?: string; offset?: number; animated?: boolean } = {}) => {
            const { testId, offset = 300, animated = false } = options
            try {
                const tryScroll = (fiber: Record<string, unknown> | null): boolean => {
                    if (!fiber) return false
                    const stateNode = fiber.stateNode as Record<string, unknown> | null
                    if (stateNode) {
                        if (typeof stateNode.scrollTo === 'function') {
                            const node = stateNode as {
                                scrollTo: (opts: { y: number; animated: boolean }) => void
                            }
                            node.scrollTo({ y: offset, animated })
                            return true
                        }
                        if (typeof stateNode.scrollToOffset === 'function') {
                            const node = stateNode as {
                                scrollToOffset: (opts: {
                                    offset: number
                                    animated: boolean
                                }) => void
                            }
                            node.scrollToOffset({ offset, animated })
                            return true
                        }
                    }
                    if (tryScroll(fiber.child as Record<string, unknown> | null)) return true
                    if (tryScroll(fiber.sibling as Record<string, unknown> | null)) return true
                    return false
                }

                for (const fiberRoots of getFiberRoots()) {
                    let scrolled = false
                    fiberRoots.forEach((root) => {
                        if (scrolled) return
                        const rootFiber = root.current as Record<string, unknown> | null
                        if (testId) {
                            const anchor = findFiberByTestId(testId)
                            if (anchor) {
                                scrolled =
                                    tryScroll(anchor) ||
                                    tryScroll(anchor.child as Record<string, unknown> | null) ||
                                    tryScroll(anchor.sibling as Record<string, unknown> | null)
                            }
                        } else {
                            scrolled = tryScroll(rootFiber)
                        }
                    })
                    if (scrolled) return { ok: true, testId, offset, animated }
                }
                return {
                    ok: false,
                    error: testId
                        ? `No scrollable found near testID="${testId}"`
                        : 'No scrollable found in fiber tree',
                }
            } catch (e) {
                return { ok: false, error: String(e) }
            }
        },
    }
}
