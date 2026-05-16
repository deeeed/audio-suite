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
    releaseExisting?: boolean
}

export async function initializeLiveTranscriptionDiarizationModels(
    options: LiveTranscriptionDiarizationModelInitOptions
) {
    const requestedThreads = options.numThreads ?? DEFAULT_NUM_THREADS

    if (options.releaseExisting ?? true) {
        await Promise.all([
            ASR.release().catch(() => {}),
            VAD.release().catch(() => {}),
            SpeakerId.release().catch(() => {}),
        ])
    }

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
        throw new Error('ASR createOnlineStream failed')
    }

    const vadInit = await VAD.init({
        ...vadConfig,
        modelDir: options.vadModelDir,
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

    return {
        asrModelId: options.asrModelId,
        vadModelId: options.vadModelId,
        speakerIdModelId: options.speakerIdModelId,
        requestedThreads,
    }
}
