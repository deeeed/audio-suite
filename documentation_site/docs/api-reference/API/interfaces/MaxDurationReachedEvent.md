[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / MaxDurationReachedEvent

# Interface: MaxDurationReachedEvent

Defined in: [src/AudioStudio.types.ts:197](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L197)

## Properties

### autoStopped

> **autoStopped**: `boolean`

Defined in: [src/AudioStudio.types.ts:207](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L207)

Whether the recorder was configured to stop automatically after this event

***

### durationMs

> **durationMs**: `number`

Defined in: [src/AudioStudio.types.ts:199](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L199)

Active recording duration that triggered the event, in milliseconds

***

### maxDurationMs

> **maxDurationMs**: `number`

Defined in: [src/AudioStudio.types.ts:201](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L201)

Configured active recording duration limit, in milliseconds

***

### overrunMs

> **overrunMs**: `number`

Defined in: [src/AudioStudio.types.ts:203](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L203)

Amount by which timer delivery exceeded the limit, in milliseconds

***

### streamUuid?

> `optional` **streamUuid?**: `string`

Defined in: [src/AudioStudio.types.ts:205](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L205)

Active stream identifier when available
