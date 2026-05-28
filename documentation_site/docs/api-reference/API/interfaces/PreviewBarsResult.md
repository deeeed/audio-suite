[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / PreviewBarsResult

# Interface: PreviewBarsResult

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:191](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L191)

Compact preview-bars result for UI waveform rendering.
Unlike `AudioAnalysis`, this intentionally omits full `DataPoint` feature data.

## Properties

### amplitudeRange

> **amplitudeRange**: `object`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:202](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L202)

#### max

> **max**: `number`

#### min

> **min**: `number`

***

### barDurationMs

> **barDurationMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:201](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L201)

Approximate duration represented by each bar.

***

### bars

> **bars**: [`PreviewBar`](PreviewBar.md)[]

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:192](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L192)

***

### bitDepth

> **bitDepth**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:196](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L196)

***

### durationMs

> **durationMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:193](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L193)

***

### extractionTimeMs

> **extractionTimeMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:210](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L210)

***

### numberOfChannels

> **numberOfChannels**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:195](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L195)

***

### requestedNumberOfBars

> **requestedNumberOfBars**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:199](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L199)

Requested bar count before native/platform clamping.

***

### rmsRange

> **rmsRange**: `object`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:206](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L206)

#### max

> **max**: `number`

#### min

> **min**: `number`

***

### sampleRate

> **sampleRate**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:194](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L194)

***

### samples

> **samples**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:197](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L197)
