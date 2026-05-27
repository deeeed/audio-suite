---
id: features
title: Features
sidebar_label: Features
---

# Key Features

`@siteed/audio-studio` provides a comprehensive set of audio recording, processing, and analysis features that work consistently across iOS, Android, and web platforms:

## Recording Features

- **Real-time audio streaming** with configurable quality settings across all platforms
- **Zero-latency recording** with [prepareRecording](api-reference/recording-config.md#zero-latency-recording) API to eliminate startup delay
- **Dual-stream recording** with simultaneous raw PCM and [compressed formats](api-reference/recording-config.md#output-configuration) (OPUS/AAC)
- **Audio device detection and selection** for choosing specific microphones or input sources
- **Intelligent interruption handling** with automatic pause/resume during phone calls
- **Max active recording duration** with notify-only or automatic stop behavior across iOS, Android, and web
- **Background recording** support with keep-awake functionality
- **Rich notification system** with live waveform visualization (Android) and media controls

## Device Management

- **Device enumeration** to list all available audio input devices
- **Detailed device capabilities** showing supported sample rates, channels, and bit depths
- **Device selection API** for choosing specific microphones or audio inputs
- **Device type detection** to identify Bluetooth, USB, wired, and built-in microphones
- **Automatic fallback behavior** when devices become unavailable
- **Cross-platform compatibility** with consistent API across iOS, Android, and web

> **Note:** Device detection features require Bluetooth and USB permissions on Android. You can disable this functionality by setting `enableDeviceDetection: false` in the [plugin configuration](installation.md#configuration-options) to reduce app permissions.

## Audio Processing

- **Comprehensive [audio analysis](api-reference/audio-features/audio-analysis-overview.md)** with feature extraction (energy, RMS, MFCC, etc.)
- **Advanced features extraction** (spectral features, chromagram, pitch detection, etc.) is available but experimental, especially during live recording due to high processing requirements
- **[Mel spectrogram generation](api-reference/audio-processing/extract-mel-spectrogram.md)** for machine learning and visualization
- **Precision [audio trimming](api-reference/audio-processing/trim-audio.md)** with multi-segment support
- **Format conversion** and normalization capabilities

## Platform Integration

- **Automated permissions** setup in managed Expo projects
- **Consistent WAV PCM** format across platforms
- **Native optimizations** for each platform's audio architecture:
  - Web: AudioWorkletProcessor for real-time processing
  - Android: Native AudioRecord API
  - iOS: AVAudioEngine with automatic sample rate adaptation

## User Interface

- Ready-to-use UI components via [@siteed/audio-ui](https://github.com/deeeed/audiolab/tree/main/packages/audio-ui) package
- Audio device selection components
- Visualizations, waveforms, and interactive audio controls
- Full-featured AudioPlayground application showcasing API usage

For detailed API documentation and usage examples, explore the [API Reference](api-reference/api-intro.md) section.
