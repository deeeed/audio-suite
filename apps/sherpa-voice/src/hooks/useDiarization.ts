import { Diarization, DiarizationSegment } from '@siteed/sherpa-onnx.rn'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import { useEffect, useRef, useState } from 'react'
import { makeWebProgressHandler, getWebModelBaseUrl } from '../utils/webModelUtils'
import { useModelManagement } from '../contexts/ModelManagement'
import {
    useModels,
    useSpeakerIdModelWithConfig,
    useSpeakerIdModels,
} from './useModelWithConfig'
import { DEFAULT_NUM_THREADS } from '../utils/constants'
import { baseLogger } from '../config'
import { setAgenticPageState } from '../agentic-bridge'

const logger = baseLogger.extend('Diarization')

const SAMPLE_AUDIO_FILES = [
    {
        id: 'turns-jfk-en',
        name: 'Multi-speaker turns: JFK + English sample',
        description:
            'Bundled validation sample with alternating speakers; use this before single-speaker clips.',
        expectedSpeakers: 2,
        module: require('@assets/audio/diarization-jfk-en-turns.wav'),
    },
    {
        id: '1',
        name: 'JFK Speech Extract',
        description: 'Single-speaker sample; useful as a one-speaker control.',
        expectedSpeakers: 1,
        module: require('@assets/audio/jfk.wav'),
    },
    {
        id: '2',
        name: 'Random English Voice',
        description: 'Single-speaker sample; useful as a one-speaker control.',
        expectedSpeakers: 1,
        module: require('@assets/audio/en.wav'),
    },
]

export type DiarizationAudioFile = {
    id: string
    name: string
    description?: string
    expectedSpeakers?: number
    module?: number
    localUri: string
}

