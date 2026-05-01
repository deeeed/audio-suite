[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / PreviewOptions

# Interface: PreviewOptions

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:166](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L166)

Options for generating a quick preview of audio waveform.
This is optimized for UI rendering with a specified number of points.

## Extends

- [`AudioRangeOptions`](AudioRangeOptions.md)

## Properties

### decodingOptions?

> `optional` **decodingOptions**: [`DecodingConfig`](DecodingConfig.md)

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:186](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L186)

Optional configuration for decoding the audio file.
Defaults to:
- targetSampleRate: undefined (keep original)
- targetChannels: undefined (keep original)
- targetBitDepth: 16
- normalizeAudio: false

***

### endTimeMs?

> `optional` **endTimeMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:159](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L159)

End time in milliseconds

#### Inherited from

[`AudioRangeOptions`](AudioRangeOptions.md).[`endTimeMs`](AudioRangeOptions.md#endtimems)

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:168](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L168)

URI of the audio file to analyze

***

### logger?

> `optional` **logger**: [`ConsoleLike`](../type-aliases/ConsoleLike.md)

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:177](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L177)

Optional logger for debugging.

***

### numberOfPoints?

> `optional` **numberOfPoints**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:173](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L173)

Total number of points to generate for the preview.

#### Default

```ts
100
```

***

### startTimeMs?

> `optional` **startTimeMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:157](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L157)

Start time in milliseconds

#### Inherited from

[`AudioRangeOptions`](AudioRangeOptions.md).[`startTimeMs`](AudioRangeOptions.md#starttimems)
