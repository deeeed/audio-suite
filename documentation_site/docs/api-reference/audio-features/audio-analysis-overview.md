---
id: audio-analysis-overview
title: Audio Analysis Overview
sidebar_label: Overview
---

# Audio Analysis Overview

The `@siteed/audio-studio` library provides powerful audio analysis capabilities that allow you to extract various features from audio recordings. These features can be used for visualization, audio fingerprinting, speech recognition preprocessing, and more.

## Quick Start

```typescript
import { extractAudioAnalysis } from '@siteed/audio-studio';

// Extract audio analysis with specific features enabled
const analysis = await extractAudioAnalysis({
  fileUri: 'path/to/recording.wav',
  features: {
    energy: true,     // Overall energy of the audio
    rms: true,        // Root mean square (amplitude)
    zcr: true,        // Zero-crossing rate
    mfcc: true,       // Mel-frequency cepstral coefficients
    spectralCentroid: true,  // Brightness of sound
    tempo: true,      // Estimated BPM
  }
});

// Access the analysis data
console.log(`Audio duration: ${analysis.durationMs}ms`);
console.log(`Sample rate: ${analysis.sampleRate}Hz`);
console.log(`Number of data points: ${analysis.dataPoints.length}`);

// Access features from a specific data point
const dataPoint = analysis.dataPoints[0];
if (dataPoint.features) {
  console.log(`RMS: ${dataPoint.features.rms}`);
  console.log(`Energy: ${dataPoint.features.energy}`);
  console.log(`Zero-crossing rate: ${dataPoint.features.zcr}`);
}
```

## Available Audio Features

The library supports extracting the following audio features:

### Basic Analysis
- **RMS (Root Mean Square)**: Indicates the amplitude of the audio signal
- **Energy**: Represents the overall energy of the audio
- **Amplitude Range**: Min and max amplitude values
- **Zero-crossing Rate (ZCR)**: Rate at which the signal changes sign

### Spectral Features
- **Spectral Centroid**: Center of mass of the spectrum, indicating brightness of sound
- **Spectral Flatness**: Measure of how noise-like the signal is
- **Spectral Rolloff**: Frequency below which a specified percentage of energy lies
- **Spectral Bandwidth**: Width of the spectrum, indicating frequency range

### Advanced Analysis
- **MFCC (Mel-frequency cepstral coefficients)**: Describes the short-term power spectrum
- **Chromagram**: Represents the 12 different pitch classes
- **Mel Spectrogram**: Mel-scaled spectrogram representation
- **Harmonics-to-noise Ratio (HNR)**: Proportion of harmonics to noise
- **Tempo**: Estimated beats per minute (BPM)
- **Pitch**: Estimated fundamental frequency

## Configuring Feature Extraction

You can selectively enable the features you need using the `features` option:

```typescript
const analysisProps = {
  fileUri: 'path/to/audio/file.wav',
  features: {
    energy: true,
    rms: true,
    zcr: true,
    mfcc: true,
    spectralCentroid: true,
    spectralFlatness: true,
    spectralRolloff: true,
    spectralBandwidth: true,
    chromagram: true,
    tempo: true,
    hnr: true,
    melSpectrogram: true,
    pitch: true,
  },
};
```

## Common Use Cases

- **Audio Visualization**: Create detailed waveform visualizations with additional metrics
- **Speech Recognition**: Preprocess audio for speech recognition systems
- **Music Analysis**: Analyze musical characteristics like tempo, pitch, and harmonic content
- **Audio Fingerprinting**: Create unique fingerprints for audio identification
- **Voice Activity Detection**: Detect presence of speech in audio recordings

## Performance Considerations

- Enable only the features you need to improve performance
- For real-time analysis, consider using a lower sample rate
- Processing large audio files may be resource-intensive; consider processing in chunks

For more detailed information about specific audio features and extraction methods, see the [Audio Features](./audio-analysis.md) and [extractAudioAnalysis](./extract-audio-analysis.md) documentation.
