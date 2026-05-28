[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / AudioDataEventRaw

# Interface: AudioDataEventRaw

Defined in: [src/AudioStudio.types.ts:61](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L61)

## Extends

- `AudioDataEventBase`

## Properties

### compression?

> `optional` **compression?**: [`CompressionInfo`](CompressionInfo.md) & `object`

Defined in: [src/AudioStudio.types.ts:55](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L55)

Information about compression if enabled, including the compressed data chunk

#### Type Declaration

##### data?

> `optional` **data?**: `string` \| `Blob`

Base64 (native) or Blob (web) encoded compressed data chunk

#### Inherited from

`AudioDataEventBase.compression`

***

### data

> **data**: `string` \| `Float32Array`\<`ArrayBufferLike`\> \| `Int16Array`\<`ArrayBufferLike`\>

Defined in: [src/AudioStudio.types.ts:63](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L63)

Audio data as base64 string (native), Float32Array (web), or Int16Array (web)

***

### eventDataSize

> **eventDataSize**: `number`

Defined in: [src/AudioStudio.types.ts:51](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L51)

Size of the current data chunk in bytes

#### Inherited from

`AudioDataEventBase.eventDataSize`

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioStudio.types.ts:49](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L49)

URI to the file being recorded

#### Inherited from

`AudioDataEventBase.fileUri`

***

### position

> **position**: `number`

Defined in: [src/AudioStudio.types.ts:47](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L47)

Current position in the audio stream in bytes

#### Inherited from

`AudioDataEventBase.position`

***

### streamFormat?

> `optional` **streamFormat?**: `"raw"`

Defined in: [src/AudioStudio.types.ts:64](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L64)

***

### totalSize

> **totalSize**: `number`

Defined in: [src/AudioStudio.types.ts:53](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/AudioStudio.types.ts#L53)

Total size of the recording so far in bytes

#### Inherited from

`AudioDataEventBase.totalSize`
