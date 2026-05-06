import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'

import { Platform } from 'react-native'

import { baseLogger } from '../config'
import {
    getBenchmarkModelStatus,
    prepareBenchmarkModel,
} from '../utils/asrBenchmarkRuntime'

const logger = baseLogger.extend('MoonshinePreload')

const DEFAULT_MODEL_ID = 'moonshine-small-streaming-en'

export type MoonshinePreloadStatus = 'idle' | 'preparing' | 'ready' | 'error'

export interface MoonshinePreloadValue {
    /**
     * Lifecycle state of the bundled-or-downloaded Moonshine model.
     * - idle: preload not yet started this session.
     * - preparing: validating files and downloading any missing pieces.
     * - ready: every required file is on disk (or web-bundled) and verified.
     * - error: download or validation failed; consumers can call retry().
     */
    status: MoonshinePreloadStatus
    /** Human-readable progress / status string for UI surfacing. */
    message: string | null
    /** Error message if status is 'error'; otherwise null. */
    error: string | null
    /** Underlying model id this preload manages. */
    modelId: string
    /** Force a (re-)preload. Idempotent while a preload is already running. */
    retry: () => Promise<void>
}

const MoonshinePreloadContext = createContext<MoonshinePreloadValue | null>(null)

interface ProviderProps {
    children: React.ReactNode
    /**
     * Override the model preloaded at boot. Defaults to small-streaming-en
     * which matches the chat-record demo. Set to null to skip preloading
     * entirely (e.g. for tests).
     */
    modelId?: string | null
    /**
     * If true (default) the preload kicks off automatically on mount.
     * Set false to defer until a consumer explicitly calls `retry()`.
     */
    autoStart?: boolean
}

export function MoonshinePreloadProvider({
    children,
    modelId = DEFAULT_MODEL_ID,
    autoStart = true,
}: ProviderProps) {
    const [status, setStatus] = useState<MoonshinePreloadStatus>('idle')
    const [message, setMessage] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const inFlightRef = useRef<Promise<void> | null>(null)

    const runPreload = useCallback(async () => {
        if (!modelId) return
        if (inFlightRef.current) return inFlightRef.current

        const job = (async () => {
            setError(null)
            setStatus('preparing')
            try {
                // Web ships the model assets inside the moonshine package, so
                // getBenchmarkModelStatus returns downloaded:true immediately.
                // Skip the prepare step there to avoid pointless filesystem
                // calls, but keep the same status sequencing.
                if (Platform.OS === 'web') {
                    const webStatus = await getBenchmarkModelStatus(modelId)
                    setMessage(
                        webStatus.downloaded
                            ? 'Moonshine ready (bundled web assets).'
                            : 'Moonshine web assets unavailable.',
                    )
                    setStatus(webStatus.downloaded ? 'ready' : 'error')
                    if (!webStatus.downloaded) {
                        setError('Moonshine web assets unavailable')
                    }
                    return
                }

                await prepareBenchmarkModel(modelId, (text) => setMessage(text))
                setMessage('Moonshine model ready.')
                setStatus('ready')
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e)
                logger.warn(`Moonshine preload failed: ${msg}`)
                setError(msg)
                setMessage(`Preload failed: ${msg}`)
                setStatus('error')
            } finally {
                inFlightRef.current = null
            }
        })()
        inFlightRef.current = job
        return job
    }, [modelId])

    useEffect(() => {
        if (!autoStart) return
        void runPreload()
    }, [autoStart, runPreload])

    const value = useMemo<MoonshinePreloadValue>(
        () => ({
            status,
            message,
            error,
            modelId: modelId ?? '',
            retry: runPreload,
        }),
        [status, message, error, modelId, runPreload],
    )

    return (
        <MoonshinePreloadContext.Provider value={value}>
            {children}
        </MoonshinePreloadContext.Provider>
    )
}

export function useMoonshinePreload(): MoonshinePreloadValue {
    const ctx = useContext(MoonshinePreloadContext)
    if (!ctx) {
        throw new Error(
            'useMoonshinePreload must be used inside <MoonshinePreloadProvider>',
        )
    }
    return ctx
}
