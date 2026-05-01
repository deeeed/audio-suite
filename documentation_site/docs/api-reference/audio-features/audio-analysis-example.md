---
id: audio-analysis-example
title: Audio Analysis Example
sidebar_label: Usage Example
---

# Audio Analysis Example

This example demonstrates how to use the audio analysis features in a real-world application. We'll create a simple component that records audio, analyzes it, and displays the results.

## Complete Example

```tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, Button, ScrollView } from 'react-native';
import { 
  useAudioRecorder, 
  extractAudioAnalysis, 
  AudioAnalysis, 
  AudioFeatures,
  AudioRecording
} from '@siteed/audio-studio';
import { LineChart } from 'react-native-chart-kit';

interface FeatureDisplayProps {
  label: string;
  value: number | number[] | undefined;
}

const FeatureDisplay: React.FC<FeatureDisplayProps> = ({ label, value }) => {
  if (value === undefined) return null;
  
  // Format array values for display
  const displayValue = Array.isArray(value) 
    ? value.slice(0, 3).map(v => v.toFixed(2)).join(', ') + (value.length > 3 ? '...' : '')
    : value.toFixed(4);
  
  return (
    <View style={styles.featureRow}>
      <Text style={styles.featureLabel}>{label}:</Text>
      <Text style={styles.featureValue}>{displayValue}</Text>
    </View>
  );
};

const AudioAnalyzer: React.FC = () => {
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<AudioFeatures | null>(null);
  const [recording, setRecording] = useState<AudioRecording | null>(null);
  
  // Initialize the audio recorder
  const { 
    startRecording, 
    stopRecording, 
    isRecording,
    durationMs
  } = useAudioRecorder();
  
  // Handle starting the recording
  const handleStartRecording = async () => {
    await startRecording({
      sampleRate: 44100,
      channels: 1,
      encoding: 'pcm_16bit',
      enableProcessing: true
    });
  };
  
  // Handle stopping the recording and analyzing the audio
  const handleStopRecording = async () => {
    const recordingResult = await stopRecording();
    setRecording(recordingResult);
    
    if (recordingResult.fileUri) {
      await analyzeAudio(recordingResult.fileUri);
    }
  };
  
  // Function to analyze the recorded audio
  const analyzeAudio = async (fileUri: string) => {
    setIsAnalyzing(true);
    try {
      const result = await extractAudioAnalysis({
        fileUri,
        segmentDurationMs: 100, // 100ms segments
        features: {
          energy: true,
          rms: true,
          zcr: true,
          spectralCentroid: true,
          spectralFlatness: true,
          mfcc: true,
          tempo: true,
        },
        decodingOptions: {
          targetSampleRate: 44100,
          targetChannels: 1,
          targetBitDepth: 16,
          normalizeAudio: true
        }
      });
      
      setAnalysis(result);
      
      // Select the first data point with features for display
      const pointWithFeatures = result.dataPoints.find(point => point.features);
      if (pointWithFeatures && pointWithFeatures.features) {
        setSelectedFeatures(pointWithFeatures.features);
      }
    } catch (error) {
      console.error('Error analyzing audio:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  // Prepare data for the waveform chart
  const chartData = analysis ? {
    labels: [],
    datasets: [{
      data: analysis.dataPoints.map(point => point.amplitude),
      color: () => 'rgba(75, 192, 192, 1)',
      strokeWidth: 2,
    }],
  } : { labels: [], datasets: [{ data: [], color: () => '', strokeWidth: 0 }] };
  
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Audio Analyzer</Text>
      
      <View style={styles.buttonContainer}>
        {!isRecording ? (
          <Button
            title="Start Recording"
            onPress={handleStartRecording}
            disabled={isAnalyzing}
          />
        ) : (
          <View>
            <Text>Recording: {(durationMs / 1000).toFixed(1)}s</Text>
            <Button
              title="Stop Recording"
              onPress={handleStopRecording}
              color="red"
            />
          </View>
        )}
      </View>
      
      {isAnalyzing && (
        <Text style={styles.status}>Analyzing audio...</Text>
      )}
      
      {analysis && (
        <>
          <Text style={styles.sectionTitle}>Waveform</Text>
          <LineChart
            data={chartData}
            width={350}
            height={200}
            chartConfig={{
              backgroundColor: '#ffffff',
              backgroundGradientFrom: '#ffffff',
              backgroundGradientTo: '#ffffff',
              decimalPlaces: 2,
              color: () => 'rgba(75, 192, 192, 1)',
              labelColor: () => 'rgba(0, 0, 0, 1)',
              style: {
                borderRadius: 16,
              },
            }}
            bezier
            style={styles.chart}
          />
          
          <Text style={styles.sectionTitle}>Audio Information</Text>
          <View style={styles.infoContainer}>
            <Text>Duration: {(analysis.durationMs / 1000).toFixed(2)} seconds</Text>
            <Text>Sample Rate: {analysis.sampleRate} Hz</Text>
            <Text>Bit Depth: {analysis.bitDepth} bits</Text>
            <Text>Channels: {analysis.numberOfChannels}</Text>
            <Text>Segments: {analysis.dataPoints.length} ({analysis.segmentDurationMs}ms each)</Text>
          </View>
          
          {selectedFeatures && (
            <>
              <Text style={styles.sectionTitle}>Audio Features</Text>
              <View style={styles.featuresContainer}>
                <FeatureDisplay label="RMS (Loudness)" value={selectedFeatures.rms} />
                <FeatureDisplay label="Energy" value={selectedFeatures.energy} />
                <FeatureDisplay label="Zero-crossing Rate" value={selectedFeatures.zcr} />
                <FeatureDisplay label="Spectral Centroid" value={selectedFeatures.spectralCentroid} />
                <FeatureDisplay label="Spectral Flatness" value={selectedFeatures.spectralFlatness} />
                <FeatureDisplay label="Tempo (BPM)" value={selectedFeatures.tempo} />
                <FeatureDisplay label="MFCC" value={selectedFeatures.mfcc} />
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  buttonContainer: {
    marginBottom: 20,
    alignItems: 'center',
  },
  status: {
    textAlign: 'center',
    marginVertical: 10,
    fontStyle: 'italic',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 10,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  infoContainer: {
    backgroundColor: '#ffffff',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  featuresContainer: {
    backgroundColor: '#ffffff',
    padding: 15,
    borderRadius: 8,
  },
  featureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  featureLabel: {
    fontWeight: '500',
  },
  featureValue: {
    fontFamily: 'monospace',
  },
});

export default AudioAnalyzer;
```

