import { useCallback, useEffect, useRef, useState } from 'react'

import {
    AudioPlayer,
    AudioStatus,
    createAudioPlayer,
} from 'expo-audio'

import { isWeb } from '../utils/utils'

export interface AudioPlaybackController {
    fileUri: string | null
    durationMs: number
    currentTimeMs: number
    isPlaying: boolean
    isLoaded: boolean
    error: string | null
    load: (uri: string) => void
    play: () => void
    pause: () => void
    toggle: () => void
    seek: (timeMs: number) => void
    teardown: () => void
}

function normalizeUri(uri: string): string {
    if (isWeb) return uri.replace(/^file:\/\//, '')
    return uri.startsWith('file://') ? uri : `file://${uri}`
}

/**
 * Playback controller for the AudioPlayerWidget. Engine-agnostic surface,
 * currently backed by `expo-audio`. Lives in the playground app — do NOT
 * promote to audio-ui (UI-only boundary).
 */
export function useAudioPlayback(): AudioPlaybackController {
    const playerRef = useRef<AudioPlayer | null>(null)
    const fileUriRef = useRef<string | null>(null)
    const [fileUri, setFileUri] = useState<string | null>(null)
    const [durationMs, setDurationMs] = useState(0)
    const [currentTimeMs, setCurrentTimeMs] = useState(0)
    const [isPlaying, setIsPlaying] = useState(false)
    const [isLoaded, setIsLoaded] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const teardown = useCallback(() => {
        const p = playerRef.current
        if (p) {
            try {
                p.pause()
            } catch {
                // ignore
            }
            try {
                p.remove()
            } catch {
                // ignore
            }
        }
        playerRef.current = null
        fileUriRef.current = null
        setFileUri(null)
        setIsPlaying(false)
        setIsLoaded(false)
        setCurrentTimeMs(0)
        setDurationMs(0)
    }, [])

    useEffect(() => {
        return () => {
            teardown()
        }
    }, [teardown])

    const handleStatus = useCallback((status: AudioStatus) => {
        setIsLoaded(status.isLoaded)
        if (typeof status.duration === 'number' && status.duration > 0) {
            setDurationMs(status.duration * 1000)
        }
        if (typeof status.currentTime === 'number') {
            setCurrentTimeMs(status.currentTime * 1000)
        }
        if (typeof status.playing === 'boolean') {
            setIsPlaying(status.playing)
        }
        if (status.didJustFinish) {
            setIsPlaying(false)
            // Pre-arm for the next play(): rewind silently so the user can
            // simply tap play again. The status update that follows will
            // sync currentTimeMs back to 0.
            try {
                playerRef.current?.seekTo(0)
            } catch {
                // ignore
            }
        }
    }, [])

    const load = useCallback(
        (uri: string) => {
            try {
                if (fileUriRef.current === uri && playerRef.current) return
                teardown()
                const normalized = normalizeUri(uri)
                const player = createAudioPlayer({ uri: normalized })
                player.addListener('playbackStatusUpdate', handleStatus)
                playerRef.current = player
                fileUriRef.current = uri
                setFileUri(uri)
                setError(null)
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
            }
        },
        [handleStatus, teardown],
    )

    const play = useCallback(async () => {
        try {
            const player = playerRef.current
            if (!player) return
            const dur = typeof player.duration === 'number' ? player.duration : 0
            const cur = typeof player.currentTime === 'number' ? player.currentTime : 0
            // expo-audio leaves currentTime at the end after `didJustFinish`,
            // and a bare play() then no-ops. Await seekTo so the player has
            // actually rewound before we kick playback again.
            if (dur > 0 && cur >= dur - 0.05) {
                try {
                    player.pause()
                } catch {
                    // already paused after finish — ignore
                }
                await player.seekTo(0)
                setCurrentTimeMs(0)
            }
            player.play()
            setIsPlaying(true)
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        }
    }, [])

    const pause = useCallback(() => {
        try {
            playerRef.current?.pause()
            setIsPlaying(false)
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        }
    }, [])

    const toggle = useCallback(() => {
        if (isPlaying) pause()
        else play()
    }, [isPlaying, play, pause])

    const seek = useCallback((timeMs: number) => {
        try {
            const seconds = Math.max(0, timeMs / 1000)
            playerRef.current?.seekTo(seconds)
            setCurrentTimeMs(timeMs)
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        }
    }, [])

    return {
        fileUri,
        durationMs,
        currentTimeMs,
        isPlaying,
        isLoaded,
        error,
        load,
        play,
        pause,
        toggle,
        seek,
        teardown,
    }
}
