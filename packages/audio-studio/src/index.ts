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

export {
    AudioRecorderProvider,
    AudioStudioModule,
    extractRawWavAnalysis,
    extractAudioAnalysis,
    extractPreview,
    trimAudio,
    extractAudioData,
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

// Export all types
export type * from './AudioAnalysis/AudioAnalysis.types'
export type * from './AudioStudio.types'

/** @deprecated Use AudioStudioModule instead */
export const ExpoAudioStreamModule = AudioStudioModule
