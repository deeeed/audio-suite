[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / convertPCMToFloat32

# Function: convertPCMToFloat32()

> **convertPCMToFloat32**(`__namedParameters`): `Promise`\<\{ `max`: `number`; `min`: `number`; `pcmValues`: `Float32Array`; \}\>

Defined in: [src/utils/convertPCMToFloat32.ts:69](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/utils/convertPCMToFloat32.ts#L69)

## Parameters

### \_\_namedParameters

#### bitDepth

`number`

#### buffer

`ArrayBuffer`

#### logger?

[`ConsoleLike`](../type-aliases/ConsoleLike.md)

#### skipWavHeader?

`boolean` = `false`

## Returns

`Promise`\<\{ `max`: `number`; `min`: `number`; `pcmValues`: `Float32Array`; \}\>
