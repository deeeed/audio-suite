[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / DecodingConfig

# Interface: DecodingConfig

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:8](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L8)

Represents the configuration for decoding audio data.

## Properties

### normalizeAudio?

> `optional` **normalizeAudio?**: `boolean`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:16](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L16)

Whether to normalize audio levels (Android and Web)

***

### silenceRmsThreshold?

> `optional` **silenceRmsThreshold?**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:22](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L22)

RMS threshold below which a segment is flagged silent.
Range 0..1. Default 0.01.
Currently applied as a JS post-process so the same behavior holds across iOS/Android/Web.

***

### targetBitDepth?

> `optional` **targetBitDepth?**: [`BitDepth`](../type-aliases/BitDepth.md)

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:14](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L14)

Target bit depth (Android and Web)

***

### targetChannels?

> `optional` **targetChannels?**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:12](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L12)

Target number of channels (Android and Web)

***

### targetSampleRate?

> `optional` **targetSampleRate?**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:10](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L10)

Target sample rate for decoded audio (Android and Web)
