[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / AudioDataEventFloat32

# Interface: AudioDataEventFloat32

Defined in: [src/AudioStudio.types.ts:63](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L63)

## Extends

- `AudioDataEventBase`

## Properties

### compression?

> `optional` **compression**: [`CompressionInfo`](CompressionInfo.md) & `object`

Defined in: [src/AudioStudio.types.ts:51](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L51)

Information about compression if enabled, including the compressed data chunk

#### Type declaration

##### data?

> `optional` **data**: `string` \| `Blob`

Base64 (native) or Blob (web) encoded compressed data chunk

#### Inherited from

`AudioDataEventBase.compression`

***

### data

> **data**: `Float32Array`

Defined in: [src/AudioStudio.types.ts:65](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L65)

Audio data as Float32Array with samples in [-1, 1] range

***

### eventDataSize

> **eventDataSize**: `number`

Defined in: [src/AudioStudio.types.ts:47](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L47)

Size of the current data chunk in bytes

#### Inherited from

`AudioDataEventBase.eventDataSize`

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioStudio.types.ts:45](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L45)

URI to the file being recorded

#### Inherited from

`AudioDataEventBase.fileUri`

***

### position

> **position**: `number`

Defined in: [src/AudioStudio.types.ts:43](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L43)

Current position in the audio stream in bytes

#### Inherited from

`AudioDataEventBase.position`

***

### streamFormat

> **streamFormat**: `"float32"`

Defined in: [src/AudioStudio.types.ts:66](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L66)

***

### totalSize

> **totalSize**: `number`

Defined in: [src/AudioStudio.types.ts:49](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L49)

Total size of the recording so far in bytes

#### Inherited from

`AudioDataEventBase.totalSize`
