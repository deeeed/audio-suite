[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / mapExtractionError

# Function: mapExtractionError()

> **mapExtractionError**(`err`, `fileUri?`): [`AudioExtractionError`](../classes/AudioExtractionError.md)

Defined in: [src/errors/AudioExtractionError.ts:111](https://github.com/deeeed/audiolab/blob/c729585a5bba4d56b2e225795b3b4e8fe3e3cdfe/packages/audio-studio/src/errors/AudioExtractionError.ts#L111)

Map a thrown native/JS value into an AudioExtractionError with a stable code.
Heuristics inspect message text and known native error codes.

## Parameters

### err

`unknown`

### fileUri?

`string`

## Returns

[`AudioExtractionError`](../classes/AudioExtractionError.md)
