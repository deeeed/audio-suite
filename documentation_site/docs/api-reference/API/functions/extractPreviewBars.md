[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / extractPreviewBars

# Function: extractPreviewBars()

> **extractPreviewBars**(`__namedParameters`): `Promise`\<[`PreviewBarsResult`](../interfaces/PreviewBarsResult.md)\>

Defined in: [src/AudioAnalysis/extractPreviewBars.ts:133](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/extractPreviewBars.ts#L133)

Extracts compact waveform preview bars for UI rendering.

Native platforms may provide a compact `extractPreviewBars` bridge. Until that
bridge is available, this safely falls back to the existing `extractPreview`
compatibility path and adapts `DataPoint` objects into compact bars.

## Parameters

### \_\_namedParameters

[`PreviewBarsOptions`](../interfaces/PreviewBarsOptions.md)

## Returns

`Promise`\<[`PreviewBarsResult`](../interfaces/PreviewBarsResult.md)\>

## Throws

when the underlying extraction fails.
