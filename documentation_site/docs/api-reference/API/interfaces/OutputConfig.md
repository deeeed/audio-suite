[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / OutputConfig

# Interface: OutputConfig

Defined in: [src/AudioStudio.types.ts:347](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L347)

Configuration for audio output files during recording

## Properties

### compressed?

> `optional` **compressed**: `object`

Defined in: [src/AudioStudio.types.ts:361](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L361)

Configuration for the compressed output file

#### bitrate?

> `optional` **bitrate**: `number`

Bitrate for compression in bits per second (default: 128000)

#### enabled?

> `optional` **enabled**: `boolean`

Whether to create a compressed output file (default: false)

#### format?

> `optional` **format**: `"aac"` \| `"opus"`

Format for compression
- 'aac': Advanced Audio Coding - supported on all platforms
- 'opus': Opus encoding - supported on Android and Web; on iOS will automatically fall back to AAC

#### preferRawStream?

> `optional` **preferRawStream**: `boolean`

Prefer raw stream over container format (Android only)
- true: Use raw AAC stream (.aac files) like in v2.10.6
- false/undefined: Use M4A container (.m4a files) for better seeking support
Note: iOS always produces M4A containers and ignores this flag

***

### primary?

> `optional` **primary**: `object`

Defined in: [src/AudioStudio.types.ts:351](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L351)

Configuration for the primary (uncompressed) output file

#### enabled?

> `optional` **enabled**: `boolean`

Whether to create the primary output file (default: true)

#### format?

> `optional` **format**: `"wav"`

Format for the primary output (currently only 'wav' is supported)
