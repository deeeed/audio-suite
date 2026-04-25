[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / DecodingConfig

# Interface: DecodingConfig

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:8](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L8)

Represents the configuration for decoding audio data.

## Properties

### normalizeAudio?

> `optional` **normalizeAudio**: `boolean`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:16](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L16)

Whether to normalize audio levels (Android and Web)

***

### targetBitDepth?

> `optional` **targetBitDepth**: [`BitDepth`](../type-aliases/BitDepth.md)

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:14](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L14)

Target bit depth (Android and Web)

***

### targetChannels?

> `optional` **targetChannels**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:12](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L12)

Target number of channels (Android and Web)

***

### targetSampleRate?

> `optional` **targetSampleRate**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:10](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L10)

Target sample rate for decoded audio (Android and Web)
