/// <reference types="jest" />

import { __testing } from './index'

describe('audio-studio Expo plugin Android background recording components', () => {
    it('adds fully-qualified foreground service components when background audio is enabled', () => {
        const application: any = {
            receiver: [{ $: { 'android:name': '.RecordingActionReceiver' } }],
            service: [{ $: { 'android:name': '.AudioRecordingService' } }],
        }

        __testing.configureAndroidBackgroundRecordingComponents(
            application,
            true
        )

        expect(application.receiver).toHaveLength(1)
        expect(application.receiver[0].$['android:name']).toBe(
            __testing.RECORDING_ACTION_RECEIVER
        )
        expect(application.receiver[0].$['android:exported']).toBe('false')
        expect(application.receiver[0]['intent-filter'][0].action).toHaveLength(
            3
        )

        expect(application.service).toHaveLength(1)
        expect(application.service[0].$['android:name']).toBe(
            __testing.AUDIO_RECORDING_SERVICE
        )
        expect(application.service[0].$['android:foregroundServiceType']).toBe(
            'microphone'
        )
    })

    it('removes foreground service components when background audio is disabled', () => {
        const application: any = {
            receiver: [
                { $: { 'android:name': '.RecordingActionReceiver' } },
                {
                    $: {
                        'android:name': __testing.RECORDING_ACTION_RECEIVER,
                    },
                },
            ],
            service: [
                { $: { 'android:name': '.AudioRecordingService' } },
                {
                    $: {
                        'android:name': __testing.AUDIO_RECORDING_SERVICE,
                        'android:foregroundServiceType': 'microphone',
                    },
                },
            ],
        }

        __testing.configureAndroidBackgroundRecordingComponents(
            application,
            false
        )

        expect(application.receiver).toEqual([
            {
                $: {
                    'android:name': __testing.RECORDING_ACTION_RECEIVER,
                    'tools:node': 'remove',
                },
            },
        ])
        expect(application.service).toEqual([
            {
                $: {
                    'android:name': __testing.AUDIO_RECORDING_SERVICE,
                    'tools:node': 'remove',
                },
            },
        ])
    })
})
