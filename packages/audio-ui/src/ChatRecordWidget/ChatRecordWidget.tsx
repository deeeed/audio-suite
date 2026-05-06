import { MaterialIcons } from '@expo/vector-icons'
import React, { useCallback, useState } from 'react'
import {
    LayoutChangeEvent,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native'

import { WaveformPreview } from '../WaveformPreview/WaveformPreview'
import type { WaveformPoint } from '../types/waveform'

import {
    useChatRecordWidgetState,
    type ChatRecordWidgetIconMap,
    type ChatRecordWidgetIconName,
    type ChatRecordWidgetInteraction,
    type ChatRecordWidgetState,
} from './useChatRecordWidgetState'

/**
 * - 'full' (default): primary button + waveform/placeholder + slots row.
 * - 'button': primary button only. Caption (when provided) still shows below.
 */
export type ChatRecordWidgetVariant = 'full' | 'button'

/**
 * Context handed to `renderPrimary`. Provides everything needed to render a
 * fully bespoke primary button while keeping the widget's interaction logic.
 */
export interface ChatRecordWidgetPrimaryContext {
    state: ChatRecordWidgetState
    isDisabled: boolean
    primaryIcon: ChatRecordWidgetIconName
    onPress: (() => void) | undefined
    onPressIn: (() => void) | undefined
    onPressOut: (() => void) | undefined
    accentColor: string
    disabledColor: string
    iconColor: string
}

export interface ChatRecordWidgetProps {
    state: ChatRecordWidgetState
    dataPoints?: WaveformPoint[]
    width: number
    waveformHeight?: number
    elapsedMs?: number
    interaction?: ChatRecordWidgetInteraction
    variant?: ChatRecordWidgetVariant
    onRecordPress?: () => void
    onStopPress?: () => void
    onRetryPress?: () => void
    /** Render slot before the primary button (e.g. avatar, attach icon). */
    leadingSlot?: React.ReactNode
    sendSlot?: React.ReactNode
    cancelSlot?: React.ReactNode
    errorMessage?: string
    placeholderText?: string
    /** Show the rolling waveform inside the body. Default true. */
    showWaveform?: boolean
    /** Show the elapsed-time line under the waveform / placeholder. Default true. */
    showElapsed?: boolean
    /** Show the placeholder text when no dataPoints are present. Default true. */
    showPlaceholder?: boolean
    /**
     * Fixed amplitude range for the inner WaveformPreview. Pin to
     * `{ min: 0, max: 1 }` for live recording so the rolling-bar height
     * doesn't rescale every time a louder sample arrives.
     */
    amplitudeRange?: { min: number; max: number }
    /** Per-state icon overrides. Falls back to the built-in defaults. */
    primaryIcons?: ChatRecordWidgetIconMap
    /**
     * Replace the entire primary button. Use this when you need a custom
     * shape, gradient, long-press affordance, etc. — the widget keeps wiring
     * the right press handler based on `interaction`.
     */
    renderPrimary?: (ctx: ChatRecordWidgetPrimaryContext) => React.ReactNode
    /** Override the default `MM:SS` formatter for the elapsed-time line. */
    formatElapsed?: (ms: number) => string
    barColor?: string
    silentBarColor?: string
    backgroundColor?: string
    accentColor?: string
    disabledColor?: string
    iconColor?: string
    textColor?: string
    secondaryTextColor?: string
    errorColor?: string
    disabled?: boolean
    /**
     * Optional caption rendered under the row. Used by callers to surface
     * live transcription text or status hints without adding a parallel
     * layout above the widget.
     */
    caption?: string
    captionColor?: string
    testID?: string
}

function defaultFormatElapsed(ms = 0): string {
    if (!Number.isFinite(ms) || ms < 0) return '00:00'
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function ChatRecordWidget({
    state,
    dataPoints = [],
    width,
    waveformHeight = 36,
    elapsedMs = 0,
    interaction = 'tap',
    variant = 'full',
    onRecordPress,
    onStopPress,
    onRetryPress,
    leadingSlot,
    sendSlot,
    cancelSlot,
    errorMessage,
    placeholderText = 'Hold or tap to record',
    showWaveform = true,
    showElapsed = true,
    showPlaceholder = true,
    amplitudeRange,
    primaryIcons,
    renderPrimary,
    formatElapsed,
    barColor = '#7C3AED',
    silentBarColor = '#DDD6FE',
    backgroundColor = '#F8FAFC',
    accentColor = '#7C3AED',
    disabledColor = '#CBD5E1',
    iconColor = '#FFFFFF',
    textColor = '#334155',
    secondaryTextColor = '#64748B',
    errorColor = '#DC2626',
    disabled = false,
    caption,
    captionColor,
    testID = 'chat-record-widget',
}: ChatRecordWidgetProps) {
    const hasWaveform = showWaveform && dataPoints.length > 0
    const isButtonOnly = variant === 'button'
    const resolvedFormatElapsed = formatElapsed ?? defaultFormatElapsed

    const headless = useChatRecordWidgetState({
        state,
        interaction,
        onRecordPress,
        onStopPress,
        onRetryPress,
        disabled,
        primaryIcons,
    })

    const [bodyWidth, setBodyWidth] = useState(0)
    const handleBodyLayout = useCallback((e: LayoutChangeEvent) => {
        const next = Math.floor(e.nativeEvent.layout.width)
        if (next > 0) {
            setBodyWidth((prev) => (prev === next ? prev : next))
        }
    }, [])

    const primaryButton = renderPrimary ? (
        renderPrimary({
            state,
            isDisabled: headless.isDisabled,
            primaryIcon: headless.primaryIcon,
            onPress: headless.onPress,
            onPressIn: headless.onPressIn,
            onPressOut: headless.onPressOut,
            accentColor,
            disabledColor,
            iconColor,
        })
    ) : (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={state === 'recording' ? 'Stop recording' : 'Record'}
            disabled={headless.isDisabled || headless.isInert}
            onPress={headless.onPress}
            onPressIn={headless.onPressIn}
            onPressOut={headless.onPressOut}
            testID={`${testID}-primary`}
            style={[
                styles.primaryButton,
                {
                    backgroundColor: headless.isDisabled
                        ? disabledColor
                        : accentColor,
                },
            ]}
        >
            <MaterialIcons
                name={headless.primaryIcon}
                size={22}
                color={iconColor}
            />
        </Pressable>
    )

    return (
        <View
            testID={testID}
            style={[styles.container, { width, backgroundColor }]}
        >
            <View style={styles.row}>
                {leadingSlot ? (
                    <View style={styles.leading}>{leadingSlot}</View>
                ) : null}

                {primaryButton}

                {isButtonOnly ? null : (
                    <View style={styles.body} onLayout={handleBodyLayout}>
                        {hasWaveform && bodyWidth > 0 ? (
                            <WaveformPreview
                                dataPoints={dataPoints}
                                width={bodyWidth}
                                height={waveformHeight}
                                barColor={barColor}
                                silentBarColor={silentBarColor}
                                amplitudeRange={amplitudeRange}
                                testID={`${testID}-waveform`}
                            />
                        ) : showPlaceholder ? (
                            <Text
                                numberOfLines={1}
                                style={[
                                    styles.placeholder,
                                    { color: secondaryTextColor },
                                    state === 'error' && { color: errorColor },
                                ]}
                                testID={`${testID}-placeholder`}
                            >
                                {state === 'error'
                                    ? errorMessage || 'Recording failed'
                                    : placeholderText}
                            </Text>
                        ) : null}
                        {showElapsed ? (
                            <Text
                                style={[styles.elapsed, { color: textColor }]}
                                testID={`${testID}-elapsed`}
                            >
                                {resolvedFormatElapsed(elapsedMs)}
                            </Text>
                        ) : null}
                    </View>
                )}

                {isButtonOnly || (!cancelSlot && !sendSlot) ? null : (
                    <View style={styles.slots}>
                        {cancelSlot}
                        {sendSlot}
                    </View>
                )}
            </View>

            {caption ? (
                <Text
                    style={[
                        styles.caption,
                        { color: captionColor ?? secondaryTextColor },
                    ]}
                    numberOfLines={2}
                    testID={`${testID}-caption`}
                >
                    {caption}
                </Text>
            ) : null}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        minHeight: 56,
        borderRadius: 18,
        padding: 8,
        gap: 6,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    leading: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
    },
    primaryButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    body: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    placeholder: {
        fontSize: 14,
    },
    elapsed: {
        fontSize: 12,
        fontVariant: ['tabular-nums'],
    },
    slots: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
    },
    caption: {
        fontSize: 12,
        paddingHorizontal: 4,
    },
})
