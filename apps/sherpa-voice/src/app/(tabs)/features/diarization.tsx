import {
  ASR,
  LiveAttributedTranscriptionSession,
  LiveSpeakerTurnSession,
  SpeakerId,
  VAD,
  type DiarizationSegment,
  type LiveAttributedTranscriptionEvent,
  type LiveTranscriptSegment,
} from '@siteed/sherpa-onnx.rn';
import React, { useEffect, useMemo, useState } from 'react';
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
import { useDiarization, type DiarizationAudioFile } from '../../../hooks/useDiarization';
import { useModels } from '../../../hooks/useModelWithConfig';
import { getAsrModelConfigById } from '../../../hooks/useModelConfig';
import { useModelManagement } from '../../../contexts/ModelManagement';
import { DEFAULT_LIVE_SAMPLE_RATE, DEFAULT_NUM_THREADS } from '../../../utils/constants';
import { resolveModelDir } from '../../../utils/fileUtils';
import { readMonoPcm16Wav } from '../../../utils/wav';
import { initializeLiveTranscriptionDiarizationModels } from '../../../utils/liveTranscriptionDiarization';
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
              key={`${seg.speaker}-${seg.start}-${seg.end}`}
              style={{
                position: 'absolute',
                left: `${left}%`,
                width: `${width}%`,
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
            key={`${seg.speaker}-${seg.start}-${seg.end}`}
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
            <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.onSurface, fontVariant: ['tabular-nums'] }}>
              {formatTime(seg.start)} – {formatTime(seg.end)}
            </Text>
            <Text variant="bodySmall" style={{ color }}>Speaker {seg.speaker}</Text>
          </View>
        );
      })}
    </View>
  );
}

type LiveReplayResult = {
  audioDurationMs: number;
  replayMs: number;
  realtimeFactor: number;
  keepsUp: boolean;
  summary: ReturnType<LiveAttributedTranscriptionSession['getSummary']>;
  eventCounts: Record<string, number>;
  segments: LiveTranscriptSegment[];
};

