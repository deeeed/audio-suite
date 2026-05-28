/**
 * Invisible component that syncs route and audio state into the agentic bridge.
 * Rendered inside _layout.tsx as a child of both the router and AudioRecorderProvider.
 * Only active in __DEV__ mode — renders null in production.
 */

import { usePathname, useSegments } from 'expo-router'
import { useEffect } from 'react'

import { useSharedAudioRecorder } from '@siteed/audio-studio'

import { setAgenticAudioState, setAgenticRecorder, setAgenticRouteInfo } from '../agentic-bridge'

export function AgenticBridgeSync() {
    if (!__DEV__) return null

    return <AgenticBridgeSyncInner />
}

function AgenticBridgeSyncInner() {
    const pathname = usePathname()
    const segments = useSegments()
    const recorder = useSharedAudioRecorder()
    const {
        isRecording,
        isPaused,
        durationMs,
        size,
        compression,
        maxDurationMs,
        maxDurationReached,
        lastRecordingReason,
    } = recorder

    // Wire the recorder instance into the bridge on mount
    useEffect(() => {
        setAgenticRecorder(recorder)
    }, [recorder])

    useEffect(() => {
        setAgenticRouteInfo(pathname, segments)
    }, [pathname, segments])

    useEffect(() => {
        setAgenticAudioState({
            isRecording,
            isPaused,
            durationMs,
            size,
            compression,
            maxDurationMs,
            maxDurationReached,
            lastRecordingReason,
        })
    }, [
        isRecording,
        isPaused,
        durationMs,
        size,
        compression,
        maxDurationMs,
        maxDurationReached,
        lastRecordingReason,
    ])

    return null
}
