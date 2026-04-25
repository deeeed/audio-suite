[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / AudioDataEventRaw

# Interface: AudioDataEventRaw

Defined in: [src/AudioStudio.types.ts:57](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L57)

## Extends

- `AudioDataEventBase`

## Properties

### compression?

> `optional` **compression**: [`CompressionInfo`](CompressionInfo.md) & `object`

Defined in: [src/AudioStudio.types.ts:51](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L51)

Information about compression if enabled, including the compressed data chunk

#### Type declaration

##### data?

> `optional` **data**: `string` \| `Blob`

Base64 (native) or Blob (web) encoded compressed data chunk

#### Inherited from

`AudioDataEventBase.compression`

***

### data

> **data**: `string` \| `Float32Array`\<`ArrayBufferLike`\> \| `Int16Array`\<`ArrayBufferLike`\>

Defined in: [src/AudioStudio.types.ts:59](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L59)

Audio data as base64 string (native), Float32Array (web), or Int16Array (web)

***

### eventDataSize

> **eventDataSize**: `number`

Defined in: [src/AudioStudio.types.ts:47](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L47)

Size of the current data chunk in bytes

#### Inherited from

`AudioDataEventBase.eventDataSize`

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioStudio.types.ts:45](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L45)

URI to the file being recorded

#### Inherited from

`AudioDataEventBase.fileUri`

***

### position

> **position**: `number`

Defined in: [src/AudioStudio.types.ts:43](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L43)

Current position in the audio stream in bytes

#### Inherited from

`AudioDataEventBase.position`

***

### streamFormat?

> `optional` **streamFormat**: `"raw"`

Defined in: [src/AudioStudio.types.ts:60](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L60)

***

### totalSize

> **totalSize**: `number`

Defined in: [src/AudioStudio.types.ts:49](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/AudioStudio.types.ts#L49)

Total size of the recording so far in bytes

#### Inherited from

`AudioDataEventBase.totalSize`