function LiveValidationSection({
  selectedAudio,
  selectedEmbModelId,
  disabled,
}: {
  selectedAudio: DiarizationAudioFile | null;
  selectedEmbModelId: string | null;
  disabled: boolean;
}) {
  const theme = useTheme();
  const { downloadedModels: asrModels } = useModels({ modelType: 'asr' });
  const { downloadedModels: vadModels } = useModels({ modelType: 'vad' });
  const { getModelState } = useModelManagement();
  const [selectedAsrModelId, setSelectedAsrModelId] = useState<string | null>(null);
  const [selectedVadModelId, setSelectedVadModelId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LiveReplayResult | null>(null);
  const [liveAudioPath, setLiveAudioPath] = useState('');

  const streamingAsrModels = useMemo(
    () => asrModels.filter((model) => getAsrModelConfigById(model.metadata.id)?.streaming),
    [asrModels]
  );

  useEffect(() => {
    if (!selectedAsrModelId && streamingAsrModels.length > 0) {
      const preferred = streamingAsrModels.find(
        (model) => model.metadata.id === 'streaming-zipformer-en-20m-mobile'
      );
      setSelectedAsrModelId((preferred ?? streamingAsrModels[0]).metadata.id);
    }
  }, [selectedAsrModelId, streamingAsrModels]);

  useEffect(() => {
    if (!selectedVadModelId && vadModels.length > 0) {
      const preferred = vadModels.find((model) => model.metadata.id === 'silero-vad-v5');
      setSelectedVadModelId((preferred ?? vadModels[0]).metadata.id);
    }
  }, [selectedVadModelId, vadModels]);

  if (Platform.OS === 'web') {
    return (
      <Section title="Live Transcription + Speaker Turns">
        <StatusBlock status="Live replay validation requires the native iOS or Android app." />
      </Section>
    );
  }

  const handleRunLiveReplay = async () => {
    const effectiveAudioPath = liveAudioPath.trim() || selectedAudio?.localUri;
    if (!effectiveAudioPath) {
      setError('Select an audio file or enter a WAV path first');
      return;
    }
    if (!selectedAsrModelId || !selectedVadModelId || !selectedEmbModelId) {
      setError('Download/select streaming ASR, VAD, and speaker-id models first');
      return;
    }

    setRunning(true);
    setError(null);
    setResult(null);
    setStatus('Preparing live replay...');
    let session: LiveAttributedTranscriptionSession | null = null;

    try {
      const asrState = getModelState(selectedAsrModelId);
      const vadState = getModelState(selectedVadModelId);
      const speakerState = getModelState(selectedEmbModelId);
      if (!asrState?.localPath) throw new Error(`ASR model ${selectedAsrModelId} is not downloaded`);
      if (!vadState?.localPath) throw new Error(`VAD model ${selectedVadModelId} is not downloaded`);
      if (!speakerState?.localPath) throw new Error(`Speaker model ${selectedEmbModelId} is not downloaded`);

      setStatus('Reading WAV fixture...');
      const wav = await readMonoPcm16Wav(effectiveAudioPath);
      if (wav.sampleRate !== DEFAULT_LIVE_SAMPLE_RATE) {
        throw new Error(`Expected ${DEFAULT_LIVE_SAMPLE_RATE} Hz mono PCM WAV, got ${wav.sampleRate} Hz`);
      }
      const maxReplayMs = 60_000;
      const samples = wav.samples.slice(0, Math.floor((maxReplayMs / 1000) * wav.sampleRate));
      const audioDurationMs = (samples.length / wav.sampleRate) * 1000;
      const chunkDurationMs = 100;
      const chunkSize = Math.round((chunkDurationMs / 1000) * wav.sampleRate);

      setStatus('Initializing ASR, VAD, and Speaker ID...');
      await initializeLiveTranscriptionDiarizationModels({
        asrModelId: selectedAsrModelId,
        vadModelId: selectedVadModelId,
        speakerIdModelId: selectedEmbModelId,
        asrModelDir: await resolveModelDir(asrState.localPath),
        vadModelDir: await resolveModelDir(vadState.localPath),
        speakerModelDir: await resolveModelDir(speakerState.localPath),
        numThreads: DEFAULT_NUM_THREADS,
      });

      const eventCounts: Record<string, number> = {};
      session = new LiveAttributedTranscriptionSession({
        sampleRate: wav.sampleRate,
        speakerTurns: new LiveSpeakerTurnSession({
          sampleRate: wav.sampleRate,
          vad: VAD,
          speakerId: SpeakerId,
          minTurnDurationMs: 250,
          speechPadMs: 120,
          speakerThreshold: 0.55,
          maxRingBufferDurationMs: 90_000,
        }),
        asr: ASR,
        onEvent: (event: LiveAttributedTranscriptionEvent) => {
          eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
        },
      });

      setStatus(`Replaying ${(audioDurationMs / 1000).toFixed(1)}s as ${chunkDurationMs}ms chunks...`);
      const startedAt = Date.now();
      for (let offset = 0; offset < samples.length; offset += chunkSize) {
        const chunk = samples.slice(offset, Math.min(offset + chunkSize, samples.length));
        await session.acceptChunk({ samples: chunk, sampleRate: wav.sampleRate, startSample: offset });
        if (offset > 0 && offset % (chunkSize * 10) === 0) {
          setStatus(`Live replay ${(offset / wav.sampleRate).toFixed(1)}s / ${(audioDurationMs / 1000).toFixed(1)}s`);
        }
      }
      await session.flush();
      const replayMs = Date.now() - startedAt;
      const realtimeFactor = replayMs / Math.max(audioDurationMs, 1);
      const state = session.getState();
      setResult({
        audioDurationMs,
        replayMs,
        realtimeFactor,
        keepsUp: realtimeFactor <= 1,
        summary: session.getSummary(),
        eventCounts,
        segments: state.segments.slice(0, 20),
      });
      setStatus(`Live replay complete: ${realtimeFactor.toFixed(2)}x realtime`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('');
    } finally {
      session?.release();
      await Promise.all([
        ASR.release().catch(() => {}),
        VAD.release().catch(() => {}),
        SpeakerId.release().catch(() => {}),
      ]);
      setRunning(false);
    }
  };

  return (
    <Section title="Live validation: transcription + speaker turns">
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
        Replays the selected WAV as 100ms live chunks through streaming ASR, VAD, and Speaker ID. This validates whether processing keeps up with realtime on device.
      </Text>
      <ConfigRow label="Streaming ASR:">
        {streamingAsrModels.length === 0 ? (
          <InlineModelDownloader
            modelType="asr"
            emptyLabel="Download a streaming ASR model first."
            onModelDownloaded={setSelectedAsrModelId}
          />
        ) : (
          <ModelSelector
            models={streamingAsrModels}
            selectedId={selectedAsrModelId}
            onSelect={setSelectedAsrModelId}
          />
        )}
      </ConfigRow>
      <ConfigRow label="VAD:">
        {vadModels.length === 0 ? (
          <InlineModelDownloader
            modelType="vad"
            emptyLabel="Download Silero VAD first."
            onModelDownloaded={setSelectedVadModelId}
          />
        ) : (
          <ModelSelector
            models={vadModels}
            selectedId={selectedVadModelId}
            onSelect={setSelectedVadModelId}
          />
        )}
      </ConfigRow>
      <TextInput
        testID="diar-live-audio-input"
        style={{ marginBottom: 8, padding: 8, borderWidth: 1, borderColor: theme.colors.outlineVariant, borderRadius: theme.roundness, color: theme.colors.onSurface }}
        placeholder="Optional file:///.../validation.wav (uses selected audio when blank)"
        placeholderTextColor={theme.colors.onSurfaceVariant}
        value={liveAudioPath}
        onChangeText={setLiveAudioPath}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <ThemedButton
        testID="diar-live-replay-btn"
        label={running ? 'Running live replay...' : 'Run Live Replay'}
        variant="primary"
        onPress={handleRunLiveReplay}
        disabled={disabled || running || (!selectedAudio && liveAudioPath.trim().length === 0) || !selectedAsrModelId || !selectedVadModelId || !selectedEmbModelId}
      />
      {status ? (
        <Text variant="bodySmall" style={{ marginTop: 8, color: theme.colors.primary }}>{status}</Text>
      ) : null}
      {error ? (
        <Text variant="bodySmall" style={{ marginTop: 8, color: theme.colors.error }}>{error}</Text>
      ) : null}
      {result ? (
        <View style={{ marginTop: 12, gap: 6 }}>
          <Text variant="bodyMedium" style={{ color: result.keepsUp ? theme.colors.primary : theme.colors.error }}>
            {result.keepsUp ? 'Keeps up' : 'Too slow'}: {result.realtimeFactor.toFixed(2)}x realtime ({result.replayMs}ms for {(result.audioDurationMs / 1000).toFixed(1)}s audio)
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurface }}>
            Segments: {result.summary.segmentCount} · Final: {result.summary.finalSegmentCount} · Speaker-attributed: {result.summary.speakerAttributedSegmentCount}
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Events: {Object.entries(result.eventCounts).map(([key, value]) => `${key}=${value}`).join(', ')}
          </Text>
          {result.segments.slice(0, 5).map((segment) => (
            <Text key={segment.segmentId} variant="bodySmall" style={{ color: theme.colors.onSurface }}>
              {segment.speakerId ?? 'speaker_pending'} · {segment.text || '(empty)'}
            </Text>
          ))}
        </View>
      ) : null}
    </Section>
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
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary }} />
            <Text variant="bodySmall" style={{ color: theme.colors.primary }}>Ready</Text>
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

      <LiveValidationSection
        selectedAudio={selectedAudio}
        selectedEmbModelId={selectedEmbModelId}
        disabled={processing || loading}
      />

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
