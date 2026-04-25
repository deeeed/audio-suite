[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / extractMelSpectrogram

# Function: extractMelSpectrogram()

> **extractMelSpectrogram**(`options`): `Promise`\<[`MelSpectrogram`](../interfaces/MelSpectrogram.md)\>

Defined in: [src/AudioAnalysis/extractMelSpectrogram.ts:33](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioAnalysis/extractMelSpectrogram.ts#L33)

**`Experimental`**

Extracts a mel spectrogram from audio data

 This feature is experimental.
Uses shared C++ implementation on all platforms (native on iOS/Android, WASM on web).

## Parameters

### options

[`ExtractMelSpectrogramOptions`](../interfaces/ExtractMelSpectrogramOptions.md)

## Returns

`Promise`\<[`MelSpectrogram`](../interfaces/MelSpectrogram.md)\>
