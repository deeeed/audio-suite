[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / AudioExtractionErrorCode

# Type Alias: AudioExtractionErrorCode

> **AudioExtractionErrorCode** = `"unsupported_codec"` \| `"malformed_file"` \| `"decode_failed"` \| `"permission_denied"` \| `"file_not_found"` \| `"unknown"`

Defined in: [src/errors/AudioExtractionError.ts:5](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/errors/AudioExtractionError.ts#L5)

Typed error class for audio extraction failures.
Wraps native module errors with stable codes consumers can switch on.
