[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / PreviewBarsOptions

# Interface: PreviewBarsOptions

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:216](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L216)

Options for extracting compact waveform preview bars for UI rendering.

## Extends

- [`AudioRangeOptions`](AudioRangeOptions.md)

## Properties

### decodingOptions?

> `optional` **decodingOptions?**: [`DecodingConfig`](DecodingConfig.md)

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:227](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L227)

Optional configuration for decoding the audio file.

***

### endTimeMs?

> `optional` **endTimeMs?**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:165](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L165)

End time in milliseconds

#### Inherited from

[`AudioRangeOptions`](AudioRangeOptions.md).[`endTimeMs`](AudioRangeOptions.md#endtimems)

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:218](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L218)

URI of the audio file to analyze

***

### logger?

> `optional` **logger?**: [`ConsoleLike`](../type-aliases/ConsoleLike.md)

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:225](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L225)

Optional logger for debugging.

***

### numberOfBars?

> `optional` **numberOfBars?**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:223](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L223)

Total number of bars to generate for the preview.

#### Default

```ts
100
```

***

### onBarReady?

> `optional` **onBarReady?**: (`bar`, `index`, `total`) => `void`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:232](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L232)

Optional callback fired once per compact bar after extraction resolves.
Native progressive streaming is not implied by this callback.

#### Parameters

##### bar

[`PreviewBar`](PreviewBar.md)

##### index

`number`

##### total

`number`

#### Returns

`void`

***

### startTimeMs?

> `optional` **startTimeMs?**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:163](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L163)

Start time in milliseconds

#### Inherited from

[`AudioRangeOptions`](AudioRangeOptions.md).[`startTimeMs`](AudioRangeOptions.md#starttimems)
