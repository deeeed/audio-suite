// src/index.ts

import {
    extractRawWavAnalysis,
    extractAudioAnalysis,
} from './AudioAnalysis/extractAudioAnalysis'
import { extractAudioData } from './AudioAnalysis/extractAudioData'
import {
    extractMelSpectrogram,
    MAX_DURATION_MS,
} from './AudioAnalysis/extractMelSpectrogram'
import { extractPreview } from './AudioAnalysis/extractPreview'
import {
    initMelStreamingWasm,
    computeMelFrameWasm,
} from './AudioAnalysis/melSpectrogramWasm'
import {
    AudioRecorderProvider,
    useSharedAudioRecorder,
} from './AudioRecorder.provider'
import AudioStudioModule from './AudioStudioModule'
import {
    getAudioDecodeCapabilities,
    streamAudioData,
} from './streamAudioData'
import { trimAudio } from './trimAudio'
import { useAudioRecorder } from './useAudioRecorder'

export * from './utils/convertPCMToFloat32'
export * from './utils/getWavFileInfo'
export * from './utils/writeWavHeader'

// Export platform capabilities
export {
    getPlatformCapabilities,
    isEncodingSupported,
    isBitDepthSupported,
    getFallbackEncoding,
    getFallbackBitDepth,
    validateRecordingConfig,
    type PlatformCapabilities,
} from './constants/platformLimitations'

// Export AudioDeviceManager
export { AudioDeviceManager, audioDeviceManager } from './AudioDeviceManager'

// Export useAudioDevices hook
export { useAudioDevices } from './hooks/useAudioDevices'

export { setMelSpectrogramWasmUrl } from './AudioAnalysis/wasmConfig'
export { extractPreviewBars } from './AudioAnalysis/extractPreviewBars'

export {
    AudioRecorderProvider,
    AudioStudioModule,
    extractRawWavAnalysis,
    extractAudioAnalysis,
    extractPreview,
    trimAudio,
    extractAudioData,
    streamAudioData,
    getAudioDecodeCapabilities,
    extractMelSpectrogram,
    initMelStreamingWasm,
    computeMelFrameWasm,
    MAX_DURATION_MS,
    useAudioRecorder,
    useSharedAudioRecorder,
}

export {
    AudioExtractionError,
    mapExtractionError,
} from './errors/AudioExtractionError'
export type {
    AudioExtractionErrorCode,
    AudioExtractionErrorPayload,
} from './errors/AudioExtractionError'

export {
    AudioStreamError,
    mapStreamError,
} from './errors/AudioStreamError'
export type {
    AudioStreamErrorCode,
    AudioStreamErrorPayload,
} from './errors/AudioStreamError'

export type {
    StreamAudioDataOptions,
    StreamAudioDataChunk,
    StreamAudioDataProgress,
    StreamAudioDataResult,
    StreamAudioDataCallbacks,
    AudioDecodeCapabilities,
} from './streamAudioData'

// Export all types
export type * from './AudioAnalysis/AudioAnalysis.types'
export type * from './AudioStudio.types'

/** @deprecated Use AudioStudioModule instead */
export const ExpoAudioStreamModule = AudioStudioModule
