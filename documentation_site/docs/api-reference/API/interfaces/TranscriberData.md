[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / TranscriberData

# Interface: TranscriberData

Defined in: [src/AudioStudio.types.ts:131](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L131)

## Properties

### chunks

> **chunks**: [`Chunk`](Chunk.md)[]

Defined in: [src/AudioStudio.types.ts:143](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L143)

Array of transcribed text chunks with timestamps

***

### endTime

> **endTime**: `number`

Defined in: [src/AudioStudio.types.ts:141](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L141)

End time of the transcription in milliseconds

***

### id

> **id**: `string`

Defined in: [src/AudioStudio.types.ts:133](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L133)

Unique identifier for the transcription

***

### isBusy

> **isBusy**: `boolean`

Defined in: [src/AudioStudio.types.ts:135](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L135)

Indicates if the transcriber is currently processing

***

### startTime

> **startTime**: `number`

Defined in: [src/AudioStudio.types.ts:139](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L139)

Start time of the transcription in milliseconds

***

### text

> **text**: `string`

Defined in: [src/AudioStudio.types.ts:137](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L137)

Complete transcribed text
