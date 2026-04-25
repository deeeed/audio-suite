[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / TrimProgressEvent

# Interface: TrimProgressEvent

Defined in: [src/AudioStudio.types.ts:708](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L708)

Represents an event emitted during the trimming process to report progress.

## Properties

### bytesProcessed?

> `optional` **bytesProcessed**: `number`

Defined in: [src/AudioStudio.types.ts:717](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L717)

The number of bytes that have been processed so far. This is optional and may not be provided in all implementations.

***

### progress

> **progress**: `number`

Defined in: [src/AudioStudio.types.ts:712](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L712)

The percentage of the trimming process that has been completed, ranging from 0 to 100.

***

### totalBytes?

> `optional` **totalBytes**: `number`

Defined in: [src/AudioStudio.types.ts:722](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L722)

The total number of bytes to process. This is optional and may not be provided in all implementations.
