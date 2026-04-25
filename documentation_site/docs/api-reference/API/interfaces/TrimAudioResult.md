[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / TrimAudioResult

# Interface: TrimAudioResult

Defined in: [src/AudioStudio.types.ts:829](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L829)

Result of the audio trimming operation.

## Properties

### bitDepth

> **bitDepth**: `number`

Defined in: [src/AudioStudio.types.ts:863](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L863)

The bit depth of the trimmed audio, applicable to PCM formats like `'wav'`.

***

### channels

> **channels**: `number`

Defined in: [src/AudioStudio.types.ts:858](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L858)

The number of channels in the trimmed audio (e.g., 1 for mono, 2 for stereo).

***

### compression?

> `optional` **compression**: `object`

Defined in: [src/AudioStudio.types.ts:873](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L873)

Information about compression if the output format is compressed.

#### bitrate

> **bitrate**: `number`

The bitrate of the compressed audio in bits per second.

#### format

> **format**: `string`

The format of the compression (e.g., `'aac'`, `'mp3'`, `'opus'`).

#### size

> **size**: `number`

The size of the compressed audio file in bytes.

***

### durationMs

> **durationMs**: `number`

Defined in: [src/AudioStudio.types.ts:843](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L843)

The duration of the trimmed audio in milliseconds.

***

### filename

> **filename**: `string`

Defined in: [src/AudioStudio.types.ts:838](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L838)

The filename of the trimmed audio file.

***

### mimeType

> **mimeType**: `string`

Defined in: [src/AudioStudio.types.ts:868](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L868)

The MIME type of the trimmed audio file (e.g., `'audio/wav'`, `'audio/mpeg'`).

***

### processingInfo?

> `optional` **processingInfo**: `object`

Defined in: [src/AudioStudio.types.ts:893](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L893)

Information about the processing time.

#### durationMs

> **durationMs**: `number`

The time it took to process the audio in milliseconds.

***

### sampleRate

> **sampleRate**: `number`

Defined in: [src/AudioStudio.types.ts:853](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L853)

The sample rate of the trimmed audio in Hertz (Hz).

***

### size

> **size**: `number`

Defined in: [src/AudioStudio.types.ts:848](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L848)

The size of the trimmed audio file in bytes.

***

### uri

> **uri**: `string`

Defined in: [src/AudioStudio.types.ts:833](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L833)

The URI of the trimmed audio file.
