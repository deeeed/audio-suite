import type { Meta, StoryObj } from '@storybook/react-webpack5'
import React, { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { AudioPlayerWidget } from './AudioPlayerWidget'
import type { WaveformPoint } from '../types/waveform'

const meta: Meta<typeof AudioPlayerWidget> = {
    title: 'AudioUI/AudioPlayerWidget',
    component: AudioPlayerWidget,
    tags: ['autodocs'],
    decorators: [
        (Story) => (
            <View style={{ padding: 16, backgroundColor: '#f5f5f5' }}>
                <Story />
            </View>
        ),
    ],
    argTypes: {
        density: {
            control: 'select',
            options: ['compact', 'comfortable', 'chat'],
        },
        transportPlacement: {
            control: 'select',
            options: ['bottom', 'left', 'right', 'none'],
        },
        amplitudeScale: {
            control: 'select',
            options: ['linear', 'sqrt', 'log'],
        },
        showSilenceTrack: { control: 'boolean' },
        showTimeLabel: { control: 'boolean' },
        loading: { control: 'boolean' },
        disabled: { control: 'boolean' },
        pixelsPerBar: { control: { type: 'range', min: 1, max: 8, step: 1 } },
        onPlayPause: { action: 'play-pause' },
        onSeek: { action: 'seek' },
    },
}

export default meta

type Story = StoryObj<typeof AudioPlayerWidget>

const DURATION_MS = 24_000
const POINT_COUNT = 96

function createDemoPoints(): WaveformPoint[] {
    return Array.from({ length: POINT_COUNT }, (_, index) => {
        const progress = index / Math.max(1, POINT_COUNT - 1)
        const envelope = 0.35 + 0.55 * Math.abs(Math.sin(progress * Math.PI * 3))
        const detail = 0.18 * Math.abs(Math.sin(index * 1.7))
        const amplitude = Math.min(1, envelope + detail)
        const silent = index % 12 < 3 || (index > 54 && index < 64)
        const startTimeMs = Math.round(progress * DURATION_MS)
        const endTimeMs = Math.round(((index + 1) / POINT_COUNT) * DURATION_MS)
        return {
            id: index,
            amplitude: silent ? amplitude * 0.18 : amplitude,
            rms: silent ? 0.006 : amplitude * 0.52,
            dB: silent ? -56 : -8 - amplitude * 12,
            silent,
            startTime: startTimeMs,
            endTime: endTimeMs,
            startTimeMs,
            endTimeMs,
            samples: 512,
            speech: { isActive: !silent, speakerId: index % 2 },
        }
    })
}

const dataPoints = createDemoPoints()
const voiceMask = dataPoints.map((point) => !point.silent)

const baseArgs = {
    dataPoints,
    width: 480,
    currentTimeMs: 7_200,
    durationMs: DURATION_MS,
    isPlaying: false,
    onPlayPause: () => undefined,
    onSeek: () => undefined,
}

export const Comfortable: Story = {
    args: {
        ...baseArgs,
        density: 'comfortable',
    },
}

export const Compact: Story = {
    args: {
        ...baseArgs,
        density: 'compact',
    },
}

export const ChatDensity: Story = {
    args: {
        ...baseArgs,
        density: 'chat',
    },
}

export const SideTransportLeft: Story = {
    args: {
        ...baseArgs,
        transportPlacement: 'left',
        showSilenceTrack: true,
    },
    parameters: {
        docs: {
            description: {
                story: 'Inline transport: play button + time on the left, bars fill the remainder via measured layout.',
            },
        },
    },
}

export const SideTransportRight: Story = {
    args: {
        ...baseArgs,
        transportPlacement: 'right',
    },
}

export const NoTransport: Story = {
    args: {
        ...baseArgs,
        transportPlacement: 'none',
    },
    parameters: {
        docs: {
            description: {
                story: 'Hide the transport entirely and let the bars + playhead stand alone — useful when the host renders its own controls.',
            },
        },
    },
}

export const WithSilenceTrack: Story = {
    args: {
        ...baseArgs,
        showSilenceTrack: true,
        voiceMask,
    },
}

export const Loading: Story = {
    args: {
        ...baseArgs,
        dataPoints: [],
        loading: true,
        currentTimeMs: 0,
        durationMs: 0,
    },
}

export const ErrorState: Story = {
    args: {
        ...baseArgs,
        errorMessage: 'Preview extraction failed',
        currentTimeMs: 0,
    },
}

export const CustomTransport: Story = {
    args: {
        ...baseArgs,
        transportPlacement: 'left',
        renderTransport: (ctx) => (
            <Pressable
                onPress={ctx.onPlayPause}
                disabled={ctx.isDisabled}
                style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: ctx.isDisabled
                        ? ctx.colors.disabledColor
                        : ctx.colors.accentColor,
                }}
            >
                <Text style={{ color: ctx.colors.iconColor, fontWeight: '600' }}>
                    {ctx.isPlaying ? 'Pause' : 'Play'} · {ctx.formatTime(ctx.currentTimeMs)}
                </Text>
            </Pressable>
        ),
    },
    parameters: {
        docs: {
            description: {
                story: '`renderTransport` swaps the default play button + time label for a fully custom node while keeping playback wiring intact.',
            },
        },
    },
}

export const WithSlots: Story = {
    args: {
        ...baseArgs,
        density: 'chat',
        topSlot: (
            <Text style={{ fontSize: 12, color: '#64748B' }}>
                JFK · Inaugural address
            </Text>
        ),
        bottomSlot: (
            <Text style={{ fontSize: 11, color: '#94A3B8' }}>
                Tap the bars to scrub
            </Text>
        ),
    },
}

export const RemainingTimeFormat: Story = {
    args: {
        ...baseArgs,
        density: 'chat',
        formatTime: (ms) => {
            const remaining = Math.max(0, DURATION_MS - ms)
            const totalSec = Math.floor(remaining / 1000)
            const m = Math.floor(totalSec / 60)
            const s = totalSec % 60
            return `-${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        },
    },
    parameters: {
        docs: {
            description: {
                story: 'Override `formatTime` for any time format — here, remaining-time countdown.',
            },
        },
    },
}

const InteractivePlayback = (
    args: React.ComponentProps<typeof AudioPlayerWidget>,
) => {
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTimeMs, setCurrentTimeMs] = useState(0)

    useEffect(() => {
        if (!isPlaying) return
        const id = setInterval(() => {
            setCurrentTimeMs((t) => {
                if (t + 100 >= DURATION_MS) {
                    setIsPlaying(false)
                    return 0
                }
                return t + 100
            })
        }, 100)
        return () => clearInterval(id)
    }, [isPlaying])

    return (
        <AudioPlayerWidget
            {...args}
            currentTimeMs={currentTimeMs}
            isPlaying={isPlaying}
            onPlayPause={() => setIsPlaying((value) => !value)}
            onSeek={(ms) => setCurrentTimeMs(ms)}
        />
    )
}

export const Interactive: Story = {
    render: InteractivePlayback,
    args: {
        ...baseArgs,
        density: 'chat',
        showSilenceTrack: true,
        voiceMask,
    },
    parameters: {
        docs: {
            description: {
                story: 'Toggle play to advance the playhead; tap anywhere on the bars to scrub.',
            },
        },
    },
}