export function useDiarization() {
    const [initialized, setInitialized] = useState(false)
    const [loading, setLoading] = useState(false)
    const [processing, setProcessing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [statusMessage, setStatusMessage] = useState('')

    const [selectedSegModelId, setSelectedSegModelId] = useState<string | null>(
        null
    )
    const [selectedEmbModelId, setSelectedEmbModelId] = useState<string | null>(
        null
    )

    const [numClusters, setNumClusters] = useState(-1)
    const [threshold, setThreshold] = useState(0.5)
    const [numThreads, setNumThreads] = useState(DEFAULT_NUM_THREADS)

    const [segments, setSegments] = useState<DiarizationSegment[]>([])
    const [numSpeakers, setNumSpeakers] = useState(0)
    const [processingDurationMs, setProcessingDurationMs] = useState(0)

    const [loadedAudioFiles, setLoadedAudioFiles] = useState<
        DiarizationAudioFile[]
    >([])
    const [selectedAudio, setSelectedAudio] =
        useState<DiarizationAudioFile | null>(null)

    const { downloadedModels: segModels } = useModels({
        modelType: 'diarization-segmentation',
    })
    const { downloadedModels: embModels } = useSpeakerIdModels()
    const { getModelState } = useModelManagement()
    const { speakerIdConfig } = useSpeakerIdModelWithConfig({
        modelId: selectedEmbModelId,
    })

    // Auto-select first available segmentation model
    useEffect(() => {
        if (segModels.length > 0 && !selectedSegModelId) {
            setSelectedSegModelId(segModels[0].metadata.id)
        }
    }, [segModels, selectedSegModelId])

    // Auto-select first available embedding model
    useEffect(() => {
        if (embModels.length > 0 && !selectedEmbModelId) {
            setSelectedEmbModelId(embModels[0].metadata.id)
        }
    }, [embModels, selectedEmbModelId])

    // Load sample audio assets on mount
    useEffect(() => {
        ;(async () => {
            try {
                const assets = SAMPLE_AUDIO_FILES.map((f) =>
                    Asset.fromModule(f.module)
                )
                await Promise.all(assets.map((a) => a.downloadAsync()))
                setLoadedAudioFiles(
                    SAMPLE_AUDIO_FILES.map((f, i) => ({
                        ...f,
                        localUri: assets[i].localUri || assets[i].uri || '',
                    }))
                )
            } catch (err) {
                logger.error(`Failed to load audio assets: ${err instanceof Error ? err.message : String(err)}`)
            }
        })()
    }, [])

    // Cleanup on unmount
    const initializedRef = useRef(false)
    useEffect(() => {
        initializedRef.current = initialized
    }, [initialized])
    useEffect(() => {
        return () => {
            if (initializedRef.current) Diarization.release().catch(() => {})
        }
    }, [])

    const resolveModelDir = async (rawPath: string): Promise<string> => {
        let cleanPath = rawPath.replace(/^file:\/\//, '')
        try {
            const dirContents = await FileSystem.readDirectoryAsync(rawPath)
            const sherpaDir = dirContents.find(
                (item) =>
                    item.includes('sherpa-onnx') || item.includes('pyannote')
            )
            if (sherpaDir) {
                const subPath = `${rawPath}/${sherpaDir}`
                const subInfo = await FileSystem.getInfoAsync(subPath)
                if (subInfo.exists && subInfo.isDirectory) {
                    const subContents =
                        await FileSystem.readDirectoryAsync(subPath)
                    if (subContents.some((f) => f.endsWith('.onnx'))) {
                        cleanPath = cleanPath + '/' + sherpaDir
                    }
                }
            }
        } catch {
            /* use original path */
        }
        return cleanPath
    }

    const handleInit = async () => {
        const segModelState = selectedSegModelId
            ? getModelState(selectedSegModelId)
            : undefined
        const embModelState = selectedEmbModelId
            ? getModelState(selectedEmbModelId)
            : undefined

        if (!segModelState?.localPath) {
            setError('Please download the segmentation model first')
            return
        }
        if (!embModelState?.localPath) {
            setError('Please download the embedding model first')
            return
        }

        if (initialized) {
            await Diarization.release().catch(() => {})
            setInitialized(false)
        }

        setLoading(true)
        setError(null)
        setStatusMessage('Initializing diarization...')

        try {
            const segModelDir = await resolveModelDir(segModelState.localPath)
            const cleanEmbPath = embModelState.localPath.replace(
                /^file:\/\//,
                ''
            )
            const modelFile = speakerIdConfig?.modelFile || 'model.onnx'
            const embeddingModelFile = `${cleanEmbPath}/${modelFile}`

            logger.info(`Calling Diarization.init() - segModel: ${selectedSegModelId}, embModel: ${selectedEmbModelId}`)
            setStatusMessage(`Loading models...`)
            const result = await Diarization.init({
                segmentationModelDir: segModelDir,
                // The validation profile intentionally selects the full
                // pyannote model for quality. Int8 is available only as an
                // explicit size/speed tradeoff.
                segmentationModelFile: 'model.onnx',
                embeddingModelFile,
                numThreads,
                numClusters,
                threshold,
                modelBaseUrl: getWebModelBaseUrl('diarization'),
                onProgress: makeWebProgressHandler(setStatusMessage),
            })

            if (result.success) {
                setInitialized(true)
                setStatusMessage(
                    `Initialized (sample rate: ${result.sampleRate} Hz)`
                )
                logger.info(`Diarization initialized, sampleRate: ${result.sampleRate}`)
            } else {
                throw new Error(result.error || 'Initialization failed')
            }
        } catch (err) {
            logger.error(`Diarization.init() failed: ${err instanceof Error ? err.message : String(err)}`)
            setError(
                `Initialization error: ${err instanceof Error ? err.message : String(err)}`
            )
            setInitialized(false)
        } finally {
            setLoading(false)
        }
    }

    const handleProcessFile = async (audioFile: DiarizationAudioFile) => {
        if (!initialized) {
            setError('Initialize diarization first')
            return
        }

        setProcessing(true)
        setError(null)
        setSegments([])
        setNumSpeakers(0)
        setProcessingDurationMs(0)
        setStatusMessage('Processing audio...')

        try {
            const uri = audioFile.localUri.startsWith('http')
                ? audioFile.localUri
                : audioFile.localUri.startsWith('file://')
                  ? audioFile.localUri
                  : `file://${audioFile.localUri}`

            logger.info(`Calling Diarization.processFile() - uri: ${uri}`)
            const result = await Diarization.processFile(
                uri,
                numClusters,
                threshold
            )
            if (result.success) {
                setSegments(result.segments)
                setNumSpeakers(result.numSpeakers)
                setProcessingDurationMs(result.durationMs)
                setStatusMessage(
                    `Found ${result.numSpeakers} speaker(s) in ${result.durationMs}ms`
                )
                logger.info(`Diarization: ${result.numSpeakers} speakers, ${result.segments.length} segments in ${result.durationMs}ms`)
            } else {
                throw new Error(result.error || 'Processing failed')
            }
        } catch (err) {
            logger.error(`Diarization.processFile() failed: ${err instanceof Error ? err.message : String(err)}`)
            setError(
                `Processing error: ${err instanceof Error ? err.message : String(err)}`
            )
            setStatusMessage('')
        } finally {
            setProcessing(false)
        }
    }

    const handleRelease = async () => {
        if (!initialized) return
        setLoading(true)
        setStatusMessage('Releasing resources...')
        try {
            await Diarization.release()
            setInitialized(false)
            setSegments([])
            setNumSpeakers(0)
            setProcessingDurationMs(0)
            setStatusMessage('')
        } catch (err) {
            setError(
                `Release error: ${err instanceof Error ? err.message : String(err)}`
            )
        } finally {
            setLoading(false)
        }
    }

    const handleSelectAudio = (audioFile: DiarizationAudioFile) => {
        setSelectedAudio(audioFile)
        setSegments([])
        setNumSpeakers(0)
        setProcessingDurationMs(0)
        setError(null)
    }

    useEffect(() => {
        setAgenticPageState({
            feature: 'diarization',
            selectedSegModelId,
            selectedEmbModelId,
            initialized,
            loading,
            processing,
            error,
            statusMessage,
            selectedAudio: selectedAudio
                ? {
                      id: selectedAudio.id,
                      name: selectedAudio.name,
                      description: selectedAudio.description,
                      expectedSpeakers: selectedAudio.expectedSpeakers,
                      localUri: selectedAudio.localUri,
                  }
                : null,
            loadedAudioFileIds: loadedAudioFiles.map((audio) => audio.id),
            numClusters,
            threshold,
            numThreads,
            numSpeakers,
            processingDurationMs,
            segmentsCount: segments.length,
            segmentPreview: segments.slice(0, 20),
        })
    }, [
        selectedSegModelId,
        selectedEmbModelId,
        initialized,
        loading,
        processing,
        error,
        statusMessage,
        selectedAudio,
        loadedAudioFiles,
        numClusters,
        threshold,
        numThreads,
        numSpeakers,
        processingDurationMs,
        segments,
    ])

    return {
        // State
        initialized,
        loading,
        processing,
        error,
        statusMessage,
        selectedSegModelId,
        selectedEmbModelId,
        numClusters,
        threshold,
        numThreads,
        segments,
        numSpeakers,
        processingDurationMs,
        loadedAudioFiles,
        selectedAudio,
        // Derived
        segModels,
        embModels,
        // Setters
        setSelectedSegModelId,
        setSelectedEmbModelId,
        setNumClusters,
        setThreshold,
        setNumThreads,
        // Handlers
        handleInit,
        handleRelease,
        handleSelectAudio,
        handleProcessFile,
    }
}
