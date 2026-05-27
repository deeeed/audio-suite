[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / ExtractMelSpectrogramOptions

# Interface: ExtractMelSpectrogramOptions

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:277](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L277)

**`Experimental`**

Options for mel-spectrogram extraction

 This feature is experimental and currently only available on Android.
The API may change in future versions.

## Properties

### arrayBuffer?

> `optional` **arrayBuffer?**: `ArrayBuffer`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:279](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L279)

**`Experimental`**

***

### decodingOptions?

> `optional` **decodingOptions?**: [`DecodingConfig`](DecodingConfig.md)

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:288](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L288)

**`Experimental`**

***

### endTimeMs?

> `optional` **endTimeMs?**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:292](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L292)

**`Experimental`**

Optional end time in ms. Clamped so that the range does not exceed MAX_DURATION_MS (30 s).

***

### fileUri?

> `optional` **fileUri?**: `string`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:278](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L278)

**`Experimental`**

***

### fMax?

> `optional` **fMax?**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:284](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L284)

**`Experimental`**

***

### fMin?

> `optional` **fMin?**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:283](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L283)

**`Experimental`**

***

### hopLengthMs

> **hopLengthMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:281](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L281)

**`Experimental`**

***

### logger?

> `optional` **logger?**: [`ConsoleLike`](../type-aliases/ConsoleLike.md)

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:293](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L293)

**`Experimental`**

***

### logScale?

> `optional` **logScale?**: `boolean`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:287](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L287)

**`Experimental`**

***

### nMels

> **nMels**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:282](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L282)

**`Experimental`**

***

### normalize?

> `optional` **normalize?**: `boolean`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:286](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L286)

**`Experimental`**

***

### startTimeMs?

> `optional` **startTimeMs?**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:290](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L290)

**`Experimental`**

Optional start time in ms. If neither startTimeMs nor endTimeMs is set, defaults to 0.

***

### windowSizeMs

> **windowSizeMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:280](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L280)

**`Experimental`**

***

### windowType?

> `optional` **windowType?**: `"hann"` \| `"hamming"`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:285](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L285)

**`Experimental`**
