[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / useAudioDevices

# Function: useAudioDevices()

> **useAudioDevices**(): `object`

Defined in: [src/hooks/useAudioDevices.ts:9](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/hooks/useAudioDevices.ts#L9)

React hook for managing audio input devices

## Returns

### currentDevice

> **currentDevice**: [`AudioDevice`](../interfaces/AudioDevice.md) \| `null`

### devices

> **devices**: [`AudioDevice`](../interfaces/AudioDevice.md)[]

### error

> **error**: `Error` \| `null`

### initializeDeviceDetection

> **initializeDeviceDetection**: () => `void`

Initialize device detection
Useful for restarting device detection if it failed initially

#### Returns

`void`

### loading

> **loading**: `boolean`

### refreshDevices

> **refreshDevices**: () => `Promise`\<[`AudioDevice`](../interfaces/AudioDevice.md)[]\>

Refresh the list of available devices

#### Returns

`Promise`\<[`AudioDevice`](../interfaces/AudioDevice.md)[]\>

### resetToDefaultDevice

> **resetToDefaultDevice**: () => `Promise`\<`boolean`\>

Reset to the default audio input device

#### Returns

`Promise`\<`boolean`\>

Promise resolving to a boolean indicating success

### selectDevice

> **selectDevice**: (`deviceId`) => `Promise`\<`boolean`\>

Select a specific audio input device

#### Parameters

##### deviceId

`string`

The ID of the device to select

#### Returns

`Promise`\<`boolean`\>

Promise resolving to a boolean indicating success
