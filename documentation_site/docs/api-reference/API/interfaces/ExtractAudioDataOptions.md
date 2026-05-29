[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / ExtractAudioDataOptions

# Interface: ExtractAudioDataOptions

Defined in: [src/AudioStudio.types.ts:661](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L661)

## Properties

### computeChecksum?

> `optional` **computeChecksum?**: `boolean`

Defined in: [src/AudioStudio.types.ts:681](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L681)

Compute the checksum of the PCM data

***

### decodingOptions?

> `optional` **decodingOptions?**: [`DecodingConfig`](DecodingConfig.md)

Defined in: [src/AudioStudio.types.ts:683](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L683)

Target config for the normalized audio (Android and Web)

***

### endTimeMs?

> `optional` **endTimeMs?**: `number`

Defined in: [src/AudioStudio.types.ts:667](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L667)

End time in milliseconds (for time-based range)

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioStudio.types.ts:663](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L663)

URI of the audio file to extract data from

***

### includeBase64Data?

> `optional` **includeBase64Data?**: `boolean`

Defined in: [src/AudioStudio.types.ts:675](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L675)

Include base64 encoded string representation of the audio data

***

### includeNormalizedData?

> `optional` **includeNormalizedData?**: `boolean`

Defined in: [src/AudioStudio.types.ts:673](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L673)

Include normalized audio data in [-1, 1] range

***

### includeWavHeader?

> `optional` **includeWavHeader?**: `boolean`

Defined in: [src/AudioStudio.types.ts:677](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L677)

Include WAV header in the PCM data (makes it a valid WAV file)

***

### length?

> `optional` **length?**: `number`

Defined in: [src/AudioStudio.types.ts:671](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L671)

Length in bytes to extract (for byte-based range)

***

### logger?

> `optional` **logger?**: [`ConsoleLike`](../type-aliases/ConsoleLike.md)

Defined in: [src/AudioStudio.types.ts:679](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L679)

Logger for debugging - can pass console directly.

***

### position?

> `optional` **position?**: `number`

Defined in: [src/AudioStudio.types.ts:669](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L669)

Start position in bytes (for byte-based range)

***

### startTimeMs?

> `optional` **startTimeMs?**: `number`

Defined in: [src/AudioStudio.types.ts:665](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L665)

Start time in milliseconds (for time-based range)
