[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / StartRecordingResult

# Interface: StartRecordingResult

Defined in: [src/AudioStudio.types.ts:172](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L172)

## Properties

### bitDepth?

> `optional` **bitDepth**: [`BitDepth`](../type-aliases/BitDepth.md)

Defined in: [src/AudioStudio.types.ts:180](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L180)

Bit depth of the audio (8, 16, or 32 bits)

***

### channels?

> `optional` **channels**: `number`

Defined in: [src/AudioStudio.types.ts:178](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L178)

Number of audio channels (1 for mono, 2 for stereo)

***

### compression?

> `optional` **compression**: [`CompressionInfo`](CompressionInfo.md) & `object`

Defined in: [src/AudioStudio.types.ts:184](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L184)

Information about compression if enabled, including the URI to the compressed file

#### Type declaration

##### compressedFileUri

> **compressedFileUri**: `string`

URI to the compressed audio file

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioStudio.types.ts:174](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L174)

URI to the file being recorded

***

### mimeType

> **mimeType**: `string`

Defined in: [src/AudioStudio.types.ts:176](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L176)

MIME type of the recording

***

### sampleRate?

> `optional` **sampleRate**: [`SampleRate`](../type-aliases/SampleRate.md)

Defined in: [src/AudioStudio.types.ts:182](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L182)

Sample rate of the audio in Hz
