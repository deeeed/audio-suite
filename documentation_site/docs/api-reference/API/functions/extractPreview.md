[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / extractPreview

# Function: extractPreview()

> **extractPreview**(`options`): `Promise`\<[`AudioAnalysis`](../interfaces/AudioAnalysis.md)\>

Defined in: [src/AudioAnalysis/extractPreview.ts:88](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/extractPreview.ts#L88)

Generates a simplified preview of the audio waveform for quick visualization.
Ideal for UI rendering with a specified number of points.

## Parameters

### options

[`PreviewOptions`](../interfaces/PreviewOptions.md)

The options for the preview, including file URI and time range.

## Returns

`Promise`\<[`AudioAnalysis`](../interfaces/AudioAnalysis.md)\>

A promise that resolves to the audio preview data.

## Throws

when the underlying extraction fails.
