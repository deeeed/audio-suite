[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / DeviceDisconnectionBehavior

# Variable: DeviceDisconnectionBehavior

> `const` **DeviceDisconnectionBehavior**: `object`

Defined in: [src/AudioStudio.types.ts:353](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L353)

Defines how recording should behave when a device becomes unavailable

## Type Declaration

### FALLBACK

> `readonly` **FALLBACK**: `"fallback"` = `'fallback'`

Switch to default device and continue recording

### PAUSE

> `readonly` **PAUSE**: `"pause"` = `'pause'`

Pause recording when device disconnects