## How It Works

1. **Recording Setup**: We use the `useAudioRecorder` hook to handle audio recording with specific configuration options.

2. **Analysis Trigger**: When recording stops, we automatically analyze the audio file using `extractAudioAnalysis`.

3. **Feature Extraction**: We specify which audio features to extract:
   - Basic features: RMS, energy, zero-crossing rate
   - Spectral features: spectral centroid, spectral flatness
   - Advanced features: MFCC, tempo

4. **Visualization**: We display the audio waveform using a line chart based on amplitude values.

5. **Feature Display**: We show the extracted features in a readable format, handling both scalar and array values.

## Key API Usage

### Recording Configuration

```tsx
await startRecording({
  sampleRate: 44100,
  channels: 1,
  encoding: 'pcm_16bit',
  enableProcessing: true
});
```

### Audio Analysis Configuration

```tsx
const result = await extractAudioAnalysis({
  fileUri,
  segmentDurationMs: 100, // 100ms segments
  features: {
    energy: true,
    rms: true,
    zcr: true,
    spectralCentroid: true,
    spectralFlatness: true,
    mfcc: true,
    tempo: true,
  },
  decodingOptions: {
    targetSampleRate: 44100,
    targetChannels: 1,
    targetBitDepth: 16,
    normalizeAudio: true
  }
});
```

## Live vs. Post-Recording Analysis

The example above records with `enableProcessing: true`, which enables live analysis. By default, the recorder also retains the full live-analysis history for `stopRecording().analysisData`. For long-running sessions where you only need live callbacks and will run `extractAudioAnalysis()` after stop, start recording with `keepFullAnalysis: false`:

```tsx
await startRecording({
  sampleRate: 44100,
  channels: 1,
  encoding: 'pcm_16bit',
  enableProcessing: true,
  keepFullAnalysis: false
});
```

This keeps `onAudioAnalysis` and the hook's recent `analysisData` window working, but omits `recordingResult.analysisData` from the stop result.

## Performance Tips

- For longer recordings, consider analyzing in chunks by specifying time ranges:
  ```tsx
  // Analyze just the first 10 seconds
  await extractAudioAnalysis({
    fileUri,
    startTimeMs: 0,
    endTimeMs: 10000,
    // other options...
  });
  ```

- Adjust `segmentDurationMs` based on your visualization needs:
  - Smaller values (e.g., 50ms) provide more detail but more data points
  - Larger values (e.g., 200ms) provide less detail but better performance

- For real-time applications, focus on lightweight features (RMS, ZCR) and avoid computationally expensive ones (MFCC, tempo)

- Consider using a Web Worker for analysis on web platforms to avoid blocking the main thread

This example demonstrates a basic implementation. For production applications, you might want to add error handling, loading states, and more sophisticated visualizations. 