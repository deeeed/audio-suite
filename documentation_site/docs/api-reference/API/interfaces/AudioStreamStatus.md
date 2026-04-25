[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / AudioStreamStatus

# Interface: AudioStreamStatus

Defined in: [src/AudioStudio.types.ts:22](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L22)

## Properties

### compression?

> `optional` **compression**: [`CompressionInfo`](CompressionInfo.md)

Defined in: [src/AudioStudio.types.ts:38](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L38)

Information about audio compression if enabled

***

### durationMs

> **durationMs**: `number`

Defined in: [src/AudioStudio.types.ts:28](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L28)

Duration of the current recording in milliseconds

***

### interval

> **interval**: `number`

Defined in: [src/AudioStudio.types.ts:32](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L32)

Interval in milliseconds at which recording data is emitted

***

### intervalAnalysis

> **intervalAnalysis**: `number`

Defined in: [src/AudioStudio.types.ts:34](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L34)

Interval in milliseconds at which analysis data is emitted

***

### isPaused

> **isPaused**: `boolean`

Defined in: [src/AudioStudio.types.ts:26](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L26)

Indicates whether recording is in a paused state

***

### isRecording

> **isRecording**: `boolean`

Defined in: [src/AudioStudio.types.ts:24](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L24)

Indicates whether audio recording is currently active

***

### mimeType

> **mimeType**: `string`

Defined in: [src/AudioStudio.types.ts:36](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L36)

MIME type of the recorded audio (e.g., 'audio/wav')

***

### size

> **size**: `number`

Defined in: [src/AudioStudio.types.ts:30](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L30)

Size of the recorded audio data in bytes
