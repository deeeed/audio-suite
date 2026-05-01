[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / AudioAnalysis

# Interface: AudioAnalysis

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:108](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L108)

Represents the complete data from the audio analysis.

## Properties

### amplitudeRange

> **amplitudeRange**: `object`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:130](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L130)

#### max

> **max**: `number`

#### min

> **min**: `number`

***

### bitDepth

> **bitDepth**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:125](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L125)

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

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:129](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L129)

***

### durationMs

> **durationMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:110](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L110)

***

### extractionTimeMs

> **extractionTimeMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:138](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L138)

***

### numberOfChannels

> **numberOfChannels**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:127](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L127)

***

### rmsRange

> **rmsRange**: `object`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:134](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L134)

#### max

> **max**: `number`

#### min

> **min**: `number`

***

### sampleRate

> **sampleRate**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:128](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L128)

***

### samples

> **samples**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:126](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L126)

***

### segmentDurationMs

> **segmentDurationMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:109](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L109)

***

### speechAnalysis?

> `optional` **speechAnalysis**: `object`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:140](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L140)

#### speakerChanges

> **speakerChanges**: `object`[]
