[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / useAudioDevices

# Function: useAudioDevices()

> **useAudioDevices**(): `object`

Defined in: [src/hooks/useAudioDevices.ts:9](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/hooks/useAudioDevices.ts#L9)

React hook for managing audio input devices

## Returns

`object`

### currentDevice

> **currentDevice**: `null` \| [`AudioDevice`](../interfaces/AudioDevice.md)

### devices

> **devices**: [`AudioDevice`](../interfaces/AudioDevice.md)[]

### error

> **error**: `null` \| `Error`

### initializeDeviceDetection()

> **initializeDeviceDetection**: () => `void`

#### Returns

`void`

### loading

> **loading**: `boolean`

### refreshDevices()

> **refreshDevices**: () => `Promise`\<[`AudioDevice`](../interfaces/AudioDevice.md)[]\>

#### Returns

`Promise`\<[`AudioDevice`](../interfaces/AudioDevice.md)[]\>

### resetToDefaultDevice()

> **resetToDefaultDevice**: () => `Promise`\<`boolean`\>

#### Returns

`Promise`\<`boolean`\>

### selectDevice()

> **selectDevice**: (`deviceId`) => `Promise`\<`boolean`\>

#### Parameters

##### deviceId

`string`

#### Returns

`Promise`\<`boolean`\>
