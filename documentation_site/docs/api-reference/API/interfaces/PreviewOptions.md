[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / PreviewOptions

# Interface: PreviewOptions

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:235](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L235)

Options for specifying a time range within an audio file.

## Extends

- [`AudioRangeOptions`](AudioRangeOptions.md)

## Properties

### decodingOptions?

> `optional` **decodingOptions?**: [`DecodingConfig`](DecodingConfig.md)

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:255](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L255)

Optional configuration for decoding the audio file.
Defaults to:
- targetSampleRate: undefined (keep original)
- targetChannels: undefined (keep original)
- targetBitDepth: 16
- normalizeAudio: false

***

### endTimeMs?

> `optional` **endTimeMs?**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:165](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L165)

End time in milliseconds

#### Inherited from

[`AudioRangeOptions`](AudioRangeOptions.md).[`endTimeMs`](AudioRangeOptions.md#endtimems)

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:237](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L237)

URI of the audio file to analyze

***

### logger?

> `optional` **logger?**: [`ConsoleLike`](../type-aliases/ConsoleLike.md)

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:246](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L246)

Optional logger for debugging.

***

### numberOfPoints?

> `optional` **numberOfPoints?**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:242](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L242)

Total number of points to generate for the preview.

#### Default

```ts
100
```

***

### onPointReady?

> `optional` **onPointReady?**: (`point`, `index`, `total`) => `void`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:262](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L262)

Optional callback fired once per data point as the preview becomes available.
Today the native module returns the full analysis in one shot; the points are then
micro-batched on the JS side so consumers can render bars incrementally.
Native progressive streaming is a future enhancement.

#### Parameters

##### point

[`DataPoint`](DataPoint.md)

##### index

`number`

##### total

`number`

#### Returns

`void`

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:268](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L268)

Optional cancellation signal for JS-side progressive point emission.
Aborting does not cancel native extraction after it has started, but it
stops any queued `onPointReady` callbacks from an older request.

***

### startTimeMs?

> `optional` **startTimeMs?**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:163](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L163)

Start time in milliseconds

#### Inherited from

[`AudioRangeOptions`](AudioRangeOptions.md).[`startTimeMs`](AudioRangeOptions.md#starttimems)
