[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / ExtractMelSpectrogramOptions

# Interface: ExtractMelSpectrogramOptions

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:195](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L195)

**`Experimental`**

Options for mel-spectrogram extraction

 This feature is experimental and currently only available on Android.
The API may change in future versions.

## Properties

### arrayBuffer?

> `optional` **arrayBuffer**: `ArrayBuffer`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:197](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L197)

**`Experimental`**

***

### decodingOptions?

> `optional` **decodingOptions**: [`DecodingConfig`](DecodingConfig.md)

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:206](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L206)

**`Experimental`**

***

### endTimeMs?

> `optional` **endTimeMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:210](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L210)

**`Experimental`**

Optional end time in ms. Clamped so that the range does not exceed MAX_DURATION_MS (30 s).

***

### fileUri?

> `optional` **fileUri**: `string`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:196](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L196)

**`Experimental`**

***

### fMax?

> `optional` **fMax**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:202](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L202)

**`Experimental`**

***

### fMin?

> `optional` **fMin**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:201](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L201)

**`Experimental`**

***

### hopLengthMs

> **hopLengthMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:199](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L199)

**`Experimental`**

***

### logger?

> `optional` **logger**: [`ConsoleLike`](../type-aliases/ConsoleLike.md)

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:211](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L211)

**`Experimental`**

***

### logScale?

> `optional` **logScale**: `boolean`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:205](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L205)

**`Experimental`**

***

### nMels

> **nMels**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:200](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L200)

**`Experimental`**

***

### normalize?

> `optional` **normalize**: `boolean`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:204](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L204)

**`Experimental`**

***

### startTimeMs?

> `optional` **startTimeMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:208](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L208)

**`Experimental`**

Optional start time in ms. If neither startTimeMs nor endTimeMs is set, defaults to 0.

***

### windowSizeMs

> **windowSizeMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:198](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L198)

**`Experimental`**

***

### windowType?

> `optional` **windowType**: `"hann"` \| `"hamming"`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:203](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L203)

**`Experimental`**
