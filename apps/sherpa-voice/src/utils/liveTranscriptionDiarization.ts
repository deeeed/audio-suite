import { ASR, SpeakerId, VAD } from '@siteed/sherpa-onnx.rn'
import { DEFAULT_NUM_THREADS } from './constants'
import { getAsrModelConfigById, getModelConfigById } from '../hooks/useModelConfig'

export type LiveTranscriptionDiarizationModelInitOptions = {
    asrModelId: string
    vadModelId: string
    speakerIdModelId: string
    asrModelDir: string
    vadModelDir: string
    speakerModelDir: string
    numThreads?: number
    /**
     * Release process-global Sherpa ASR/VAD/SpeakerId instances before initialization.
     * Defaults to true for validation screens so stale native sessions do not conflict
     * with the selected live transcription/diarization models.
     */
    releaseExisting?: boolean
}

export async function initializeLiveTranscriptionDiarizationModels(
    options: LiveTranscriptionDiarizationModelInitOptions
) {
    const requestedThreads = options.numThreads ?? DEFAULT_NUM_THREADS

    const asrConfig =
        getAsrModelConfigById(options.asrModelId) ??
        getModelConfigById(options.asrModelId)?.asrConfig
    const vadConfig = getModelConfigById(options.vadModelId)?.vadConfig
    const speakerIdConfig = getModelConfigById(options.speakerIdModelId)?.speakerIdConfig

    if (!asrConfig?.modelType) {
        throw new Error(`ASR modelType missing for ${options.asrModelId}`)
    }
    if (!asrConfig.streaming) {
        throw new Error(
            `ASR model ${options.asrModelId} is not streaming; live validation needs a streaming ASR model.`
        )
    }
    if (!vadConfig) {
        throw new Error(`VAD config not found for ${options.vadModelId}`)
    }
    if (!speakerIdConfig) {
        throw new Error(`Speaker ID config not found for ${options.speakerIdModelId}`)
    }

    if (options.releaseExisting ?? true) {
        await Promise.all([
            ASR.release().catch(() => {}),
            VAD.release().catch(() => {}),
            SpeakerId.release().catch(() => {}),
        ])
    }

    try {
        const asrInit = await ASR.initialize({
            ...asrConfig,
            modelType: asrConfig.modelType,
            modelDir: options.asrModelDir,
            numThreads: requestedThreads,
            streaming: true,
        })
        if (!asrInit.success) {
            throw new Error(asrInit.error || 'ASR init failed')
        }
        const stream = await ASR.createOnlineStream()
        if (!stream.success) {
            const streamError = (stream as { error?: string }).error
            throw new Error(streamError || 'ASR createOnlineStream failed')
        }

        const vadInit = await VAD.init({
            ...vadConfig,
            modelDir: options.vadModelDir,
            // Silero VAD is stateful and processed serially in the live pipeline.
            numThreads: 1,
        })
        if (!vadInit.success) {
            throw new Error(vadInit.error || 'VAD init failed')
        }

        const speakerInit = await SpeakerId.init({
            ...speakerIdConfig,
            modelDir: options.speakerModelDir,
            numThreads: requestedThreads,
        })
        if (!speakerInit.success) {
            throw new Error(speakerInit.error || 'Speaker ID init failed')
        }
    } catch (error) {
        await Promise.all([
            ASR.release().catch(() => {}),
            VAD.release().catch(() => {}),
            SpeakerId.release().catch(() => {}),
        ])
        throw error
    }

    return {
        asrModelId: options.asrModelId,
        vadModelId: options.vadModelId,
        speakerIdModelId: options.speakerIdModelId,
        requestedThreads,
    }
}
