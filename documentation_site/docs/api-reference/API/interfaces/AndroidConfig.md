[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / AndroidConfig

# Interface: AndroidConfig

Defined in: [src/AudioStudio.types.ts:257](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L257)

Android platform specific configuration options

## Properties

### audioFocusStrategy?

> `optional` **audioFocusStrategy**: `"background"` \| `"interactive"` \| `"communication"` \| `"none"`

Defined in: [src/AudioStudio.types.ts:268](https://github.com/deeeed/audiolab/blob/786b292627cf65fad3559f4751e78bbcedee512a/packages/audio-studio/src/AudioStudio.types.ts#L268)

Audio focus strategy for handling interruptions and background behavior

- `'background'`: Continue recording when app loses focus (voice recorders, transcription apps)
- `'interactive'`: Pause when losing focus, resume when gaining (music apps, games)
- `'communication'`: Maintain priority for real-time communication (video calls, voice chat)
- `'none'`: No automatic audio focus management (custom handling)

#### Default

```ts
'background' when keepAwake=true, 'interactive' otherwise
```
