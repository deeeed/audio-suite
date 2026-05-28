[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / ExtractedAudioData

# Interface: ExtractedAudioData

Defined in: [src/AudioStudio.types.ts:686](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L686)

## Properties

### base64Data?

> `optional` **base64Data?**: `string`

Defined in: [src/AudioStudio.types.ts:692](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L692)

Base64 encoded string representation of the audio data (when includeBase64Data is true)

***

### bitDepth

> **bitDepth**: [`BitDepth`](../type-aliases/BitDepth.md)

Defined in: [src/AudioStudio.types.ts:698](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L698)

Bits per sample (8, 16, or 32)

***

### channels

> **channels**: `number`

Defined in: [src/AudioStudio.types.ts:696](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L696)

Number of audio channels (1 for mono, 2 for stereo)

***

### checksum?

> `optional` **checksum?**: `number`

Defined in: [src/AudioStudio.types.ts:708](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L708)

CRC32 Checksum of PCM data

***

### durationMs

> **durationMs**: `number`

Defined in: [src/AudioStudio.types.ts:700](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L700)

Duration of the audio in milliseconds

***

### format

> **format**: `"pcm_32bit"` \| `"pcm_16bit"` \| `"pcm_8bit"`

Defined in: [src/AudioStudio.types.ts:702](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L702)

PCM format identifier (e.g., "pcm_16bit")

***

### hasWavHeader?

> `optional` **hasWavHeader?**: `boolean`

Defined in: [src/AudioStudio.types.ts:706](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L706)

Whether the pcmData includes a WAV header

***

### normalizedData?

> `optional` **normalizedData?**: `Float32Array`\<`ArrayBufferLike`\>

Defined in: [src/AudioStudio.types.ts:690](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L690)

Normalized audio data in [-1, 1] range (when includeNormalizedData is true)

***

### pcmData

> **pcmData**: `Uint8Array`

Defined in: [src/AudioStudio.types.ts:688](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L688)

Raw PCM audio data

***

### sampleRate

> **sampleRate**: `number`

Defined in: [src/AudioStudio.types.ts:694](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L694)

Sample rate in Hz (e.g., 44100, 48000)

***

### samples

> **samples**: `number`

Defined in: [src/AudioStudio.types.ts:704](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L704)

Total number of audio samples per channel
