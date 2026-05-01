[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / TrimProgressEvent

# Interface: TrimProgressEvent

Defined in: [src/AudioStudio.types.ts:722](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L722)

Represents an event emitted during the trimming process to report progress.

## Properties

### bytesProcessed?

> `optional` **bytesProcessed**: `number`

Defined in: [src/AudioStudio.types.ts:731](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L731)

The number of bytes that have been processed so far. This is optional and may not be provided in all implementations.

***

### progress

> **progress**: `number`

Defined in: [src/AudioStudio.types.ts:726](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L726)

The percentage of the trimming process that has been completed, ranging from 0 to 100.

***

### totalBytes?

> `optional` **totalBytes**: `number`

Defined in: [src/AudioStudio.types.ts:736](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L736)

The total number of bytes to process. This is optional and may not be provided in all implementations.
