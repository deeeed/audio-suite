[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / ExtractedAudioData

# Interface: ExtractedAudioData

Defined in: [src/AudioStudio.types.ts:629](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L629)

## Properties

### base64Data?

> `optional` **base64Data**: `string`

Defined in: [src/AudioStudio.types.ts:635](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L635)

Base64 encoded string representation of the audio data (when includeBase64Data is true)

***

### bitDepth

> **bitDepth**: [`BitDepth`](../type-aliases/BitDepth.md)

Defined in: [src/AudioStudio.types.ts:641](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L641)

Bits per sample (8, 16, or 32)

***

### channels

> **channels**: `number`

Defined in: [src/AudioStudio.types.ts:639](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L639)

Number of audio channels (1 for mono, 2 for stereo)

***

### checksum?

> `optional` **checksum**: `number`

Defined in: [src/AudioStudio.types.ts:651](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L651)

CRC32 Checksum of PCM data

***

### durationMs

> **durationMs**: `number`

Defined in: [src/AudioStudio.types.ts:643](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L643)

Duration of the audio in milliseconds

***

### format

> **format**: `"pcm_32bit"` \| `"pcm_16bit"` \| `"pcm_8bit"`

Defined in: [src/AudioStudio.types.ts:645](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L645)

PCM format identifier (e.g., "pcm_16bit")

***

### hasWavHeader?

> `optional` **hasWavHeader**: `boolean`

Defined in: [src/AudioStudio.types.ts:649](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L649)

Whether the pcmData includes a WAV header

***

### normalizedData?

> `optional` **normalizedData**: `Float32Array`\<`ArrayBufferLike`\>

Defined in: [src/AudioStudio.types.ts:633](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L633)

Normalized audio data in [-1, 1] range (when includeNormalizedData is true)

***

### pcmData

> **pcmData**: `Uint8Array`

Defined in: [src/AudioStudio.types.ts:631](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L631)

Raw PCM audio data

***

### sampleRate

> **sampleRate**: `number`

Defined in: [src/AudioStudio.types.ts:637](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L637)

Sample rate in Hz (e.g., 44100, 48000)

***

### samples

> **samples**: `number`

Defined in: [src/AudioStudio.types.ts:647](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L647)

Total number of audio samples per channel
