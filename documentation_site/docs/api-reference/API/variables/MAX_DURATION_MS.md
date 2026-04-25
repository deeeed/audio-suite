[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / MAX\_DURATION\_MS

# Variable: MAX\_DURATION\_MS

> `const` **MAX\_DURATION\_MS**: `30000` = `30_000`

Defined in: [src/AudioAnalysis/extractMelSpectrogram.ts:25](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioAnalysis/extractMelSpectrogram.ts#L25)

Maximum duration in milliseconds that extractMelSpectrogram will process in a single call.
The C++ core requires the entire trimmed range as a contiguous float array in memory,
so this bound prevents OOM on all platforms. Callers needing longer ranges can iterate
in windows of this size using startTimeMs/endTimeMs.
