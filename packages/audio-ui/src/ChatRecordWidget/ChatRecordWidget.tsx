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

export type ChatRecordWidgetState =
    | 'idle'
    | 'recording'
    | 'processing'
    | 'ready'
    | 'error'
    | 'disabled'

/**
 * - 'tap' (default): tap to start, tap again to stop. Voice-memo / iMessage.
 * - 'hold': press & hold while speaking, release to stop. WhatsApp / Telegram.
 *   Caller wires `onRecordPress` (start) to press-in and `onStopPress` (stop)
 *   to press-out.
 */
export type ChatRecordWidgetInteraction = 'tap' | 'hold'

/**
 * - 'full' (default): primary button + waveform/placeholder + slots row.
 *   The kitchen-sink layout for full chat-input docks.
 * - 'button': primary button only. Use this when you want a bare mic
 *   trigger and intend to render the waveform / status / slots elsewhere.
 *   Caption, when provided, still renders below the button.
 */
export type ChatRecordWidgetVariant = 'full' | 'button'

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
     * Optional caption rendered under the waveform / placeholder. Used by
     * callers to surface live transcription text or status hints without
     * adding a parallel layout above the widget.
     */
    caption?: string
    captionColor?: string
    testID?: string
}

function formatElapsed(ms = 0): string {
    if (!Number.isFinite(ms) || ms < 0) return '00:00'
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function getPrimaryIcon(
    state: ChatRecordWidgetState
): keyof typeof MaterialIcons.glyphMap {
    switch (state) {
        case 'recording':
            return 'stop'
        case 'processing':
            return 'hourglass-empty'
        case 'ready':
            return 'check'
        case 'error':
            return 'refresh'
        case 'disabled':
            return 'mic-off'
        case 'idle':
        default:
            return 'mic'
    }
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
    sendSlot,
    cancelSlot,
    errorMessage,
    placeholderText = 'Hold or tap to record',
    showWaveform = true,
    showElapsed = true,
    showPlaceholder = true,
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
    const isDisabled =
        disabled || state === 'disabled' || state === 'processing'
    const hasWaveform = showWaveform && dataPoints.length > 0
    const isButtonOnly = variant === 'button'

    // Tap mode: one button press toggles record/stop/retry.
    // Hold mode: pressIn starts, pressOut stops; tap is ignored while
    //   recording so a quick release still triggers stop.
    const tapAction =
        state === 'recording'
            ? onStopPress
            : state === 'error'
              ? onRetryPress
              : onRecordPress

    const onPress = interaction === 'tap' ? tapAction : undefined
    const onPressIn =
        interaction === 'hold' && state !== 'recording'
            ? onRecordPress
            : undefined
    const onPressOut =
        interaction === 'hold' && state === 'recording'
            ? onStopPress
            : undefined

    const [bodyWidth, setBodyWidth] = useState(0)
    const handleBodyLayout = useCallback((e: LayoutChangeEvent) => {
        const next = Math.floor(e.nativeEvent.layout.width)
        if (next > 0) {
            setBodyWidth((prev) => (prev === next ? prev : next))
        }
    }, [])

    return (
        <View
            testID={testID}
            style={[styles.container, { width, backgroundColor }]}
        >
            <View style={styles.row}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        state === 'recording' ? 'Stop recording' : 'Record'
                    }
                    disabled={isDisabled || (!onPress && !onPressIn && !onPressOut)}
                    onPress={onPress}
                    onPressIn={onPressIn}
                    onPressOut={onPressOut}
                    testID={`${testID}-primary`}
                    style={[
                        styles.primaryButton,
                        {
                            backgroundColor: isDisabled
                                ? disabledColor
                                : accentColor,
                        },
                    ]}
                >
                    <MaterialIcons
                        name={getPrimaryIcon(state)}
                        size={22}
                        color={iconColor}
                    />
                </Pressable>

                {isButtonOnly ? null : (
                    <View style={styles.body} onLayout={handleBodyLayout}>
                        {hasWaveform && bodyWidth > 0 ? (
                            <WaveformPreview
                                dataPoints={dataPoints}
                                width={bodyWidth}
                                height={waveformHeight}
                                barColor={barColor}
                                silentBarColor={silentBarColor}
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
                                {formatElapsed(elapsedMs)}
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
