[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / trimAudio

# Function: trimAudio()

> **trimAudio**(`options`, `progressCallback`?): `Promise`\<[`TrimAudioResult`](../interfaces/TrimAudioResult.md)\>

Defined in: [src/trimAudio.ts:74](https://github.com/deeeed/audiolab/blob/3a5b7da8f4289a599d928dce01f262ab97398143/packages/audio-studio/src/trimAudio.ts#L74)

**`Experimental`**

Trims an audio file based on the provided options.

 This API is experimental and not fully optimized for production use.
Performance may vary based on file size and device capabilities.
Future versions may include breaking changes.

## Parameters

### options

[`TrimAudioOptions`](../interfaces/TrimAudioOptions.md)

Configuration options for the trimming operation

### progressCallback?

(`event`) => `void`

Optional callback to receive progress updates

## Returns

`Promise`\<[`TrimAudioResult`](../interfaces/TrimAudioResult.md)\>

Promise resolving to the trimmed audio file information, including processing time
