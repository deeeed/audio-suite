[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / extractMelSpectrogram

# Function: extractMelSpectrogram()

> **extractMelSpectrogram**(`options`): `Promise`\<[`MelSpectrogram`](../interfaces/MelSpectrogram.md)\>

Defined in: [src/AudioAnalysis/extractMelSpectrogram.ts:33](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/extractMelSpectrogram.ts#L33)

**`Experimental`**

Extracts a mel spectrogram from audio data

 This feature is experimental.
Uses shared C++ implementation on all platforms (native on iOS/Android, WASM on web).

## Parameters

### options

[`ExtractMelSpectrogramOptions`](../interfaces/ExtractMelSpectrogramOptions.md)

## Returns

`Promise`\<[`MelSpectrogram`](../interfaces/MelSpectrogram.md)\>
