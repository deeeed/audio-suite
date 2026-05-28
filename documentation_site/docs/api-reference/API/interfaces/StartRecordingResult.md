[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / StartRecordingResult

# Interface: StartRecordingResult

Defined in: [src/AudioStudio.types.ts:179](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L179)

## Properties

### bitDepth?

> `optional` **bitDepth?**: [`BitDepth`](../type-aliases/BitDepth.md)

Defined in: [src/AudioStudio.types.ts:187](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L187)

Bit depth of the audio (8, 16, or 32 bits)

***

### channels?

> `optional` **channels?**: `number`

Defined in: [src/AudioStudio.types.ts:185](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L185)

Number of audio channels (1 for mono, 2 for stereo)

***

### compression?

> `optional` **compression?**: [`CompressionInfo`](CompressionInfo.md) & `object`

Defined in: [src/AudioStudio.types.ts:191](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L191)

Information about compression if enabled, including the URI to the compressed file

#### Type Declaration

##### compressedFileUri

> **compressedFileUri**: `string`

URI to the compressed audio file

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioStudio.types.ts:181](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L181)

URI to the file being recorded

***

### mimeType

> **mimeType**: `string`

Defined in: [src/AudioStudio.types.ts:183](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L183)

MIME type of the recording

***

### sampleRate?

> `optional` **sampleRate?**: [`SampleRate`](../type-aliases/SampleRate.md)

Defined in: [src/AudioStudio.types.ts:189](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L189)

Sample rate of the audio in Hz
