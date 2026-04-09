// apps/playground/src/hooks/useSileroVAD.native.ts
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import { useCallback, useRef, useState } from 'react'

import { VAD } from '@siteed/sherpa-onnx.rn'

import { baseLogger } from '../config'
import type { UseSileroVADProps, VADResult } from './useSileroVAD'

const logger = baseLogger.extend('useSileroVAD')

export function useSileroVAD({ onError }: UseSileroVADProps) {
    const [isModelLoading, setIsModelLoading] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const initializedRef = useRef(false)
    const initializingRef = useRef(false)
    const initFailedRef = useRef(false)
    const initFailureRef = useRef<Error | null>(null)

    const initVAD = useCallback(async () => {
        if (initializedRef.current || initializingRef.current) return
        if (initFailedRef.current) return
        initializingRef.current = true
        setIsModelLoading(true)
        try {
            const [asset] = await Asset.loadAsync(require('@assets/silero_vad_v5.onnx'))
            await asset.downloadAsync()
            const resolvedUri = asset.localUri ?? asset.uri
            if (!resolvedUri) {
                throw new Error('VAD asset did not resolve to a usable URI')
            }

            let fileUri = resolvedUri
            if (!fileUri.startsWith('file://')) {
                const targetUri = `${FileSystem.cacheDirectory}silero_vad_v5.onnx`
                await FileSystem.downloadAsync(fileUri, targetUri)
                fileUri = targetUri
            }

            const path = fileUri.startsWith('file://') ? fileUri.substring(7) : fileUri
            const lastSlash = path.lastIndexOf('/')
            if (lastSlash < 0) {
                throw new Error(`VAD asset path is invalid: ${path}`)
            }
            const modelDir = path.substring(0, lastSlash)
            const modelFile = path.substring(lastSlash + 1)
            logger.info('VAD model path', { modelDir, modelFile, resolvedUri })
            const result = await VAD.init({ modelDir, modelFile })
            if (!result.success) throw new Error(result.error || 'VAD init failed')
            initializedRef.current = true
            initFailedRef.current = false
            initFailureRef.current = null
            logger.info('VAD initialized via sherpa-onnx.rn')
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error('VAD init failed')
            initFailedRef.current = true
            initFailureRef.current = normalizedError
            logger.error('VAD init error', normalizedError)
            onError?.(normalizedError)
        } finally {
            setIsModelLoading(false)
            initializingRef.current = false
        }
    }, [onError])

    const isProcessingRef = useRef(false)

    const processAudioSegment = useCallback(
        async (
            audioData: Float32Array,
            sampleRate: number,
            timestamp: number = Date.now(),
        ): Promise<VADResult | null> => {
            if (isProcessingRef.current) return null
            if (!initializedRef.current) {
                await initVAD()
                if (!initializedRef.current) return null
            }
            try {
                isProcessingRef.current = true
                setIsProcessing(true)
                const result = await VAD.acceptWaveform(sampleRate, Array.from(audioData))
                if (!result.success) return null
                return {
                    probability: result.isSpeechDetected ? 0.9 : 0.1,
                    isSpeech: result.isSpeechDetected,
                    timestamp,
                }
            } catch (error) {
                logger.error('VAD processing error', error)
                onError?.(error instanceof Error ? error : new Error('VAD processing failed'))
                return null
            } finally {
                isProcessingRef.current = false
                setIsProcessing(false)
            }
        },
        [initVAD, onError],
    )

    return {
        isModelLoading,
        isProcessing,
        processAudioSegment,
        speechTimestamps: [],
        currentSegment: null,
        reset: async () => {
            initFailedRef.current = false
            initFailureRef.current = null
            await VAD.reset()
        },
        initModel: initVAD,
    }
}
