import React, { useCallback, useState, useEffect } from 'react'
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated'

import {
    getMinRangeDuration,
    sanitizeTimeRange,
} from './AudioTimeRangeSelector.utils'

const HANDLE_GAP_PX = 20
const HANDLE_HIT_SLOP_PX = 32
const EXTRA_LABEL_SPACE_PX = 30
const TIME_LABEL_WIDTH_PX = 56
const ACTIVE_HANDLE_BACKGROUND_COLOR = '#0056b3'

export interface AudioTimeRangeSelectorTheme {
    container: {
        backgroundColor: string
        height: number
        borderRadius: number
    }
    selectedRange: {
        backgroundColor: string
        opacity: number
    }
    handle: {
        backgroundColor: string
        activeBackgroundColor?: string
        width: number
    }
}

export type AudioTimeRangeSelectorThemeOverrides = {
    [Section in keyof AudioTimeRangeSelectorTheme]?: Partial<
        AudioTimeRangeSelectorTheme[Section]
    >
}

const DEFAULT_THEME: AudioTimeRangeSelectorTheme = {
    container: {
        backgroundColor: '#E5E5E5',
        height: 48,
        borderRadius: 8,
    },
    selectedRange: {
        backgroundColor: '#007AFF',
        opacity: 0.5,
    },
    handle: {
        backgroundColor: '#007AFF',
        activeBackgroundColor: ACTIVE_HANDLE_BACKGROUND_COLOR,
        width: 20,
    },
}

export interface AudioTimeRangeSelectorProps {
    durationMs: number
    startTime: number
    endTime: number
    /**
     * Called when the user commits a range change.
     *
     * This fires after a handle or selected-range drag finishes, preserving
     * the previous end-only update behavior for controlled consumers.
     */
    onRangeChange: (start: number, end: number) => void
    /**
     * Called continuously while a handle or selected range is dragged.
     *
     * Use this for live previews, scrub indicators, or transient UI. Keep
     * `onRangeChange` as the source of committed state.
     */
    onRangeChanging?: (start: number, end: number) => void
    /**
     * Called after `onRangeChange` when a drag commits.
     *
     * Kept for consumers that distinguish committed changes from completion
     * side effects such as analytics, persistence, or expensive recalculation.
     */
    onRangeChangeComplete?: (start: number, end: number) => void
    disabled?: boolean
    /**
     * Enables dragging the selected range body while preserving its duration.
     *
     * Defaults to true. Set false when the selected range should not intercept
     * body gestures, such as tap-to-seek or parent scroll interactions.
     */
    rangeDragEnabled?: boolean
    theme?: AudioTimeRangeSelectorThemeOverrides
}

interface TimeLabel {
    time: number
    handle: 'start' | 'end' | null
    position?: number
}

