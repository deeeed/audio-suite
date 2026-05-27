[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / StreamAudioDataCallbacks

# Interface: StreamAudioDataCallbacks

Defined in: [src/streamAudioData.ts:97](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L97)

## Properties

### onChunk

> **onChunk**: (`chunk`) => `void` \| `Promise`\<`void`\>

Defined in: [src/streamAudioData.ts:103](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L103)

Called with each decoded chunk. If this returns a Promise, native decode
pauses until it resolves (backpressure). Throwing aborts the stream with
`ERR_AUDIO_STREAM_DECODE_FAILED`.

#### Parameters

##### chunk

[`StreamAudioDataChunk`](StreamAudioDataChunk.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### onProgress?

> `optional` **onProgress?**: (`progress`) => `void`

Defined in: [src/streamAudioData.ts:105](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/streamAudioData.ts#L105)

Called whenever native reports progress.

#### Parameters

##### progress

[`StreamAudioDataProgress`](StreamAudioDataProgress.md)

#### Returns

`void`
