[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / TrimAudioResult

# Interface: TrimAudioResult

Defined in: [src/AudioStudio.types.ts:843](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L843)

Result of the audio trimming operation.

## Properties

### bitDepth

> **bitDepth**: `number`

Defined in: [src/AudioStudio.types.ts:877](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L877)

The bit depth of the trimmed audio, applicable to PCM formats like `'wav'`.

***

### channels

> **channels**: `number`

Defined in: [src/AudioStudio.types.ts:872](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L872)

The number of channels in the trimmed audio (e.g., 1 for mono, 2 for stereo).

***

### compression?

> `optional` **compression**: `object`

Defined in: [src/AudioStudio.types.ts:887](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L887)

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

Defined in: [src/AudioStudio.types.ts:857](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L857)

The duration of the trimmed audio in milliseconds.

***

### filename

> **filename**: `string`

Defined in: [src/AudioStudio.types.ts:852](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L852)

The filename of the trimmed audio file.

***

### mimeType

> **mimeType**: `string`

Defined in: [src/AudioStudio.types.ts:882](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L882)

The MIME type of the trimmed audio file (e.g., `'audio/wav'`, `'audio/mpeg'`).

***

### processingInfo?

> `optional` **processingInfo**: `object`

Defined in: [src/AudioStudio.types.ts:907](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L907)

Information about the processing time.

#### durationMs

> **durationMs**: `number`

The time it took to process the audio in milliseconds.

***

### sampleRate

> **sampleRate**: `number`

Defined in: [src/AudioStudio.types.ts:867](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L867)

The sample rate of the trimmed audio in Hertz (Hz).

***

### size

> **size**: `number`

Defined in: [src/AudioStudio.types.ts:862](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L862)

The size of the trimmed audio file in bytes.

***

### uri

> **uri**: `string`

Defined in: [src/AudioStudio.types.ts:847](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L847)

The URI of the trimmed audio file.
