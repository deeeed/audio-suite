**@siteed/audio-studio**

***

# @siteed/audio-studio

## Classes

- [AudioDeviceManager](classes/AudioDeviceManager.md)

## Interfaces

- [AndroidConfig](interfaces/AndroidConfig.md)
- [AudioAnalysis](interfaces/AudioAnalysis.md)
- [AudioDataEventFloat32](interfaces/AudioDataEventFloat32.md)
- [AudioDataEventRaw](interfaces/AudioDataEventRaw.md)
- [AudioDevice](interfaces/AudioDevice.md)
- [AudioDeviceCapabilities](interfaces/AudioDeviceCapabilities.md)
- [AudioFeatures](interfaces/AudioFeatures.md)
- [AudioFeaturesOptions](interfaces/AudioFeaturesOptions.md)
- [AudioFeaturesWasmResult](interfaces/AudioFeaturesWasmResult.md)
- [AudioRangeOptions](interfaces/AudioRangeOptions.md)
- [AudioRecording](interfaces/AudioRecording.md)
- [AudioSessionConfig](interfaces/AudioSessionConfig.md)
- [AudioStreamStatus](interfaces/AudioStreamStatus.md)
- [Chunk](interfaces/Chunk.md)
- [CompressionInfo](interfaces/CompressionInfo.md)
- [DataPoint](interfaces/DataPoint.md)
- [DecodingConfig](interfaces/DecodingConfig.md)
- [ExtractAudioDataOptions](interfaces/ExtractAudioDataOptions.md)
- [ExtractedAudioData](interfaces/ExtractedAudioData.md)
- [ExtractMelSpectrogramOptions](interfaces/ExtractMelSpectrogramOptions.md)
- [IOSConfig](interfaces/IOSConfig.md)
- [MelSpectrogram](interfaces/MelSpectrogram.md)
- [NotificationAction](interfaces/NotificationAction.md)
- [NotificationConfig](interfaces/NotificationConfig.md)
- [OutputConfig](interfaces/OutputConfig.md)
- [PlatformCapabilities](interfaces/PlatformCapabilities.md)
- [PreviewOptions](interfaces/PreviewOptions.md)
- [RecordingConfig](interfaces/RecordingConfig.md)
- [RecordingInterruptionEvent](interfaces/RecordingInterruptionEvent.md)
- [SpeechFeatures](interfaces/SpeechFeatures.md)
- [StartRecordingResult](interfaces/StartRecordingResult.md)
- [TimeRange](interfaces/TimeRange.md)
- [TranscriberData](interfaces/TranscriberData.md)
- [TrimAudioOptions](interfaces/TrimAudioOptions.md)
- [TrimAudioResult](interfaces/TrimAudioResult.md)
- [TrimProgressEvent](interfaces/TrimProgressEvent.md)
- [UseAudioRecorderState](interfaces/UseAudioRecorderState.md)
- [WaveformConfig](interfaces/WaveformConfig.md)
- [WavFileInfo](interfaces/WavFileInfo.md)
- [WavHeaderOptions](interfaces/WavHeaderOptions.md)
- [WebConfig](interfaces/WebConfig.md)

## Type Aliases

- [AudioDataEvent](type-aliases/AudioDataEvent.md)
- [BitDepth](type-aliases/BitDepth.md)
- [ConsoleLike](type-aliases/ConsoleLike.md)
- [DeviceDisconnectionBehaviorType](type-aliases/DeviceDisconnectionBehaviorType.md)
- [EncodingType](type-aliases/EncodingType.md)
- [~~PCMFormat~~](type-aliases/PCMFormat.md)
- [RecordingInterruptionReason](type-aliases/RecordingInterruptionReason.md)
- [SampleRate](type-aliases/SampleRate.md)

## Variables

- [audioDeviceManager](variables/audioDeviceManager.md)
- [AudioStudioModule](variables/AudioStudioModule.md)
- [DeviceDisconnectionBehavior](variables/DeviceDisconnectionBehavior.md)
- [~~ExpoAudioStreamModule~~](variables/ExpoAudioStreamModule.md)
- [MAX\_DURATION\_MS](variables/MAX_DURATION_MS.md)
- [WAV\_HEADER\_SIZE](variables/WAV_HEADER_SIZE.md)

## Functions

- [AudioRecorderProvider](functions/AudioRecorderProvider.md)
- [computeMelFrameWasm](functions/computeMelFrameWasm.md)
- [convertPCMToFloat32](functions/convertPCMToFloat32.md)
- [extractAudioAnalysis](functions/extractAudioAnalysis.md)
- [extractAudioData](functions/extractAudioData.md)
- [extractMelSpectrogram](functions/extractMelSpectrogram.md)
- [extractPreview](functions/extractPreview.md)
- [extractRawWavAnalysis](functions/extractRawWavAnalysis.md)
- [getFallbackBitDepth](functions/getFallbackBitDepth.md)
- [getFallbackEncoding](functions/getFallbackEncoding.md)
- [getPlatformCapabilities](functions/getPlatformCapabilities.md)
- [getWavFileInfo](functions/getWavFileInfo.md)
- [initMelStreamingWasm](functions/initMelStreamingWasm.md)
- [isBitDepthSupported](functions/isBitDepthSupported.md)
- [isEncodingSupported](functions/isEncodingSupported.md)
- [setMelSpectrogramWasmUrl](functions/setMelSpectrogramWasmUrl.md)
- [trimAudio](functions/trimAudio.md)
- [useAudioDevices](functions/useAudioDevices.md)
- [useAudioRecorder](functions/useAudioRecorder.md)
- [useSharedAudioRecorder](functions/useSharedAudioRecorder.md)
- [validateRecordingConfig](functions/validateRecordingConfig.md)
- [writeWavHeader](functions/writeWavHeader.md)
