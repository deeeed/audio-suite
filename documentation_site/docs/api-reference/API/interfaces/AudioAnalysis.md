[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / AudioAnalysis

# Interface: AudioAnalysis

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:114](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L114)

Represents the complete data from the audio analysis.

## Properties

### amplitudeRange

> **amplitudeRange**: `object`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:136](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L136)

#### max

> **max**: `number`

#### min

> **min**: `number`

***

### bitDepth

> **bitDepth**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:131](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L131)

Bit depth used for audio analysis processing.

**Important**: This represents the internal processing bit depth, which may differ
from the recording bit depth. Audio is typically converted to 32-bit float for
analysis to ensure precision in calculations, regardless of the original recording format.

Platform behavior:
- iOS: Always 32 (float processing)
- Android: Always 32 (float processing)
- Web: Always 32 (Web Audio API standard)

The actual recorded file will maintain the requested bit depth (8, 16, or 32).

***

### dataPoints

> **dataPoints**: [`DataPoint`](DataPoint.md)[]

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:135](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L135)

***

### durationMs

> **durationMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:116](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L116)

***

### extractionTimeMs

> **extractionTimeMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:144](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L144)

***

### numberOfChannels

> **numberOfChannels**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:133](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L133)

***

### rmsRange

> **rmsRange**: `object`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:140](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L140)

#### max

> **max**: `number`

#### min

> **min**: `number`

***

### sampleRate

> **sampleRate**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:134](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L134)

***

### samples

> **samples**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:132](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L132)

***

### segmentDurationMs

> **segmentDurationMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:115](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L115)

***

### speechAnalysis?

> `optional` **speechAnalysis?**: `object`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:146](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L146)

#### speakerChanges

> **speakerChanges**: `object`[]
