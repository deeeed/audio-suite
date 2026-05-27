import { requireNativeModule } from 'expo-modules-core'
import { Platform } from 'react-native'

import { AudioStudioWeb, AudioStudioWebProps } from './AudioStudio.web'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AudioStudioModule: any

if (Platform.OS === 'web') {
    let instance: AudioStudioWeb | null = null

    AudioStudioModule = (webProps: AudioStudioWebProps) => {
        instance ??= new AudioStudioWeb({
            ...webProps,
            emitEvent: (eventName, params) => {
                AudioStudioModule.sendEvent(eventName, params)
            },
        })
        return instance
    }
    AudioStudioModule.requestPermissionsAsync = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
            })
            stream.getTracks().forEach((track) => track.stop())
            return {
                status: 'granted',
                expires: 'never',
                canAskAgain: true,
                granted: true,
            }
        } catch {
            return {
                status: 'denied',
                expires: 'never',
                canAskAgain: true,
                granted: false,
            }
        }
    }
    AudioStudioModule.getPermissionsAsync = async () => {
        let maybeStatus: string | null = null

        if (navigator?.permissions?.query) {
            try {
                const { state } = await navigator.permissions.query({
                    name: 'microphone' as PermissionName,
                })
                maybeStatus = state
            } catch {
                maybeStatus = null
            }
        }

        switch (maybeStatus) {
            case 'granted':
                return {
                    status: 'granted',
                    expires: 'never',
                    canAskAgain: true,
                    granted: true,
                }
            case 'denied':
                return {
                    status: 'denied',
                    expires: 'never',
                    canAskAgain: true,
                    granted: false,
                }
            default:
                return await AudioStudioModule.requestPermissionsAsync()
        }
    }
    // Add a sendEvent method for web
    AudioStudioModule.sendEvent = (eventName: string, params: any) => {
        // This will be picked up by the LegacyEventEmitter in trimAudio.ts
        AudioStudioModule.listeners?.[eventName]?.forEach(
            (listener: Function) => {
                listener(params)
            }
        )
    }

    // Initialize listeners object
    AudioStudioModule.listeners = {}

    // Add methods for event listeners that LegacyEventEmitter will use
    AudioStudioModule.addListener = (eventName: string, listener: Function) => {
        if (!AudioStudioModule.listeners[eventName]) {
            AudioStudioModule.listeners[eventName] = []
        }
        AudioStudioModule.listeners[eventName].push(listener)

        // Return an object with a remove method
        return {
            remove: () => {
                const index =
                    AudioStudioModule.listeners[eventName].indexOf(listener)
                if (index !== -1) {
                    AudioStudioModule.listeners[eventName].splice(index, 1)
                }
            },
        }
    }

    AudioStudioModule.removeAllListeners = (eventName: string) => {
        if (AudioStudioModule.listeners[eventName]) {
            delete AudioStudioModule.listeners[eventName]
        }
    }

    AudioStudioModule.prepareRecording = async (options: any) => {
        // For web platform, we'll implement a simplified version that just checks permissions
        // and does minimal setup. The actual recording setup will still happen in startRecording.
        try {
            // Check for microphone permissions
            const permissionsResult =
                await AudioStudioModule.getPermissionsAsync()
            if (!permissionsResult.granted) {
                throw new Error('Microphone permission not granted')
            }

            // If using a web instance, call its prepareRecording method
            if (instance) {
                return await instance.prepareRecording(options)
            }

            return true
        } catch (error) {
            console.error('Error preparing recording:', error)
            throw error
        }
    }
}

if (Platform.OS !== 'web') {
    AudioStudioModule = requireNativeModule('AudioStudio')
}

export default AudioStudioModule
