import type { Meta, StoryObj } from '@storybook/react-webpack5'
import React, { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'

import { AudioFilePlayerWidget } from './AudioFilePlayerWidget'
import type {
    AudioFilePlayerExtractInput,
    AudioFilePlayerExtractResult,
} from './AudioFilePlayerWidget'
import type { WaveformPoint } from '../types/waveform'

const meta: Meta<typeof AudioFilePlayerWidget> = {
    title: 'AudioUI/AudioFilePlayerWidget',
    component: AudioFilePlayerWidget,
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
        showPlayhead: { control: 'boolean' },
        showSilenceTrack: { control: 'boolean' },
        numberOfBars: {
            control: { type: 'range', min: 60, max: 480, step: 20 },
        },
        onPlayPause: { action: 'play-pause' },
        onSeek: { action: 'seek' },
    },
}

export default meta

type Story = StoryObj<typeof AudioFilePlayerWidget>

const SYNTHETIC_DURATION_MS = 24_000

function buildSyntheticBars(count: number): WaveformPoint[] {
    return Array.from({ length: count }, (_, index) => {
        const progress = index / Math.max(1, count - 1)
        const envelope = 0.3 + 0.55 * Math.abs(Math.sin(progress * Math.PI * 3))
        const detail = 0.15 * Math.abs(Math.sin(index * 1.7))
        const amplitude = Math.min(1, envelope + detail)
        const silent = index % 12 < 3 || (index > Math.floor(count * 0.6) && index < Math.floor(count * 0.7))
        const startTimeMs = Math.round(progress * SYNTHETIC_DURATION_MS)
        const endTimeMs = Math.round(((index + 1) / count) * SYNTHETIC_DURATION_MS)
        return {
            id: index,
            amplitude: silent ? amplitude * 0.18 : amplitude,
            rms: silent ? 0.006 : amplitude * 0.52,
            dB: silent ? -56 : -8 - amplitude * 12,
            silent,
            startTimeMs,
            endTimeMs,
            samples: 512,
        }
    })
}

/**
 * Mock extractor that pretends to do native PCM decode then returns
 * synthetic bars. The artificial 250ms delay surfaces the widget's
 * `loading` state in the story so reviewers can see the spinner /
 * status-message branch.
 */
function mockExtract({
    numberOfBars,
    signal,
}: AudioFilePlayerExtractInput): Promise<AudioFilePlayerExtractResult> {
    return new Promise((resolve, reject) => {
        const id = setTimeout(() => {
            resolve({
                bars: buildSyntheticBars(numberOfBars),
                durationMs: SYNTHETIC_DURATION_MS,
            })
        }, 250)
        signal?.addEventListener('abort', () => {
            clearTimeout(id)
            reject(new Error('aborted'))
        })
    })
}

const InteractiveTemplate = (
    args: React.ComponentProps<typeof AudioFilePlayerWidget>,
) => {
    const [currentTimeMs, setCurrentTimeMs] = useState(0)
    const [isPlaying, setIsPlaying] = useState(false)

    useEffect(() => {
        if (!isPlaying) return
        const id = setInterval(() => {
            setCurrentTimeMs((t) => {
                if (t + 100 >= SYNTHETIC_DURATION_MS) {
                    setIsPlaying(false)
                    return 0
                }
                return t + 100
            })
        }, 100)
        return () => clearInterval(id)
    }, [isPlaying])

    // useCallback is mandatory — extractor identity is in the effect deps.
    // Re-creating it every render would bypass the cache.
    const extract = useCallback(mockExtract, [])

    return (
        <AudioFilePlayerWidget
            {...args}
            extract={extract}
            currentTimeMs={currentTimeMs}
            isPlaying={isPlaying}
            onPlayPause={() => setIsPlaying((value) => !value)}
            onSeek={(ms) => setCurrentTimeMs(ms)}
        />
    )
}

export const Default: Story = {
    render: InteractiveTemplate,
    args: {
        fileUri: 'demo://synthetic-jfk',
        numberOfBars: 240,
        width: 480,
        density: 'comfortable',
    },
}

export const RemainingTimeFormat: Story = {
    render: InteractiveTemplate,
    args: {
        ...Default.args,
        density: 'chat',
        formatTime: (ms) => {
            const remaining = Math.max(0, SYNTHETIC_DURATION_MS - ms)
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

export const PlayedFillNoPlayhead: Story = {
    render: InteractiveTemplate,
    args: {
        ...Default.args,
        showPlayhead: false,
        barColor: '#CBD5E1',
        silentBarColor: '#CBD5E1',
        playedBarColor: '#7C3AED',
        playedSilentBarColor: '#7C3AED',
    },
    parameters: {
        docs: {
            description: {
                story: 'Drop the moving playhead and color bars-behind-the-cursor with `playedBarColor` for a Spotify-style progress fill.',
            },
        },
    },
}

export const BarDurationMs: Story = {
    render: InteractiveTemplate,
    args: {
        ...Default.args,
        durationMs: SYNTHETIC_DURATION_MS,
        barDurationMs: 100,
    },
    parameters: {
        docs: {
            description: {
                story: '`barDurationMs={100}` + a known `durationMs` derives `numberOfBars = floor(durationMs / 100) = 240` automatically.',
            },
        },
    },
}
