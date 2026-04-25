[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / TrimAudioOptions

# Interface: TrimAudioOptions

Defined in: [src/AudioStudio.types.ts:743](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L743)

Options for configuring the audio trimming operation.

## Properties

### decodingOptions?

> `optional` **decodingOptions**: [`DecodingConfig`](DecodingConfig.md)

Defined in: [src/AudioStudio.types.ts:823](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L823)

Options for decoding the input audio file.
- See `DecodingConfig` for details.

***

### endTimeMs?

> `optional` **endTimeMs**: `number`

Defined in: [src/AudioStudio.types.ts:775](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L775)

The end time in milliseconds for the `'single'` mode.
- If not provided, trimming extends to the end of the audio.

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioStudio.types.ts:747](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L747)

The URI of the audio file to trim.

***

### mode?

> `optional` **mode**: `"single"` \| `"keep"` \| `"remove"`

Defined in: [src/AudioStudio.types.ts:756](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L756)

The mode of trimming to apply.
- `'single'`: Trims the audio to a single range defined by `startTimeMs` and `endTimeMs`.
- `'keep'`: Keeps the specified `ranges` and removes all other portions of the audio.
- `'remove'`: Removes the specified `ranges` and keeps the remaining portions of the audio.

#### Default

```ts
'single'
```

***

### outputFileName?

> `optional` **outputFileName**: `string`

Defined in: [src/AudioStudio.types.ts:780](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L780)

The name of the output file. If not provided, a default name will be generated.

***

### outputFormat?

> `optional` **outputFormat**: `object`

Defined in: [src/AudioStudio.types.ts:785](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L785)

Configuration for the output audio format.

#### bitDepth?

> `optional` **bitDepth**: `number`

The bit depth of the output audio, applicable to PCM formats like `'wav'`.
- If not provided, the input audio's bit depth is used.

#### bitrate?

> `optional` **bitrate**: `number`

The bitrate of the output audio in bits per second, applicable to compressed formats like `'aac'`.
- If not provided, a default bitrate is used based on the format.

#### channels?

> `optional` **channels**: `number`

The number of channels in the output audio (e.g., 1 for mono, 2 for stereo).
- If not provided, the input audio's channel count is used.

#### format

> **format**: `"aac"` \| `"opus"` \| `"wav"`

The format of the output audio file.
- `'wav'`: Waveform Audio File Format (uncompressed).
- `'aac'`: Advanced Audio Coding (compressed). Not supported on web platforms.
- `'opus'`: Opus Interactive Audio Codec (compressed).

#### sampleRate?

> `optional` **sampleRate**: `number`

The sample rate of the output audio in Hertz (Hz).
- If not provided, the input audio's sample rate is used.

***

### ranges?

> `optional` **ranges**: [`TimeRange`](TimeRange.md)[]

Defined in: [src/AudioStudio.types.ts:763](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L763)

An array of time ranges to keep or remove, depending on the `mode`.
- Required for `'keep'` and `'remove'` modes.
- Ignored when `mode` is `'single'`.

***

### startTimeMs?

> `optional` **startTimeMs**: `number`

Defined in: [src/AudioStudio.types.ts:769](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L769)

The start time in milliseconds for the `'single'` mode.
- If not provided, trimming starts from the beginning of the audio (0 ms).
