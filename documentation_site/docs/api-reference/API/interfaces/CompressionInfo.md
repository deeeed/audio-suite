[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / CompressionInfo

# Interface: CompressionInfo

Defined in: [src/AudioStudio.types.ts:9](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L9)

## Properties

### bitrate

> **bitrate**: `number`

Defined in: [src/AudioStudio.types.ts:15](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L15)

Bitrate of the compressed audio in bits per second

***

### compressedFileUri?

> `optional` **compressedFileUri?**: `string`

Defined in: [src/AudioStudio.types.ts:19](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L19)

URI to the compressed audio file if available

***

### format

> **format**: `string`

Defined in: [src/AudioStudio.types.ts:17](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L17)

Format of the compression (e.g., 'aac', 'opus')

***

### mimeType

> **mimeType**: `string`

Defined in: [src/AudioStudio.types.ts:13](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L13)

MIME type of the compressed audio (e.g., 'audio/aac', 'audio/opus')

***

### size

> **size**: `number`

Defined in: [src/AudioStudio.types.ts:11](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L11)

Size of the compressed audio data in bytes
