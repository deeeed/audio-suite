// packages/audio-ui/src/AudioVisualizer/GestureHandler.tsx
import type { WaveformBar } from '../types/waveform'
import React from 'react'
import { Platform } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import {
    SharedValue,
    cancelAnimation,
    runOnJS,
    useFrameCallback,
    useSharedValue,
} from 'react-native-reanimated'

import { CandleData } from './AudioVisualiser.types'

export interface GestureHandlerProps {
    playing: boolean
    mode: 'static' | 'live'
    canvasWidth: number
    candleWidth: number
    candleSpace: number
    totalCandleWidth: number
    translateX: SharedValue<number>
    maxTranslateX: number
    activePoints: CandleData[]
    onSelection: (dataPoint: WaveformBar) => void
    onDragEnd: (params: { newTranslateX: number }) => void
    children: React.ReactNode
    enableInertia?: boolean
    disableTapSelection?: boolean
}

export const GestureHandler: React.FC<GestureHandlerProps> = ({
    playing,
    mode,
    translateX,
    maxTranslateX,
    canvasWidth,
    candleSpace,
    candleWidth,
    totalCandleWidth,
    activePoints,
    onDragEnd,
    onSelection,
    children,
    enableInertia = false,
    disableTapSelection = false,
}) => {
    const velocity = useSharedValue(0)
    const isDecelerating = useSharedValue(false)

    // Inertia deceleration loop — runs on the UI thread via useFrameCallback
    // (requestAnimationFrame is not available in Reanimated worklets on Android/Hermes)
    useFrameCallback(() => {
        'worklet'
        if (!isDecelerating.value) return

        velocity.value *= 0.85
        const newTranslateX = translateX.value + velocity.value * 0.016

        if (Math.abs(velocity.value) < 5) {
            isDecelerating.value = false
            runOnJS(onDragEnd)({ newTranslateX: translateX.value })
            return
        }

        translateX.value = Math.max(-maxTranslateX, Math.min(0, newTranslateX))
    })

    if (playing || mode === 'live') {
        return <>{children}</>
    }

    const panGesture = Gesture.Pan()
        .onStart(() => {
            'worklet'
            cancelAnimation(translateX)
            velocity.value = 0
            isDecelerating.value = false
        })
        .onChange((e) => {
            'worklet'
            const newTranslateX = translateX.value + e.changeX
            translateX.value = Math.max(
                -maxTranslateX,
                Math.min(0, newTranslateX)
            )
            velocity.value = e.velocityX
        })
        .onEnd(() => {
            'worklet'
            if (enableInertia) {
                isDecelerating.value = true
            } else {
                runOnJS(onDragEnd)({ newTranslateX: translateX.value })
            }
        })

    const tapGesture = Gesture.Tap().onEnd((event) => {
        'worklet'
        if (disableTapSelection || !onSelection) {
            return
        }

        const { x } = event
        if (x < 0 || x > canvasWidth) {
            return
        }

        const plotStart = canvasWidth / 2 + translateX.value
        const plotEnd = plotStart + totalCandleWidth

        if (x < plotStart || x > plotEnd) {
            return
        }

        const adjustedX = x - plotStart
        const index = Math.floor(adjustedX / (candleWidth + candleSpace))
        const candle = activePoints[index]
        if (!candle) {
            return
        }

        runOnJS(onSelection)(candle)
    })

    // Modify the composedGesture to include the tapGesture only if tap selection is not disabled
    const composedGesture = Platform.select({
        web: Gesture.Race(
            panGesture,
            disableTapSelection ? Gesture.Tap() : tapGesture
        ),
        default: Gesture.Race(panGesture),
    })

    return (
        <GestureDetector gesture={composedGesture}>{children}</GestureDetector>
    )
}
