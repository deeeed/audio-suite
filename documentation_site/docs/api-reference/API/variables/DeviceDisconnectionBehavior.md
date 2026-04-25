[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / DeviceDisconnectionBehavior

# Variable: DeviceDisconnectionBehavior

> `const` **DeviceDisconnectionBehavior**: `object`

Defined in: [src/AudioStudio.types.ts:333](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L333)

Defines how recording should behave when a device becomes unavailable

## Type declaration

### FALLBACK

> `readonly` **FALLBACK**: `"fallback"` = `'fallback'`

Switch to default device and continue recording

### PAUSE

> `readonly` **PAUSE**: `"pause"` = `'pause'`

Pause recording when device disconnects
