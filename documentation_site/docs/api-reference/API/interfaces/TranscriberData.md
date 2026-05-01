[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / TranscriberData

# Interface: TranscriberData

Defined in: [src/AudioStudio.types.ts:127](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L127)

## Properties

### chunks

> **chunks**: [`Chunk`](Chunk.md)[]

Defined in: [src/AudioStudio.types.ts:139](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L139)

Array of transcribed text chunks with timestamps

***

### endTime

> **endTime**: `number`

Defined in: [src/AudioStudio.types.ts:137](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L137)

End time of the transcription in milliseconds

***

### id

> **id**: `string`

Defined in: [src/AudioStudio.types.ts:129](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L129)

Unique identifier for the transcription

***

### isBusy

> **isBusy**: `boolean`

Defined in: [src/AudioStudio.types.ts:131](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L131)

Indicates if the transcriber is currently processing

***

### startTime

> **startTime**: `number`

Defined in: [src/AudioStudio.types.ts:135](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L135)

Start time of the transcription in milliseconds

***

### text

> **text**: `string`

Defined in: [src/AudioStudio.types.ts:133](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L133)

Complete transcribed text
