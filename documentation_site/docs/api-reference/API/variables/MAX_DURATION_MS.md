[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / MAX\_DURATION\_MS

# Variable: MAX\_DURATION\_MS

> `const` **MAX\_DURATION\_MS**: `30000` = `30_000`

Defined in: [src/AudioAnalysis/extractMelSpectrogram.ts:25](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioAnalysis/extractMelSpectrogram.ts#L25)

Maximum duration in milliseconds that extractMelSpectrogram will process in a single call.
The C++ core requires the entire trimmed range as a contiguous float array in memory,
so this bound prevents OOM on all platforms. Callers needing longer ranges can iterate
in windows of this size using startTimeMs/endTimeMs.
