[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / WavHeaderOptions

# Interface: WavHeaderOptions

Defined in: [src/utils/writeWavHeader.ts:6](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/utils/writeWavHeader.ts#L6)

Options for creating a WAV header.

## Properties

### bitDepth

> **bitDepth**: `number`

Defined in: [src/utils/writeWavHeader.ts:14](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/utils/writeWavHeader.ts#L14)

The bit depth of the audio (e.g., 16, 24, or 32).

***

### buffer?

> `optional` **buffer**: `ArrayBuffer`

Defined in: [src/utils/writeWavHeader.ts:8](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/utils/writeWavHeader.ts#L8)

Optional buffer containing audio data. If provided, it will be combined with the header.

***

### isFloat?

> `optional` **isFloat**: `boolean`

Defined in: [src/utils/writeWavHeader.ts:16](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/utils/writeWavHeader.ts#L16)

Whether the audio data is in float format (only applies to 32-bit)

***

### numChannels

> **numChannels**: `number`

Defined in: [src/utils/writeWavHeader.ts:12](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/utils/writeWavHeader.ts#L12)

The number of audio channels (e.g., 1 for mono, 2 for stereo).

***

### sampleRate

> **sampleRate**: `number`

Defined in: [src/utils/writeWavHeader.ts:10](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/utils/writeWavHeader.ts#L10)

The sample rate of the audio in Hz (e.g., 44100).
