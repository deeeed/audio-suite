import { createNativeRecordingOptions } from './nativeRecordingOptions'

describe('createNativeRecordingOptions', () => {
    it('keeps maxDurationMs native but leaves auto-stop finalization hook-owned', () => {
        const nativeOptions = createNativeRecordingOptions({
            maxDurationMs: 1500,
            autoStopOnMaxDuration: true,
            onMaxDurationReached: jest.fn(),
            onRecordingStopped: jest.fn(),
            onRecordingInterrupted: jest.fn(),
            onAudioAnalysis: jest.fn(),
            onAudioStream: jest.fn(),
            keepFullAnalysis: true,
            sampleRate: 16000,
        })

        expect(nativeOptions).toMatchObject({
            maxDurationMs: 1500,
            sampleRate: 16000,
        })
        expect(nativeOptions).not.toHaveProperty('autoStopOnMaxDuration')
        expect(nativeOptions).not.toHaveProperty('onMaxDurationReached')
        expect(nativeOptions).not.toHaveProperty('onRecordingStopped')
        expect(nativeOptions).not.toHaveProperty('onRecordingInterrupted')
        expect(nativeOptions).not.toHaveProperty('onAudioAnalysis')
        expect(nativeOptions).not.toHaveProperty('onAudioStream')
        expect(nativeOptions).not.toHaveProperty('keepFullAnalysis')
    })
})
