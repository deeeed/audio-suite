[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / DeviceDisconnectionBehavior

# Variable: DeviceDisconnectionBehavior

> `const` **DeviceDisconnectionBehavior**: `object`

Defined in: [src/AudioStudio.types.ts:355](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L355)

Defines how recording should behave when a device becomes unavailable

## Type Declaration

### FALLBACK

> `readonly` **FALLBACK**: `"fallback"` = `'fallback'`

Switch to default device and continue recording

### PAUSE

> `readonly` **PAUSE**: `"pause"` = `'pause'`

Pause recording when device disconnects
