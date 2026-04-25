[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / ExtractAudioDataOptions

# Interface: ExtractAudioDataOptions

Defined in: [src/AudioStudio.types.ts:590](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L590)

## Properties

### computeChecksum?

> `optional` **computeChecksum**: `boolean`

Defined in: [src/AudioStudio.types.ts:610](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L610)

Compute the checksum of the PCM data

***

### decodingOptions?

> `optional` **decodingOptions**: [`DecodingConfig`](DecodingConfig.md)

Defined in: [src/AudioStudio.types.ts:612](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L612)

Target config for the normalized audio (Android and Web)

***

### endTimeMs?

> `optional` **endTimeMs**: `number`

Defined in: [src/AudioStudio.types.ts:596](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L596)

End time in milliseconds (for time-based range)

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioStudio.types.ts:592](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L592)

URI of the audio file to extract data from

***

### includeBase64Data?

> `optional` **includeBase64Data**: `boolean`

Defined in: [src/AudioStudio.types.ts:604](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L604)

Include base64 encoded string representation of the audio data

***

### includeNormalizedData?

> `optional` **includeNormalizedData**: `boolean`

Defined in: [src/AudioStudio.types.ts:602](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L602)

Include normalized audio data in [-1, 1] range

***

### includeWavHeader?

> `optional` **includeWavHeader**: `boolean`

Defined in: [src/AudioStudio.types.ts:606](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L606)

Include WAV header in the PCM data (makes it a valid WAV file)

***

### length?

> `optional` **length**: `number`

Defined in: [src/AudioStudio.types.ts:600](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L600)

Length in bytes to extract (for byte-based range)

***

### logger?

> `optional` **logger**: [`ConsoleLike`](../type-aliases/ConsoleLike.md)

Defined in: [src/AudioStudio.types.ts:608](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L608)

Logger for debugging - can pass console directly.

***

### position?

> `optional` **position**: `number`

Defined in: [src/AudioStudio.types.ts:598](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L598)

Start position in bytes (for byte-based range)

***

### startTimeMs?

> `optional` **startTimeMs**: `number`

Defined in: [src/AudioStudio.types.ts:594](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L594)

Start time in milliseconds (for time-based range)
