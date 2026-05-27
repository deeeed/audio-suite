[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / writeWavHeader

# Function: writeWavHeader()

> **writeWavHeader**(`options`): `ArrayBuffer`

Defined in: [src/utils/writeWavHeader.ts:36](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/utils/writeWavHeader.ts#L36)

Writes or updates a WAV (RIFF) header based on the provided options.

This function can be used in three ways:
1. To create a standalone WAV header (when no buffer is provided).
2. To create a WAV header and combine it with existing audio data (when a buffer without a header is provided).
3. To update an existing WAV header in the provided buffer.

For streaming audio where the final size is unknown, this function sets the size fields
to the maximum 32-bit value (0xFFFFFFFF). These can be updated later using the
`updateWavHeaderSize` function once the final size is known.

## Parameters

### options

[`WavHeaderOptions`](../interfaces/WavHeaderOptions.md)

The options for creating or updating the WAV header.

## Returns

`ArrayBuffer`

An ArrayBuffer containing the WAV header, or the header combined with the provided audio data.

## Throws

Throws an error if the provided options are invalid or if the buffer is too small.
