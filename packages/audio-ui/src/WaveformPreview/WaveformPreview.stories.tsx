import type { Meta, StoryObj } from '@storybook/react-webpack5'
import React, { useState } from 'react'
import { View } from 'react-native'

import { WaveformPreview } from './WaveformPreview'
import type { WaveformPoint } from '../types/waveform'

const meta: Meta<typeof WaveformPreview> = {
    title: 'AudioUI/WaveformPreview',
    component: WaveformPreview,
    tags: ['autodocs'],
    decorators: [
        (Story) => (
            <View style={{ padding: 16, backgroundColor: '#f5f5f5' }}>
                <Story />
            </View>
        ),
    ],
    argTypes: {
        amplitudeScale: {
            control: 'select',
            options: ['linear', 'sqrt', 'log'],
            description:
                'Bar-height scaling. `sqrt` (default) is perceptually accurate for speech; `linear` is a peak-meter look; `log` lifts whisper-quiet content.',
        },
        gap: { control: { type: 'range', min: 0, max: 4, step: 1 } },
        showPlayButton: { control: 'boolean' },
        isPlaying: { control: 'boolean' },
    },
}

export default meta

type Story = StoryObj<typeof WaveformPreview>

const POINT_COUNT = 96
const DURATION_MS = 24_000

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

export const Default: Story = {
    args: {
        dataPoints,
        width: 480,
        height: 64,
    },
}

export const WithPlayButton: Story = {
    args: {
        ...Default.args,
        height: 72,
        showPlayButton: true,
        isPlaying: false,
    },
}

export const VoiceMaskColoring: Story = {
    args: {
        ...Default.args,
        voiceMask,
        barColor: '#7C3AED',
        silentBarColor: '#DDD6FE',
    },
    parameters: {
        docs: {
            description: {
                story: 'When `voiceMask` is supplied, bars are colored by voice activity instead of the amplitude-threshold `silent` flag — the right shape for VAD output.',
            },
        },
    },
}

export const LinearScale: Story = {
    args: {
        ...Default.args,
        amplitudeScale: 'linear',
    },
    parameters: {
        docs: {
            description: {
                story: 'Peak-meter look. Silent bars render as ~3px specks because the scale is physics-accurate. Use this when faithfulness to amplitude matters more than perceptual readability.',
            },
        },
    },
}

const InteractiveStory = (args: React.ComponentProps<typeof WaveformPreview>) => {
    const [isPlaying, setIsPlaying] = useState(false)
    return (
        <WaveformPreview
            {...args}
            isPlaying={isPlaying}
            onPlayPress={() => setIsPlaying((value) => !value)}
        />
    )
}

export const Interactive: Story = {
    render: InteractiveStory,
    args: {
        ...WithPlayButton.args,
        showPlayButton: true,
    },
    parameters: {
        docs: {
            description: {
                story: 'Toggle the play button to see the icon swap between play / pause.',
            },
        },
    },
}
