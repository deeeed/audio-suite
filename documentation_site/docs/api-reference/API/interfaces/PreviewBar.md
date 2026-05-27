[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / PreviewBar

# Interface: PreviewBar

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:172](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L172)

Options for generating a quick preview of audio waveform.
This is optimized for UI rendering with a specified number of points.

## Properties

### amplitude

> **amplitude**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:176](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L176)

Peak amplitude for this bar, normalized to 0..1.

***

### endTimeMs

> **endTimeMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:184](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L184)

Bar end time in milliseconds from the extracted range start.

***

### id

> **id**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:174](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L174)

Stable zero-based bar identifier.

***

### rms

> **rms**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:178](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L178)

Root mean square amplitude for this bar, normalized to 0..1.

***

### silent

> **silent**: `boolean`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:180](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L180)

Whether this bar is below the configured silence RMS threshold.

***

### startTimeMs

> **startTimeMs**: `number`

Defined in: [src/AudioAnalysis/AudioAnalysis.types.ts:182](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioAnalysis/AudioAnalysis.types.ts#L182)

Bar start time in milliseconds from the extracted range start.
