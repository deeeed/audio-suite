[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / DeviceDisconnectionBehavior

# Variable: DeviceDisconnectionBehavior

> `const` **DeviceDisconnectionBehavior**: `object`

Defined in: [src/AudioStudio.types.ts:336](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L336)

Defines how recording should behave when a device becomes unavailable

## Type declaration

### FALLBACK

> `readonly` **FALLBACK**: `"fallback"` = `'fallback'`

Switch to default device and continue recording

### PAUSE

> `readonly` **PAUSE**: `"pause"` = `'pause'`

Pause recording when device disconnects
