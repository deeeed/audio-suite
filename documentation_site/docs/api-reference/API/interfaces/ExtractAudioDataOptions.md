[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / ExtractAudioDataOptions

# Interface: ExtractAudioDataOptions

Defined in: [src/AudioStudio.types.ts:645](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L645)

## Properties

### computeChecksum?

> `optional` **computeChecksum?**: `boolean`

Defined in: [src/AudioStudio.types.ts:665](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L665)

Compute the checksum of the PCM data

***

### decodingOptions?

> `optional` **decodingOptions?**: [`DecodingConfig`](DecodingConfig.md)

Defined in: [src/AudioStudio.types.ts:667](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L667)

Target config for the normalized audio (Android and Web)

***

### endTimeMs?

> `optional` **endTimeMs?**: `number`

Defined in: [src/AudioStudio.types.ts:651](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L651)

End time in milliseconds (for time-based range)

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioStudio.types.ts:647](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L647)

URI of the audio file to extract data from

***

### includeBase64Data?

> `optional` **includeBase64Data?**: `boolean`

Defined in: [src/AudioStudio.types.ts:659](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L659)

Include base64 encoded string representation of the audio data

***

### includeNormalizedData?

> `optional` **includeNormalizedData?**: `boolean`

Defined in: [src/AudioStudio.types.ts:657](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L657)

Include normalized audio data in [-1, 1] range

***

### includeWavHeader?

> `optional` **includeWavHeader?**: `boolean`

Defined in: [src/AudioStudio.types.ts:661](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L661)

Include WAV header in the PCM data (makes it a valid WAV file)

***

### length?

> `optional` **length?**: `number`

Defined in: [src/AudioStudio.types.ts:655](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L655)

Length in bytes to extract (for byte-based range)

***

### logger?

> `optional` **logger?**: [`ConsoleLike`](../type-aliases/ConsoleLike.md)

Defined in: [src/AudioStudio.types.ts:663](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L663)

Logger for debugging - can pass console directly.

***

### position?

> `optional` **position?**: `number`

Defined in: [src/AudioStudio.types.ts:653](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L653)

Start position in bytes (for byte-based range)

***

### startTimeMs?

> `optional` **startTimeMs?**: `number`

Defined in: [src/AudioStudio.types.ts:649](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L649)

Start time in milliseconds (for time-based range)
