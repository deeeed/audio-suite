[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / AudioDataEventFloat32

# Interface: AudioDataEventFloat32

Defined in: [src/AudioStudio.types.ts:67](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L67)

## Extends

- `AudioDataEventBase`

## Properties

### compression?

> `optional` **compression?**: [`CompressionInfo`](CompressionInfo.md) & `object`

Defined in: [src/AudioStudio.types.ts:55](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L55)

Information about compression if enabled, including the compressed data chunk

#### Type Declaration

##### data?

> `optional` **data?**: `string` \| `Blob`

Base64 (native) or Blob (web) encoded compressed data chunk

#### Inherited from

`AudioDataEventBase.compression`

***

### data

> **data**: `Float32Array`

Defined in: [src/AudioStudio.types.ts:69](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L69)

Audio data as Float32Array with samples in [-1, 1] range

***

### eventDataSize

> **eventDataSize**: `number`

Defined in: [src/AudioStudio.types.ts:51](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L51)

Size of the current data chunk in bytes

#### Inherited from

`AudioDataEventBase.eventDataSize`

***

### fileUri

> **fileUri**: `string`

Defined in: [src/AudioStudio.types.ts:49](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L49)

URI to the file being recorded

#### Inherited from

`AudioDataEventBase.fileUri`

***

### position

> **position**: `number`

Defined in: [src/AudioStudio.types.ts:47](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L47)

Current position in the audio stream in bytes

#### Inherited from

`AudioDataEventBase.position`

***

### streamFormat

> **streamFormat**: `"float32"`

Defined in: [src/AudioStudio.types.ts:70](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L70)

***

### totalSize

> **totalSize**: `number`

Defined in: [src/AudioStudio.types.ts:53](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L53)

Total size of the recording so far in bytes

#### Inherited from

`AudioDataEventBase.totalSize`
