[**@siteed/audio-studio**](../README.md)

***

[@siteed/audio-studio](../README.md) / AudioSessionConfig

# Interface: AudioSessionConfig

Defined in: [src/AudioStudio.types.ts:210](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L210)

## Properties

### category?

> `optional` **category?**: `"Ambient"` \| `"SoloAmbient"` \| `"Playback"` \| `"Record"` \| `"PlayAndRecord"` \| `"MultiRoute"`

Defined in: [src/AudioStudio.types.ts:220](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L220)

Audio session category that defines the audio behavior
- 'Ambient': Audio continues with silent switch, mixes with other audio
- 'SoloAmbient': Audio continues with silent switch, interrupts other audio
- 'Playback': Audio continues in background, interrupts other audio
- 'Record': Optimized for recording, interrupts other audio
- 'PlayAndRecord': Allows simultaneous playback and recording
- 'MultiRoute': Routes audio to multiple outputs simultaneously

***

### categoryOptions?

> `optional` **categoryOptions?**: (`"MixWithOthers"` \| `"DuckOthers"` \| `"InterruptSpokenAudioAndMixWithOthers"` \| `"AllowBluetooth"` \| `"AllowBluetoothA2DP"` \| `"AllowAirPlay"` \| `"DefaultToSpeaker"`)[]

Defined in: [src/AudioStudio.types.ts:257](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L257)

Options that modify the behavior of the audio session category
- 'MixWithOthers': Allows mixing with other active audio sessions
- 'DuckOthers': Reduces the volume of other audio sessions
- 'InterruptSpokenAudioAndMixWithOthers': Interrupts spoken audio and mixes with others
- 'AllowBluetooth': Allows audio routing to Bluetooth devices
- 'AllowBluetoothA2DP': Allows audio routing to Bluetooth A2DP devices
- 'AllowAirPlay': Allows audio routing to AirPlay devices
- 'DefaultToSpeaker': Routes audio to the speaker by default

***

### mode?

> `optional` **mode?**: `"Default"` \| `"VoiceChat"` \| `"VideoChat"` \| `"GameChat"` \| `"VideoRecording"` \| `"Measurement"` \| `"MoviePlayback"` \| `"SpokenAudio"`

Defined in: [src/AudioStudio.types.ts:238](https://github.com/deeeed/audiolab/blob/aa94a5362218b70425a166d847bf058456071a52/packages/audio-studio/src/AudioStudio.types.ts#L238)

Audio session mode that defines the behavior for specific use cases
- 'Default': Standard audio behavior
- 'VoiceChat': Optimized for voice chat applications
- 'VideoChat': Optimized for video chat applications
- 'GameChat': Optimized for in-game chat
- 'VideoRecording': Optimized for video recording
- 'Measurement': Optimized for audio measurement
- 'MoviePlayback': Optimized for movie playback
- 'SpokenAudio': Optimized for spoken audio content
