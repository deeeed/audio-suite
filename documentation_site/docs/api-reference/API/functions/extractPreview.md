[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / extractPreview

# Function: extractPreview()

> **extractPreview**(`options`): `Promise`\<[`AudioAnalysis`](../interfaces/AudioAnalysis.md)\>

Defined in: [src/AudioAnalysis/extractPreview.ts:11](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/extractPreview.ts#L11)

Generates a simplified preview of the audio waveform for quick visualization.
Ideal for UI rendering with a specified number of points.

## Parameters

### options

[`PreviewOptions`](../interfaces/PreviewOptions.md)

The options for the preview, including file URI and time range.

## Returns

`Promise`\<[`AudioAnalysis`](../interfaces/AudioAnalysis.md)\>

A promise that resolves to the audio preview data.