export function AudioTimeRangeSelector({
    durationMs,
    startTime,
    endTime,
    onRangeChange,
    onRangeChanging,
    onRangeChangeComplete,
    disabled,
    rangeDragEnabled = true,
    theme: customTheme,
}: AudioTimeRangeSelectorProps) {
    const theme = {
        container: { ...DEFAULT_THEME.container, ...customTheme?.container },
        selectedRange: {
            ...DEFAULT_THEME.selectedRange,
            ...customTheme?.selectedRange,
        },
        handle: { ...DEFAULT_THEME.handle, ...customTheme?.handle },
    }
    const [containerWidth, setContainerWidth] = useState(0)
    const [activeLabel, setActiveLabel] = useState<TimeLabel | null>(null)
    const isRangeDragActive = !disabled && rangeDragEnabled
    const isDragging = useSharedValue(false)
    const activeHandle = useSharedValue<'start' | 'end' | null>(null)

    const startPosition = useSharedValue(0)
    const endPosition = useSharedValue(0)

    const lastUpdate = useSharedValue({ start: startTime, end: endTime })
    const rangeDragStart = useSharedValue({ start: startTime, end: endTime })

    const updateTimeout = useSharedValue<number | null>(null)

    useEffect(() => {
        if (containerWidth === 0 || durationMs <= 0 || isDragging.value) return

        // Clear any existing timeout
        if (updateTimeout.value) {
            clearTimeout(updateTimeout.value)
        }

        // Set a new timeout to update positions after a delay
        updateTimeout.value = setTimeout(() => {
            const range = sanitizeTimeRange(startTime, endTime, durationMs)

            lastUpdate.value = range
            startPosition.value = (range.start / durationMs) * containerWidth
            endPosition.value = (range.end / durationMs) * containerWidth

            if (range.start !== startTime || range.end !== endTime) {
                runOnJS(onRangeChange)(range.start, range.end)
            }
        }, 100) as unknown as number

        // Cleanup timeout
        return () => {
            if (updateTimeout.value) {
                clearTimeout(updateTimeout.value)
            }
        }
    }, [startTime, endTime, durationMs, containerWidth])

    const emitRangeChangeComplete = useCallback(
        (start: number, end: number) => {
            onRangeChange(start, end)
            if (onRangeChangeComplete) {
                onRangeChangeComplete(start, end)
            }
        },
        [onRangeChange, onRangeChangeComplete]
    )

    const createHandleGesture = (isStart: boolean) => {
        return Gesture.Pan()
            .enabled(!disabled)
            .activeOffsetX([-5, 5])
            .activateAfterLongPress(0)
            .onStart(() => {
                'worklet'
                isDragging.value = true
                activeHandle.value = isStart ? 'start' : 'end'
                const currentTime = isStart
                    ? lastUpdate.value.start
                    : lastUpdate.value.end
                runOnJS(setActiveLabel)({
                    time: currentTime,
                    handle: isStart ? 'start' : 'end',
                    position: isStart ? startPosition.value : endPosition.value,
                })
            })
            .onChange((event) => {
                'worklet'
                if (containerWidth <= 0 || durationMs <= 0) return

                const position = isStart ? startPosition : endPosition
                const handleWidth = theme.handle.width
                const maxX = isStart
                    ? containerWidth - handleWidth
                    : containerWidth

                const newPosition = position.value + event.changeX
                const clampedX = Math.min(Math.max(0, newPosition), maxX)

                position.value = isStart
                    ? Math.min(
                          clampedX,
                          endPosition.value - handleWidth - HANDLE_GAP_PX
                      )
                    : Math.max(
                          clampedX,
                          startPosition.value + handleWidth + HANDLE_GAP_PX
                      )

                const newTimeMs = Math.round(
                    (position.value / containerWidth) * durationMs
                )
                const minRange = getMinRangeDuration(durationMs)
                const maxStartTime = Math.max(
                    0,
                    Math.min(
                        durationMs - minRange,
                        lastUpdate.value.end - minRange
                    )
                )
                const clampedTimeMs = isStart
                    ? Math.min(Math.max(0, newTimeMs), maxStartTime)
                    : Math.min(
                          Math.max(
                              lastUpdate.value.start + minRange,
                              newTimeMs
                          ),
                          durationMs
                      )

                const safeCurrentStart = Math.min(
                    Math.max(0, lastUpdate.value.start),
                    Math.max(0, durationMs - minRange)
                )
                const safeCurrentEnd = Math.min(
                    Math.max(safeCurrentStart + minRange, lastUpdate.value.end),
                    durationMs
                )
                const nextStart = isStart ? clampedTimeMs : safeCurrentStart
                const nextEnd = isStart ? safeCurrentEnd : clampedTimeMs

                if (isStart) {
                    lastUpdate.value = {
                        ...lastUpdate.value,
                        start: nextStart,
                    }
                } else {
                    lastUpdate.value = {
                        ...lastUpdate.value,
                        end: nextEnd,
                    }
                }

                runOnJS(setActiveLabel)({
                    time: clampedTimeMs,
                    handle: isStart ? 'start' : 'end',
                    position: position.value,
                })
                if (onRangeChanging) {
                    runOnJS(onRangeChanging)(nextStart, nextEnd)
                }
            })
            .onFinalize(() => {
                'worklet'
                const finalStart = lastUpdate.value.start
                const finalEnd = lastUpdate.value.end

                isDragging.value = false
                activeHandle.value = null
                runOnJS(setActiveLabel)(null)

                runOnJS(emitRangeChangeComplete)(finalStart, finalEnd)
            })
    }

    const startHandleGesture = createHandleGesture(true)
    const endHandleGesture = createHandleGesture(false)

    const rangeMoveGesture = Gesture.Pan()
        .enabled(isRangeDragActive)
        .activeOffsetX([-5, 5])
        .activateAfterLongPress(0)
        .onStart(() => {
            'worklet'
            isDragging.value = true
            activeHandle.value = null
            const minRange = getMinRangeDuration(durationMs)
            const safeStart = Math.min(
                Math.max(0, lastUpdate.value.start),
                Math.max(0, durationMs - minRange)
            )
            const safeEnd = Math.min(
                Math.max(safeStart + minRange, lastUpdate.value.end),
                durationMs
            )
            rangeDragStart.value = {
                start: safeStart,
                end: safeEnd,
            }
            lastUpdate.value = rangeDragStart.value
            startPosition.value =
                durationMs > 0 ? (safeStart / durationMs) * containerWidth : 0
            endPosition.value =
                durationMs > 0 ? (safeEnd / durationMs) * containerWidth : 0
            runOnJS(setActiveLabel)(null)
        })
        .onChange((event) => {
            'worklet'
            if (containerWidth <= 0 || durationMs <= 0) return

            const rangeDuration = Math.min(
                rangeDragStart.value.end - rangeDragStart.value.start,
                durationMs
            )
            const maxStartTime = Math.max(0, durationMs - rangeDuration)
            const deltaTimeMs = Math.round(
                (event.translationX / containerWidth) * durationMs
            )
            const nextStartTime = Math.min(
                Math.max(0, rangeDragStart.value.start + deltaTimeMs),
                maxStartTime
            )
            const nextEndTime = nextStartTime + rangeDuration

            lastUpdate.value = {
                start: nextStartTime,
                end: nextEndTime,
            }
            startPosition.value = (nextStartTime / durationMs) * containerWidth
            endPosition.value = (nextEndTime / durationMs) * containerWidth
            if (onRangeChanging) {
                runOnJS(onRangeChanging)(nextStartTime, nextEndTime)
            }
        })
        .onFinalize(() => {
            'worklet'
            const finalStart = lastUpdate.value.start
            const finalEnd = lastUpdate.value.end

            isDragging.value = false
            activeHandle.value = null
            runOnJS(setActiveLabel)(null)

            runOnJS(emitRangeChangeComplete)(finalStart, finalEnd)
        })

    const formatTime = useCallback((ms: number) => {
        if (typeof ms !== 'number' || isNaN(ms)) {
            return '0:00' // Safe fallback
        }
        const seconds = Math.floor(ms / 1000)
        const minutes = Math.floor(seconds / 60)
        const remainingSeconds = seconds % 60
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
    }, [])

    const labelStyle = useAnimatedStyle(() => ({
        opacity: isDragging.value ? 1 : 0,
        transform: [{ translateY: isDragging.value ? 0 : 10 }],
    }))

    const startHandleAnimatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: startPosition.value }],
        backgroundColor:
            activeHandle.value === 'start'
                ? withTiming(
                      theme.handle.activeBackgroundColor ??
                          ACTIVE_HANDLE_BACKGROUND_COLOR
                  )
                : withTiming(theme.handle.backgroundColor),
    }))

    const endHandleAnimatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: endPosition.value - theme.handle.width }],
        backgroundColor:
            activeHandle.value === 'end'
                ? withTiming(
                      theme.handle.activeBackgroundColor ??
                          ACTIVE_HANDLE_BACKGROUND_COLOR
                  )
                : withTiming(theme.handle.backgroundColor),
    }))

    const selectedRangeStyle = useAnimatedStyle(() => ({
        left: startPosition.value,
        right: containerWidth - endPosition.value,
        backgroundColor: theme.selectedRange.backgroundColor,
        opacity: theme.selectedRange.opacity,
    }))

    const handleLayout = useCallback(
        (event: LayoutChangeEvent) => {
            const width = event.nativeEvent.layout.width
            setContainerWidth(width)

            if (durationMs <= 0) {
                startPosition.value = 0
                endPosition.value = 0
                return
            }

            const range = sanitizeTimeRange(
                lastUpdate.value.start,
                lastUpdate.value.end,
                durationMs
            )
            lastUpdate.value = range
            startPosition.value = (range.start / durationMs) * width
            endPosition.value = (range.end / durationMs) * width
        },
        [durationMs]
    )

    return (
        <View
            onLayout={handleLayout}
            style={[
                styles.container,
                { height: theme.container.height + EXTRA_LABEL_SPACE_PX },
            ]}
        >
            <View
                style={[
                    styles.rangeContainer,
                    {
                        backgroundColor: theme.container.backgroundColor,
                        height: theme.container.height,
                        borderRadius: theme.container.borderRadius,
                    },
                ]}
            >
                <View style={styles.gestureContainer}>
                    <GestureDetector gesture={rangeMoveGesture}>
                        <Animated.View
                            pointerEvents={isRangeDragActive ? 'auto' : 'none'}
                            style={[styles.selectedRange, selectedRangeStyle]}
                        />
                    </GestureDetector>
                    <GestureDetector gesture={startHandleGesture}>
                        <Animated.View
                            pointerEvents="auto"
                            hitSlop={{
                                left: HANDLE_HIT_SLOP_PX,
                                right: HANDLE_HIT_SLOP_PX,
                                top: HANDLE_HIT_SLOP_PX,
                                bottom: HANDLE_HIT_SLOP_PX,
                            }}
                            style={[
                                styles.handle,
                                { width: theme.handle.width },
                                startHandleAnimatedStyle,
                                styles.handleTouchable,
                            ]}
                        />
                    </GestureDetector>
                    <GestureDetector gesture={endHandleGesture}>
                        <Animated.View
                            pointerEvents="auto"
                            hitSlop={{
                                left: HANDLE_HIT_SLOP_PX,
                                right: HANDLE_HIT_SLOP_PX,
                                top: HANDLE_HIT_SLOP_PX,
                                bottom: HANDLE_HIT_SLOP_PX,
                            }}
                            style={[
                                styles.handle,
                                { width: theme.handle.width },
                                endHandleAnimatedStyle,
                                styles.handleTouchable,
                            ]}
                        />
                    </GestureDetector>
                </View>
            </View>
            {activeLabel && typeof activeLabel.time === 'number' && (
                <Animated.View
                    style={[
                        styles.timeLabel,
                        labelStyle,
                        {
                            left: Math.min(
                                Math.max(
                                    0,
                                    (activeLabel.position ??
                                        (activeLabel.handle === 'end'
                                            ? containerWidth
                                            : 0)) -
                                        TIME_LABEL_WIDTH_PX / 2
                                ),
                                Math.max(
                                    0,
                                    containerWidth - TIME_LABEL_WIDTH_PX
                                )
                            ),
                        },
                    ]}
                >
                    <Text style={styles.timeLabelText}>
                        {formatTime(activeLabel.time)}
                    </Text>
                </Animated.View>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        position: 'relative',
    },
    rangeContainer: {
        overflow: 'hidden',
    },
    gestureContainer: {
        flex: 1,
        position: 'relative',
    },
    selectedRange: {
        position: 'absolute',
        top: 0,
        bottom: 0,
    },
    handle: {
        position: 'absolute',
        height: '100%',
    },
    handleTouchable: {
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    timeLabel: {
        position: 'absolute',
        top: -25,
        width: TIME_LABEL_WIDTH_PX,
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.8)',
        padding: 4,
        borderRadius: 4,
    },
    timeLabelText: {
        color: 'white',
        fontSize: 12,
    },
})
