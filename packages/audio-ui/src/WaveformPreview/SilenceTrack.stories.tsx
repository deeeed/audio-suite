import type { Meta, StoryObj } from '@storybook/react-webpack5'
import React from 'react'
import { View } from 'react-native'

import { SilenceTrack } from './SilenceTrack'
import type { WaveformPoint } from '../types/waveform'

const meta: Meta<typeof SilenceTrack> = {
    title: 'AudioUI/SilenceTrack',
    component: SilenceTrack,
    tags: ['autodocs'],
    decorators: [
        (Story) => (
            <View style={{ padding: 16, backgroundColor: '#f5f5f5', gap: 12 }}>
                <Story />
            </View>
        ),
    ],
    argTypes: {
        mergeContiguous: {
            control: 'boolean',
            description:
                'Merge adjacent silent points into a single band. Off renders one cell per silent point.',
        },
        height: { control: { type: 'range', min: 4, max: 24, step: 1 } },
    },
}

export default meta

type Story = StoryObj<typeof SilenceTrack>

const POINT_COUNT = 96

function createDemoPoints(): WaveformPoint[] {
    return Array.from({ length: POINT_COUNT }, (_, index) => {
        const silent = index % 12 < 3 || (index > 54 && index < 64)
        return {
            id: index,
            amplitude: silent ? 0.05 : 0.7,
            rms: silent ? 0.006 : 0.45,
            dB: silent ? -56 : -10,
            silent,
            samples: 512,
        }
    })
}

const dataPoints = createDemoPoints()

export const MergedBands: Story = {
    args: {
        dataPoints,
        width: 480,
        height: 10,
        color: '#94A3B8',
        mergeContiguous: true,
    },
    parameters: {
        docs: {
            description: {
                story: 'Adjacent silent points collapse into single bands — the right look for an attention-grabbing summary track.',
            },
        },
    },
}

export const UnmergedPerBar: Story = {
    args: {
        ...MergedBands.args,
        mergeContiguous: false,
        color: '#7C3AED',
    },
    parameters: {
        docs: {
            description: {
                story: 'One cell per silent point — useful when the parent waveform also renders one bar per point so the silence cells line up exactly.',
            },
        },
    },
}
