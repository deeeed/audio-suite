[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / extractRawWavAnalysis

# Function: extractRawWavAnalysis()

> **extractRawWavAnalysis**(`props`): `Promise`\<[`AudioAnalysis`](../interfaces/AudioAnalysis.md)\>

Defined in: [src/AudioAnalysis/extractAudioAnalysis.ts:241](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioAnalysis/extractAudioAnalysis.ts#L241)

Analyzes WAV files without decoding, preserving original PCM values.
Use this function when you need to ensure the analysis matches other software by avoiding any transformations.

## Parameters

### props

`ExtractWavAudioAnalysisProps`

The options for WAV analysis, including file URI and range.

## Returns

`Promise`\<[`AudioAnalysis`](../interfaces/AudioAnalysis.md)\>

A promise that resolves to the audio analysis data.
