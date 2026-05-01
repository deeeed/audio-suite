[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / StartRecordingResult

# Interface: StartRecordingResult

Defined in: [src/AudioStudio.types.ts:175](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L175)

## Properties

### bitDepth?

> `optional` **bitDepth**: [`BitDepth`](../type-aliases/BitDepth.md)

Defined in: [src/AudioStudio.types.ts:183](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L183)

Bit depth of the audio (8, 16, or 32 bits)

***

### channels?

> `optional` **channels**: `number`

Defined in: [src/AudioStudio.types.ts:181](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L181)

Number of audio channels (1 for mono, 2 for stereo)

***

### compression?

> `optional` **compression**: [`CompressionInfo`](CompressionInfo.md) & `object`

Defined in: [src/AudioStudio.types.ts:187](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L187)

Information about compression if enabled, including the URI to the compressed file

#### Type declaration

##### compressedFileUri

> **compressedFileUri**: `string`

URI to the compressed audio file

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioStudio.types.ts:177](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L177)

URI to the file being recorded

***

### mimeType

> **mimeType**: `string`

Defined in: [src/AudioStudio.types.ts:179](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L179)

MIME type of the recording

***

### sampleRate?

> `optional` **sampleRate**: [`SampleRate`](../type-aliases/SampleRate.md)

Defined in: [src/AudioStudio.types.ts:185](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L185)

Sample rate of the audio in Hz
