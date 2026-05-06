import { MaterialIcons } from '@expo/vector-icons'
import type { Meta, StoryObj } from '@storybook/react-webpack5'
import React, { useEffect, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { ChatRecordWidget } from './ChatRecordWidget'
import type {
    ChatRecordWidgetState,
} from './useChatRecordWidgetState'
import type { WaveformPoint } from '../types/waveform'

const meta: Meta<typeof ChatRecordWidget> = {
    title: 'AudioUI/ChatRecordWidget',
    component: ChatRecordWidget,
    tags: ['autodocs'],
    decorators: [
        (Story) => (
            <View style={{ padding: 16, backgroundColor: '#f5f5f5', gap: 12 }}>
                <Story />
            </View>
        ),
    ],
    argTypes: {
        state: {
            control: 'select',
            options: ['idle', 'recording', 'processing', 'ready', 'error', 'disabled'],
        },
        interaction: {
            control: 'select',
            options: ['tap', 'hold'],
        },
        variant: {
            control: 'select',
            options: ['full', 'button'],
        },
        showWaveform: { control: 'boolean' },
        showElapsed: { control: 'boolean' },
        showPlaceholder: { control: 'boolean' },
        onRecordPress: { action: 'record' },
        onStopPress: { action: 'stop' },
        onRetryPress: { action: 'retry' },
    },
}

export default meta

type Story = StoryObj<typeof ChatRecordWidget>

const POINT_COUNT = 56

function createDemoPoints(): WaveformPoint[] {
    return Array.from({ length: POINT_COUNT }, (_, index) => {
        const progress = index / Math.max(1, POINT_COUNT - 1)
        const envelope = 0.35 + 0.55 * Math.abs(Math.sin(progress * Math.PI * 3))
        const detail = 0.18 * Math.abs(Math.sin(index * 1.7))
        const amplitude = Math.min(1, envelope + detail)
        const silent = index % 12 < 3
        return {
            id: index,
            amplitude: silent ? amplitude * 0.18 : amplitude,
            rms: silent ? 0.006 : amplitude * 0.52,
            dB: silent ? -56 : -8 - amplitude * 12,
            silent,
            samples: 256,
        }
    })
}

const dataPoints = createDemoPoints()

const baseArgs = {
    state: 'idle' as ChatRecordWidgetState,
    width: 480,
    elapsedMs: 0,
    onRecordPress: () => undefined,
    onStopPress: () => undefined,
    onRetryPress: () => undefined,
}

export const Idle: Story = {
    args: { ...baseArgs },
}

export const Recording: Story = {
    args: {
        ...baseArgs,
        state: 'recording',
        dataPoints,
        elapsedMs: 4_200,
    },
}

export const Ready: Story = {
    args: {
        ...baseArgs,
        state: 'ready',
        dataPoints,
        elapsedMs: 12_500,
    },
}

export const Processing: Story = {
    args: {
        ...baseArgs,
        state: 'processing',
        dataPoints,
        elapsedMs: 12_500,
    },
}

export const ErrorState: Story = {
    args: {
        ...baseArgs,
        state: 'error',
        errorMessage: 'Microphone unavailable',
    },
}

export const Disabled: Story = {
    args: {
        ...baseArgs,
        state: 'disabled',
    },
}

export const ButtonOnly: Story = {
    args: {
        ...baseArgs,
        variant: 'button',
    },
    parameters: {
        docs: {
            description: {
                story: 'Bare mic button — use when you want to render the waveform / status text elsewhere in your layout.',
            },
        },
    },
}

export const HoldToRecord: Story = {
    args: {
        ...baseArgs,
        state: 'recording',
        interaction: 'hold',
        dataPoints,
        elapsedMs: 5_400,
        showElapsed: false,
        caption: 'Release to send',
        placeholderText: 'Hold to record',
    },
    parameters: {
        docs: {
            description: {
                story: 'Hold-to-record wires `onRecordPress` to press-in and `onStopPress` to press-out — WhatsApp-style voice-message UX.',
            },
        },
    },
}

export const WithCaption: Story = {
    args: {
        ...baseArgs,
        state: 'recording',
        dataPoints,
        elapsedMs: 4_200,
        caption: 'Live transcription appears here while speaking…',
    },
}

export const WithLeadingSlot: Story = {
    args: {
        ...baseArgs,
        state: 'idle',
        leadingSlot: (
            <View
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: '#7C3AED',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>JD</Text>
            </View>
        ),
    },
    parameters: {
        docs: {
            description: {
                story: '`leadingSlot` lets a caller render an avatar, attach button, or other affordance before the primary mic.',
            },
        },
    },
}

export const PrimaryIconOverrides: Story = {
    args: {
        ...baseArgs,
        state: 'idle',
        primaryIcons: {
            idle: 'graphic-eq',
            recording: 'fiber-manual-record',
            ready: 'send',
        },
    },
    parameters: {
        docs: {
            description: {
                story: 'Override per-state icons via `primaryIcons` while keeping the default button shape.',
            },
        },
    },
}

export const RenderPrimary: Story = {
    args: {
        ...baseArgs,
        showWaveform: false,
        showElapsed: false,
        showPlaceholder: false,
        renderPrimary: (ctx) => (
            <Pressable
                onPress={ctx.onPress}
                onPressIn={ctx.onPressIn}
                onPressOut={ctx.onPressOut}
                disabled={ctx.isDisabled}
                style={{
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderRadius: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    backgroundColor: ctx.isDisabled
                        ? ctx.disabledColor
                        : ctx.accentColor,
                }}
            >
                <MaterialIcons
                    name={ctx.primaryIcon}
                    size={20}
                    color={ctx.iconColor}
                />
                <Text style={{ color: ctx.iconColor, fontWeight: '600' }}>
                    Tap to talk
                </Text>
            </Pressable>
        ),
    },
    parameters: {
        docs: {
            description: {
                story: '`renderPrimary` replaces the entire button — useful for pill-shaped triggers, custom shapes, or label-on-button layouts.',
            },
        },
    },
}

const InteractiveStory = (
    args: React.ComponentProps<typeof ChatRecordWidget>,
) => {
    const [state, setState] = useState<ChatRecordWidgetState>('idle')
    const [elapsedMs, setElapsedMs] = useState(0)
    const [bars, setBars] = useState<WaveformPoint[]>([])
    const startedAtRef = useRef<number | null>(null)

    useEffect(() => {
        if (state !== 'recording') return
        const id = setInterval(() => {
            setElapsedMs((current) => current + 100)
            setBars((prev) => {
                const next = [...prev, dataPoints[prev.length % POINT_COUNT]]
                return next.length > POINT_COUNT
                    ? next.slice(next.length - POINT_COUNT)
                    : next
            })
        }, 100)
        return () => clearInterval(id)
    }, [state])

    return (
        <ChatRecordWidget
            {...args}
            state={state}
            elapsedMs={elapsedMs}
            dataPoints={state === 'idle' ? [] : bars}
            onRecordPress={() => {
                startedAtRef.current = Date.now()
                setBars([])
                setElapsedMs(0)
                setState('recording')
            }}
            onStopPress={() => {
                setState('ready')
            }}
            onRetryPress={() => {
                setState('idle')
            }}
            sendSlot={
                state === 'ready' ? (
                    <Pressable
                        onPress={() => {
                            setState('idle')
                            setBars([])
                            setElapsedMs(0)
                        }}
                        style={{ padding: 6 }}
                    >
                        <Text style={{ color: '#7C3AED', fontWeight: '600' }}>Send</Text>
                    </Pressable>
                ) : undefined
            }
            cancelSlot={
                state !== 'idle' ? (
                    <Pressable
                        onPress={() => {
                            setState('idle')
                            setBars([])
                            setElapsedMs(0)
                        }}
                        style={{ padding: 6 }}
                    >
                        <Text style={{ color: '#DC2626' }}>Cancel</Text>
                    </Pressable>
                ) : undefined
            }
        />
    )
}

export const Interactive: Story = {
    render: InteractiveStory,
    args: {
        ...baseArgs,
        interaction: 'tap',
    },
    parameters: {
        docs: {
            description: {
                story: 'Full record → ready → send/cancel cycle with simulated bars rolling in while recording.',
            },
        },
    },
}
