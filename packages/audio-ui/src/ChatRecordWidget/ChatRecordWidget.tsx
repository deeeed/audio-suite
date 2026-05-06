import React from 'react'

import { MaterialIcons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { WaveformPoint } from '../types/waveform'
import { WaveformPreview } from '../WaveformPreview/WaveformPreview'

export type ChatRecordWidgetState =
    | 'idle'
    | 'recording'
    | 'paused'
    | 'processing'
    | 'ready'
    | 'error'
    | 'disabled'

export interface ChatRecordWidgetProps {
    state: ChatRecordWidgetState
    dataPoints?: WaveformPoint[]
    width: number
    waveformHeight?: number
    elapsedMs?: number
    onRecordPress?: () => void
    onStopPress?: () => void
    onPausePress?: () => void
    onResumePress?: () => void
    onRetryPress?: () => void
    sendSlot?: React.ReactNode
    cancelSlot?: React.ReactNode
    errorMessage?: string
    placeholderText?: string
    barColor?: string
    silentBarColor?: string
    backgroundColor?: string
    accentColor?: string
    disabled?: boolean
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
        case 'paused':
            return 'play-arrow'
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
    onRecordPress,
    onStopPress,
    onPausePress,
    onResumePress,
    onRetryPress,
    sendSlot,
    cancelSlot,
    errorMessage,
    placeholderText = 'Hold or tap to record',
    barColor = '#7C3AED',
    silentBarColor = '#DDD6FE',
    backgroundColor = '#F8FAFC',
    accentColor = '#7C3AED',
    disabled = false,
    testID = 'chat-record-widget',
}: ChatRecordWidgetProps) {
    const isDisabled =
        disabled || state === 'disabled' || state === 'processing'
    const hasWaveform = dataPoints.length > 0
    const primaryAction =
        state === 'recording'
            ? onStopPress
            : state === 'paused'
              ? onResumePress
              : state === 'error'
                ? onRetryPress
                : onRecordPress

    return (
        <View
            testID={testID}
            style={[styles.container, { width, backgroundColor }]}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                    state === 'recording' ? 'Stop recording' : 'Record'
                }
                disabled={isDisabled || !primaryAction}
                onPress={primaryAction}
                testID={`${testID}-primary`}
                style={[
                    styles.primaryButton,
                    { backgroundColor: isDisabled ? '#CBD5E1' : accentColor },
                ]}
            >
                <MaterialIcons
                    name={getPrimaryIcon(state)}
                    size={22}
                    color="#FFFFFF"
                />
            </Pressable>

            <View style={styles.body}>
                {hasWaveform ? (
                    <WaveformPreview
                        dataPoints={dataPoints}
                        width={Math.max(1, width - 128)}
                        height={waveformHeight}
                        barColor={barColor}
                        silentBarColor={silentBarColor}
                        testID={`${testID}-waveform`}
                    />
                ) : (
                    <Text
                        numberOfLines={1}
                        style={[
                            styles.placeholder,
                            state === 'error' && styles.errorText,
                        ]}
                        testID={`${testID}-placeholder`}
                    >
                        {state === 'error'
                            ? errorMessage || 'Recording failed'
                            : placeholderText}
                    </Text>
                )}
                <Text style={styles.elapsed} testID={`${testID}-elapsed`}>
                    {formatElapsed(elapsedMs)}
                </Text>
            </View>

            {state === 'recording' && onPausePress ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Pause recording"
                    onPress={onPausePress}
                    testID={`${testID}-pause`}
                    style={styles.secondaryButton}
                >
                    <MaterialIcons name="pause" size={20} color={accentColor} />
                </Pressable>
            ) : null}

            <View style={styles.slots}>
                {cancelSlot}
                {sendSlot}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        minHeight: 56,
        borderRadius: 18,
        padding: 8,
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
    secondaryButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFFFFF',
    },
    body: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    placeholder: {
        color: '#64748B',
        fontSize: 14,
    },
    errorText: {
        color: '#DC2626',
    },
    elapsed: {
        color: '#334155',
        fontSize: 12,
        fontVariant: ['tabular-nums'],
    },
    slots: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
})
