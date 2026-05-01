[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / ExtractAudioDataOptions

# Interface: ExtractAudioDataOptions

Defined in: [src/AudioStudio.types.ts:604](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L604)

## Properties

### computeChecksum?

> `optional` **computeChecksum**: `boolean`

Defined in: [src/AudioStudio.types.ts:624](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L624)

Compute the checksum of the PCM data

***

### decodingOptions?

> `optional` **decodingOptions**: [`DecodingConfig`](DecodingConfig.md)

Defined in: [src/AudioStudio.types.ts:626](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L626)

Target config for the normalized audio (Android and Web)

***

### endTimeMs?

> `optional` **endTimeMs**: `number`

Defined in: [src/AudioStudio.types.ts:610](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L610)

End time in milliseconds (for time-based range)

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioStudio.types.ts:606](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L606)

URI of the audio file to extract data from

***

### includeBase64Data?

> `optional` **includeBase64Data**: `boolean`

Defined in: [src/AudioStudio.types.ts:618](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L618)

Include base64 encoded string representation of the audio data

***

### includeNormalizedData?

> `optional` **includeNormalizedData**: `boolean`

Defined in: [src/AudioStudio.types.ts:616](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L616)

Include normalized audio data in [-1, 1] range

***

### includeWavHeader?

> `optional` **includeWavHeader**: `boolean`

Defined in: [src/AudioStudio.types.ts:620](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L620)

Include WAV header in the PCM data (makes it a valid WAV file)

***

### length?

> `optional` **length**: `number`

Defined in: [src/AudioStudio.types.ts:614](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L614)

Length in bytes to extract (for byte-based range)

***

### logger?

> `optional` **logger**: [`ConsoleLike`](../type-aliases/ConsoleLike.md)

Defined in: [src/AudioStudio.types.ts:622](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L622)

Logger for debugging - can pass console directly.

***

### position?

> `optional` **position**: `number`

Defined in: [src/AudioStudio.types.ts:612](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L612)

Start position in bytes (for byte-based range)

***

### startTimeMs?

> `optional` **startTimeMs**: `number`

Defined in: [src/AudioStudio.types.ts:608](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L608)

Start time in milliseconds (for time-based range)
