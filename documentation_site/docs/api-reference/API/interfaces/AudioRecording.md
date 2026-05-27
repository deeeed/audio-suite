[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / AudioRecording

# Interface: AudioRecording

Defined in: [src/AudioStudio.types.ts:146](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L146)

## Properties

### analysisData?

> `optional` **analysisData?**: [`AudioAnalysis`](AudioAnalysis.md)

Defined in: [src/AudioStudio.types.ts:171](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L171)

Full analysis data for the recording if processing was enabled and
`keepFullAnalysis` was not set to `false`.

***

### bitDepth

> **bitDepth**: [`BitDepth`](../type-aliases/BitDepth.md)

Defined in: [src/AudioStudio.types.ts:160](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L160)

Bit depth of the audio (8, 16, or 32 bits)

***

### channels

> **channels**: `number`

Defined in: [src/AudioStudio.types.ts:158](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L158)

Number of audio channels (1 for mono, 2 for stereo)

***

### compression?

> `optional` **compression?**: [`CompressionInfo`](CompressionInfo.md) & `object`

Defined in: [src/AudioStudio.types.ts:173](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L173)

Information about compression if enabled, including the URI to the compressed file

#### Type Declaration

##### compressedFileUri

> **compressedFileUri**: `string`

URI to the compressed audio file

***

### createdAt?

> `optional` **createdAt?**: `number`

Defined in: [src/AudioStudio.types.ts:164](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L164)

Timestamp when the recording was created

***

### durationMs

> **durationMs**: `number`

Defined in: [src/AudioStudio.types.ts:152](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L152)

Duration of the recording in milliseconds

***

### filename

> **filename**: `string`

Defined in: [src/AudioStudio.types.ts:150](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L150)

Filename of the recorded audio

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioStudio.types.ts:148](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L148)

URI to the recorded audio file

***

### mimeType

> **mimeType**: `string`

Defined in: [src/AudioStudio.types.ts:156](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L156)

MIME type of the recorded audio

***

### sampleRate

> **sampleRate**: [`SampleRate`](../type-aliases/SampleRate.md)

Defined in: [src/AudioStudio.types.ts:162](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L162)

Sample rate of the audio in Hz

***

### size

> **size**: `number`

Defined in: [src/AudioStudio.types.ts:154](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L154)

Size of the recording in bytes

***

### transcripts?

> `optional` **transcripts?**: [`TranscriberData`](TranscriberData.md)[]

Defined in: [src/AudioStudio.types.ts:166](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L166)

Array of transcription data if available
