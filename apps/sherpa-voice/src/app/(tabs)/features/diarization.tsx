import type { DiarizationSegment } from '@siteed/sherpa-onnx.rn';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { InlineModelDownloader } from '../../../components/InlineModelDownloader';
import {
  AudioPlayButton,
  ConfigRow,
  LoadingOverlay,
  ModelSelector,
  PageContainer,
  Section,
  StatusBlock,
  Text,
  ThemedButton,
  useTheme,
} from '../../../components/ui';
import { useDiarization } from '../../../hooks/useDiarization';
import { baseLogger } from '../../../config';

const logger = baseLogger.extend('DiarizationScreen');

const SPEAKER_COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#E91E63',
  '#9C27B0', '#00BCD4', '#FF5722', '#607D8B',
];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

function SpeakerTimeline({ segments, totalDuration }: { segments: DiarizationSegment[]; totalDuration: number }) {
  const theme = useTheme();
  if (segments.length === 0) return null;
  const duration = totalDuration || Math.max(...segments.map(s => s.end));

  return (
    <View style={{ marginTop: 12 }}>
      <Text variant="labelMedium" style={{ marginBottom: 8, color: theme.colors.onSurface }}>
        Speaker Timeline
      </Text>
      <View style={{ height: 48, backgroundColor: theme.colors.surfaceVariant, borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
        {segments.map((seg, i) => {
          const left = (seg.start / duration) * 100;
          const width = Math.max(((seg.end - seg.start) / duration) * 100, 0.5);
          const color = SPEAKER_COLORS[seg.speaker % SPEAKER_COLORS.length];
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: `${left}%` as any,
                width: `${width}%` as any,
                top: 4,
                height: 40,
                backgroundColor: color,
                borderRadius: 3,
                opacity: 0.85,
              }}
            />
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>0:00.0</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{formatTime(duration)}</Text>
      </View>

      {/* Legend */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {Array.from(new Set(segments.map(s => s.speaker))).sort().map(spk => (
          <View key={spk} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: SPEAKER_COLORS[spk % SPEAKER_COLORS.length] }} />
            <Text variant="bodySmall" style={{ color: theme.colors.onSurface }}>Speaker {spk}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function SegmentList({ segments }: { segments: DiarizationSegment[] }) {
  const theme = useTheme();
  if (segments.length === 0) return null;
  return (
    <View style={{ marginTop: 12 }}>
      <Text variant="labelMedium" style={{ marginBottom: 8, color: theme.colors.onSurface }}>Segments</Text>
      {segments.map((seg, i) => {
        const color = SPEAKER_COLORS[seg.speaker % SPEAKER_COLORS.length];
        return (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 6,
              paddingHorizontal: 10,
              backgroundColor: theme.colors.surfaceVariant,
              borderRadius: 6,
              marginBottom: 4,
              borderLeftWidth: 4,
              borderLeftColor: color,
            }}
          >
            <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.onSurface, fontVariant: ['tabular-nums'] as any }}>
              {formatTime(seg.start)} – {formatTime(seg.end)}
            </Text>
            <Text variant="bodySmall" style={{ color }}>Speaker {seg.speaker}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function DiarizationScreen() {
  const theme = useTheme();
  const [customAudioPath, setCustomAudioPath] = useState('');
  const {
    initialized,
    loading,
    processing,
    error,
    statusMessage,
    selectedSegModelId,
    selectedEmbModelId,
    numClusters,
    threshold,
    numThreads,
    segments,
    numSpeakers,
    processingDurationMs,
    loadedAudioFiles,
    selectedAudio,
    segModels,
    embModels,
    setSelectedSegModelId,
    setSelectedEmbModelId,
    setNumClusters,
    setThreshold,
    setNumThreads,
    handleInit,
    handleRelease,
    handleSelectAudio,
    handleProcessFile,
  } = useDiarization();

  const totalDuration = useMemo(() => {
    if (segments.length === 0) return 0;
    return Math.max(...segments.map(s => s.end));
  }, [segments]);

  return (
    <PageContainer>
      <LoadingOverlay visible={loading} message={statusMessage || 'Loading...'} />
      <StatusBlock status={!error && !loading ? statusMessage : null} error={error} />

      {/* Step 1: Segmentation Model */}
      <Section title="1. Segmentation Model">
        {segModels.length === 0 ? (
          <InlineModelDownloader
            modelType="diarization-segmentation"
            emptyLabel="No segmentation models downloaded. Download the Pyannote model (~1.5 MB)."
            onModelDownloaded={(modelId) => setSelectedSegModelId(modelId)}
          />
        ) : (
          <ModelSelector
            models={segModels}
            selectedId={selectedSegModelId}
            onSelect={(id) => { if (!initialized) setSelectedSegModelId(id); }}
          />
        )}
      </Section>

      {/* Step 2: Embedding Model (from speaker-id catalog) */}
      <Section title="2. Speaker Embedding Model">
        {embModels.length === 0 ? (
          <InlineModelDownloader
            modelType="speaker-id"
            emptyLabel="No embedding models downloaded. Download a campplus speaker-id model (~10 MB)."
            onModelDownloaded={(modelId) => setSelectedEmbModelId(modelId)}
          />
        ) : (
          <ModelSelector
            models={embModels}
            selectedId={selectedEmbModelId}
            onSelect={(id) => { if (!initialized) setSelectedEmbModelId(id); }}
          />
        )}
      </Section>

      {/* Configuration */}
      <Section title="3. Configuration">
        {/* Threads: hidden on web — WASM is single-threaded (no pthread support) */}
        {Platform.OS !== 'web' && (
          <ConfigRow label="Threads:">
            <TextInput
              style={{ padding: 8, borderWidth: 1, borderColor: theme.colors.outlineVariant, borderRadius: theme.roundness, color: theme.colors.onSurface, minWidth: 60 }}
              keyboardType="numeric"
              value={numThreads.toString()}
              onChangeText={(v) => { const n = parseInt(v); if (!isNaN(n) && n > 0) setNumThreads(n); }}
              editable={!initialized}
            />
          </ConfigRow>
        )}

        <ConfigRow label="Num Speakers (-1 = auto):">
          <TextInput
            style={{ padding: 8, borderWidth: 1, borderColor: theme.colors.outlineVariant, borderRadius: theme.roundness, color: theme.colors.onSurface, minWidth: 60 }}
            keyboardType="numeric"
            value={numClusters.toString()}
            onChangeText={(v) => { const n = parseInt(v); if (!isNaN(n)) setNumClusters(n); }}
          />
        </ConfigRow>

        <ConfigRow label="Cluster Threshold:">
          <TextInput
            style={{ padding: 8, borderWidth: 1, borderColor: theme.colors.outlineVariant, borderRadius: theme.roundness, color: theme.colors.onSurface, minWidth: 60 }}
            keyboardType="decimal-pad"
            value={threshold.toString()}
            onChangeText={(v) => { const f = parseFloat(v); if (!isNaN(f) && f > 0 && f <= 1) setThreshold(f); }}
          />
        </ConfigRow>
      </Section>

      {/* Init/Release */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.margin.m }}>
        {loading ? (
          <Text variant="bodySmall" style={{ color: theme.colors.primary }}>Initializing...</Text>
        ) : initialized ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.success ?? '#4CAF50' }} />
            <Text variant="bodySmall" style={{ color: theme.colors.success ?? '#4CAF50' }}>Ready</Text>
          </View>
        ) : (
          <ThemedButton
            testID="diar-init-btn"
            label="Initialize"
            variant="primary"
            onPress={handleInit}
            disabled={!selectedSegModelId || !selectedEmbModelId}
          />
        )}
        {initialized && (
          <ThemedButton testID="diar-release-btn" label="Release" variant="secondary" onPress={handleRelease} compact />
        )}
      </View>

      {/* Audio Selection */}
      {initialized && (
        <>
          <Section title="4. Select Audio File">
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
              Works best with multi-speaker audio. Single-speaker files will show one speaker segment.
            </Text>
            <View style={{ gap: 8 }}>
              {loadedAudioFiles.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  testID={`diar-audio-${item.id}`}
                  style={{
                    padding: 12,
                    borderRadius: theme.roundness,
                    backgroundColor: selectedAudio?.id === item.id ? theme.colors.primary : theme.colors.surfaceVariant,
                  }}
                  onPress={() => handleSelectAudio(item)}
                  disabled={processing}
                >
                  <Text
                    variant="bodyMedium"
                    style={{ fontWeight: '500', color: selectedAudio?.id === item.id ? theme.colors.onPrimary : theme.colors.onSurface }}
                  >
                    {item.name}
                  </Text>
                  {item.description && (
                    <Text
                      variant="bodySmall"
                      style={{ marginTop: 4, color: selectedAudio?.id === item.id ? theme.colors.onPrimary : theme.colors.onSurfaceVariant }}
                    >
                      {item.description}
                      {item.expectedSpeakers ? ` Expected speakers: ${item.expectedSpeakers}.` : ''}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {selectedAudio && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <AudioPlayButton uri={selectedAudio.localUri} compact />
                <ThemedButton
                  testID="diar-run-btn"
                  label={processing ? 'Processing...' : 'Run Diarization'}
                  variant="primary"
                  onPress={() => { logger.info(`action: run diarization on "${selectedAudio.name}"`); handleProcessFile(selectedAudio); }}
                  disabled={processing}
                  style={{ flex: 1 }}
                />
              </View>
            )}

            <View style={{ marginTop: 16, gap: 8 }}>
              <Text variant="labelMedium" style={{ color: theme.colors.onSurface }}>
                Custom validation file
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Use this for copied device files, such as the 5-minute WAV fixture generated from the long Opus recording.
              </Text>
              <TextInput
                testID="diar-custom-audio-input"
                style={{ padding: 8, borderWidth: 1, borderColor: theme.colors.outlineVariant, borderRadius: theme.roundness, color: theme.colors.onSurface }}
                placeholder="file:///.../perps_controller_refactor_5m_16k_mono.wav"
                placeholderTextColor={theme.colors.onSurfaceVariant}
                value={customAudioPath}
                onChangeText={setCustomAudioPath}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <ThemedButton
                testID="diar-use-custom-audio-btn"
                label="Use Custom File"
                variant="secondary"
                onPress={() => {
                  const trimmedPath = customAudioPath.trim();
                  if (!trimmedPath) return;
                  handleSelectAudio({
                    id: 'custom-validation-file',
                    name: 'Custom validation file',
                    description: trimmedPath,
                    localUri: trimmedPath,
                  });
                }}
                disabled={processing || customAudioPath.trim().length === 0}
              />
            </View>
          </Section>

          {/* Results */}
          {(processing || segments.length > 0) && (
            <Section title="Results">
              {processing ? (
                <View style={{ alignItems: 'center', padding: 20 }}>
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                  <Text variant="bodyMedium" style={{ marginTop: 10, color: theme.colors.onSurface }}>
                    Running diarization...
                  </Text>
                </View>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', gap: 16, marginBottom: 8 }}>
                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
                      Speakers: <Text variant="titleSmall" style={{ color: theme.colors.primary }}>{numSpeakers}</Text>
                    </Text>
                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
                      Segments: <Text variant="titleSmall" style={{ color: theme.colors.primary }}>{segments.length}</Text>
                    </Text>
                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurface }}>
                      Time: <Text variant="titleSmall" style={{ color: theme.colors.primary }}>{processingDurationMs}ms</Text>
                    </Text>
                  </View>

                  <SpeakerTimeline segments={segments} totalDuration={totalDuration} />
                  <SegmentList segments={segments} />
                </>
              )}
            </Section>
          )}
        </>
      )}
    </PageContainer>
  );
}
