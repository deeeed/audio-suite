[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / AudioStreamErrorCode

# Type Alias: AudioStreamErrorCode

> **AudioStreamErrorCode** = `"ERR_AUDIO_STREAM_UNSUPPORTED_FORMAT"` \| `"ERR_AUDIO_STREAM_INVALID_RANGE"` \| `"ERR_AUDIO_STREAM_DECODE_FAILED"` \| `"ERR_AUDIO_STREAM_CANCELLED"` \| `"ERR_AUDIO_STREAM_PERMISSION_DENIED"` \| `"ERR_AUDIO_STREAM_FILE_NOT_FOUND"` \| `"ERR_AUDIO_STREAM_BACKPRESSURE_TIMEOUT"` \| `"ERR_AUDIO_STREAM_NATIVE_UNAVAILABLE"` \| `"ERR_AUDIO_STREAM_BUSY"` \| `"ERR_AUDIO_STREAM_UNKNOWN"`

Defined in: [src/errors/AudioStreamError.ts:4](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/errors/AudioStreamError.ts#L4)

Stable typed errors for `streamAudioData`. Callers can switch on `code`.
