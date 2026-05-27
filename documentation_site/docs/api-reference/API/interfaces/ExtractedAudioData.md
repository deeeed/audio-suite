[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / ExtractedAudioData

# Interface: ExtractedAudioData

Defined in: [src/AudioStudio.types.ts:670](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L670)

## Properties

### base64Data?

> `optional` **base64Data?**: `string`

Defined in: [src/AudioStudio.types.ts:676](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L676)

Base64 encoded string representation of the audio data (when includeBase64Data is true)

***

### bitDepth

> **bitDepth**: [`BitDepth`](../type-aliases/BitDepth.md)

Defined in: [src/AudioStudio.types.ts:682](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L682)

Bits per sample (8, 16, or 32)

***

### channels

> **channels**: `number`

Defined in: [src/AudioStudio.types.ts:680](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L680)

Number of audio channels (1 for mono, 2 for stereo)

***

### checksum?

> `optional` **checksum?**: `number`

Defined in: [src/AudioStudio.types.ts:692](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L692)

CRC32 Checksum of PCM data

***

### durationMs

> **durationMs**: `number`

Defined in: [src/AudioStudio.types.ts:684](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L684)

Duration of the audio in milliseconds

***

### format

> **format**: `"pcm_32bit"` \| `"pcm_16bit"` \| `"pcm_8bit"`

Defined in: [src/AudioStudio.types.ts:686](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L686)

PCM format identifier (e.g., "pcm_16bit")

***

### hasWavHeader?

> `optional` **hasWavHeader?**: `boolean`

Defined in: [src/AudioStudio.types.ts:690](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L690)

Whether the pcmData includes a WAV header

***

### normalizedData?

> `optional` **normalizedData?**: `Float32Array`\<`ArrayBufferLike`\>

Defined in: [src/AudioStudio.types.ts:674](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L674)

Normalized audio data in [-1, 1] range (when includeNormalizedData is true)

***

### pcmData

> **pcmData**: `Uint8Array`

Defined in: [src/AudioStudio.types.ts:672](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L672)

Raw PCM audio data

***

### sampleRate

> **sampleRate**: `number`

Defined in: [src/AudioStudio.types.ts:678](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L678)

Sample rate in Hz (e.g., 44100, 48000)

***

### samples

> **samples**: `number`

Defined in: [src/AudioStudio.types.ts:688](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L688)

Total number of audio samples per channel
