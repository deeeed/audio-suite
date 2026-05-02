import { useRouter } from 'expo-router';
import React from 'react';
import {
  FlatList,
  Platform,
  Switch,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAsr, GREEDY_ONLY_TYPES, SAMPLE_AUDIO_FILES, type AsrMode } from '../../../hooks/useAsr';
import { formatDuration, formatBytes } from '../../../utils/formatters';
import { InlineModelDownloader } from '../../../components/InlineModelDownloader';
import {
  AudioPlayButton,
  LoadingOverlay,
  PageContainer,
  ResultsBox,
  Section,
  StatusBlock,
  Text,
  ThemedButton,
  useTheme,
} from '../../../components/ui';
import { baseLogger } from '../../../config';

const logger = baseLogger.extend('ASRScreen');

function getModelBadge(modelId: string): { label: string; color: string } {
  if (modelId.startsWith('streaming-')) return { label: 'Streaming', color: '#4CAF50' };
  return { label: 'Offline', color: '#9C27B0' };
}

export default function AsrScreen() {
  const theme = useTheme();
  const router = useRouter();

  const {
    mode,
    selectedModelId,
    initialized,
    loading,
    error,
    statusMessage,
    processing,
    recognitionResult,
    loadedAudioFiles,
    selectedAudio,
    audioMetadata,
    numThreads,
    decodingMethod,
    maxActivePaths,
    debugMode,
    provider,
    fileProcessing,
    statusLog,
    downloadedModels,
    visibleModels,
    asrConfig,
    recorder,
    liveAsr,
    setNumThreads,
    setDecodingMethod,
    setDebugMode,
    setProvider,
    handleInitAsr,
    handleReleaseAsr,
    handleModelSelect,
    handleSetMode,
    handleSelectAudio,
    handleRecognizeFromFile,
    handleStartMic,
    handleStopMic,
    handleDemoStreaming,
  } = useAsr();

  const modeTabStyle = (tabMode: AsrMode) => ({
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center' as const,
    backgroundColor: mode === tabMode ? theme.colors.primary : theme.colors.surfaceVariant,
    borderRadius: theme.roundness,
  });

  return (
    <PageContainer>
      <LoadingOverlay
        visible={loading}
        message="Initializing ASR..."
        subMessage={statusMessage}
      />

      {/* Mode Toggle */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: theme.margin.m }}>
        <TouchableOpacity style={modeTabStyle('file')} onPress={() => { logger.info('action: mode changed to file'); handleSetMode('file'); }}>
          <Text variant="labelLarge" style={{ color: mode === 'file' ? theme.colors.onPrimary : theme.colors.onSurface }}>
            File
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={modeTabStyle('live')} onPress={() => { logger.info('action: mode changed to live'); handleSetMode('live'); }}>
          <Text variant="labelLarge" style={{ color: mode === 'live' ? theme.colors.onPrimary : theme.colors.onSurface }}>
            Live Mic
          </Text>
        </TouchableOpacity>
      </View>

      <StatusBlock error={error} />

      {/* Model Selection */}
      <Section title="Select ASR Model">
        {visibleModels.length === 0 ? (
          downloadedModels.length === 0 ? (
            <InlineModelDownloader
              modelType="asr"
              emptyLabel={mode === 'live' ? 'No streaming ASR models downloaded.' : 'No ASR models downloaded.'}
              onModelDownloaded={(modelId) => handleModelSelect(modelId)}
            />
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: theme.padding.m }}>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginBottom: 8 }}>
                No streaming ASR models downloaded.
              </Text>
              <ThemedButton
                label="Download a streaming model"
                variant="primary"
                onPress={() => router.push('/(tabs)/models?type=asr')}
              />
            </View>
          )
        ) : (
          <View testID="model-picker-list">
            {visibleModels.map((model) => {
              const isSelected = selectedModelId === model.metadata.id;
              const badge = getModelBadge(model.metadata.id);
              return (
                <TouchableOpacity
                  key={model.metadata.id}
                  testID={`model-option-${model.metadata.id}`}
                  style={{
                    padding: 12,
                    backgroundColor: isSelected ? theme.colors.primary : theme.colors.surface,
                    borderRadius: theme.roundness * 2,
                    marginBottom: 8,
                    ...Platform.select({
                      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3 },
                      android: { elevation: 2 },
                    }),
                  }}
                  onPress={() => handleModelSelect(model.metadata.id)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text variant="bodyLarge" style={{ flex: 1, color: isSelected ? theme.colors.onPrimary : theme.colors.onSurface }}>
                      {model.metadata.name}
                    </Text>
                    <View style={{
                      paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
                      backgroundColor: isSelected ? 'rgba(255,255,255,0.25)' : badge.color + '22',
                    }}>
                      <Text variant="labelSmall" style={{ color: isSelected ? '#fff' : badge.color, fontWeight: '600' }}>
                        {badge.label}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity onPress={() => router.push('/(tabs)/models?type=asr')} style={{ marginTop: 4, alignItems: 'center' }}>
              <Text variant="bodyMedium" style={{ color: theme.colors.primary }}>Download more models →</Text>
            </TouchableOpacity>
          </View>
        )}
      </Section>

      {/* Config — file mode only, only editable before initialization */}
      {mode === 'file' && selectedModelId && asrConfig && !initialized && (
        <Section title="Configuration">
          {/* Threads: hidden on web — WASM is single-threaded (no pthread support) */}
          {Platform.OS !== 'web' && (
          <View style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface }}>Threads:</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[1, 2, 4, 8].map(n => (
                  <TouchableOpacity
                    key={n}
                    testID={`config-threads-${n}`}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6,
                      backgroundColor: numThreads === n ? theme.colors.primary : theme.colors.surfaceVariant,
                      borderRadius: theme.roundness,
                    }}
                    onPress={() => setNumThreads(n)}
                  >
                    <Text variant="labelMedium" style={{ color: numThreads === n ? theme.colors.onPrimary : theme.colors.onSurface }}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
          )}

          <View style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface }}>Decoding:</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['greedy_search', 'beam_search'] as const).map(method => (
                  <TouchableOpacity
                    key={method}
                    style={{
                      paddingHorizontal: 10, paddingVertical: 6,
                      backgroundColor: decodingMethod === method ? theme.colors.primary : theme.colors.surfaceVariant,
                      borderRadius: theme.roundness,
                      opacity: GREEDY_ONLY_TYPES.includes(asrConfig.modelType || '') && method === 'beam_search' ? 0.4 : 1,
                    }}
                    onPress={() => {
                      if (GREEDY_ONLY_TYPES.includes(asrConfig.modelType || '') && method === 'beam_search') return;
                      setDecodingMethod(method);
                    }}
                  >
                    <Text variant="labelMedium" style={{ color: decodingMethod === method ? theme.colors.onPrimary : theme.colors.onSurface }}>
                      {method === 'greedy_search' ? 'Greedy' : 'Beam'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface }}>Debug:</Text>
            <Switch value={debugMode} onValueChange={setDebugMode} />
          </View>

          {/* Provider: hidden on web — WASM only supports CPU */}
          {Platform.OS !== 'web' && (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="bodyMedium" style={{ flex: 1, color: theme.colors.onSurface }}>Provider:</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['cpu', 'gpu'] as const).map(p => (
                <TouchableOpacity
                  key={p}
                  style={{
                    paddingHorizontal: 16, paddingVertical: 6,
                    backgroundColor: provider === p ? theme.colors.primary : theme.colors.surfaceVariant,
                    borderRadius: theme.roundness,
                  }}
                  onPress={() => setProvider(p)}
                >
                  <Text variant="labelMedium" style={{ color: provider === p ? theme.colors.onPrimary : theme.colors.onSurface }}>
                    {p.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          )}
        </Section>
      )}

      {/* Model Status */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.margin.m }}>
        {loading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="bodySmall" style={{ color: theme.colors.primary }}>Initializing...</Text>
          </View>
        ) : initialized ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.success ?? '#4CAF50' }} />
            <Text variant="bodySmall" style={{ color: theme.colors.success ?? '#4CAF50' }}>Ready</Text>
          </View>
        ) : (
          <ThemedButton
            testID="btn-init-asr"
            label="Initialize"
            variant="primary"
            onPress={handleInitAsr}
            disabled={!selectedModelId}
          />
        )}
        {initialized && (
          <ThemedButton
            testID="btn-release-asr"
            label="Release"
            variant="secondary"
            onPress={handleReleaseAsr}
            compact
          />
        )}
      </View>

      {/* === FILE MODE === */}
      {mode === 'file' && initialized && (
        <>
          <Section title="Select Audio">
            <FlatList
              data={loadedAudioFiles}
              keyExtractor={item => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  testID={`audio-option-${item.id}`}
                  style={{
                    padding: 12, marginRight: 12, borderRadius: theme.roundness * 2,
                    borderWidth: 1,
                    borderColor: selectedAudio?.id === item.id ? theme.colors.primary : theme.colors.outlineVariant,
                    backgroundColor: selectedAudio?.id === item.id ? theme.colors.primaryContainer : 'transparent',
                    minWidth: 130, alignItems: 'center',
                  }}
                  onPress={() => handleSelectAudio(item)}
                >
                  <Text variant="bodyMedium" style={{
                    color: selectedAudio?.id === item.id ? theme.colors.onPrimaryContainer : theme.colors.onSurface,
                    fontWeight: '500', textAlign: 'center',
                  }}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
            />

            {selectedAudio && (
              <ResultsBox>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4 }}>
                  Size: {formatBytes(audioMetadata.size || 0)}
                </Text>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                  Duration: {formatDuration(audioMetadata.duration || 0)}
                </Text>
                <AudioPlayButton uri={selectedAudio.localUri} label="Play Audio" compact />
              </ResultsBox>
            )}
          </Section>

          {selectedAudio && (
            <Section title="Recognize Speech">
              <ThemedButton
                testID="btn-recognize"
                label={processing ? 'Processing...' : 'Recognize Speech'}
                variant="primary"
                onPress={handleRecognizeFromFile}
                disabled={processing}
              />

              {recognitionResult !== null && (
                <View style={{
                  marginTop: theme.margin.m, padding: 12,
                  backgroundColor: theme.colors.primaryContainer ?? '#f0f7ff',
                  borderRadius: theme.roundness * 2,
                  borderLeftWidth: 4, borderLeftColor: theme.colors.primary,
                }}>
                  <Text variant="titleSmall" style={{ marginBottom: 8, color: theme.colors.primary }}>Result:</Text>
                  <Text testID="text-recognition-result" variant="bodyLarge" style={{ color: theme.colors.onSurface, lineHeight: 24 }}>
                    {recognitionResult === '' ? '(no speech detected)' : recognitionResult}
                  </Text>
                </View>
              )}
            </Section>
          )}
        </>
      )}

      {/* === LIVE MODE === */}
      {mode === 'live' && initialized && (
        <>
          <Section title="Microphone">
            {!recorder.isRecording ? (
              <ThemedButton
                label="Start Listening"
                variant="primary"
                onPress={handleStartMic}
              />
            ) : (
              <View>
                <ThemedButton
                  label="Stop Listening"
                  variant="danger"
                  onPress={handleStopMic}
                />
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
                  Recording: {(recorder.durationMs / 1000).toFixed(1)}s
                </Text>
              </View>
            )}
          </Section>

          {(liveAsr.committedText || liveAsr.interimText) && (
            <Section title="Transcript">
              {liveAsr.committedText ? (
                <Text variant="bodyLarge" style={{ color: theme.colors.onSurface, lineHeight: 26, marginBottom: 4 }}>
                  {liveAsr.committedText}
                </Text>
              ) : null}
              {liveAsr.interimText ? (
                <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, fontStyle: 'italic', lineHeight: 26 }}>
                  {liveAsr.interimText}
                </Text>
              ) : null}
              <ThemedButton
                label="Clear"
                variant="primary"
                compact
                onPress={liveAsr.clear}
                style={{ marginTop: 8, alignSelf: 'flex-start' }}
              />
            </Section>
          )}

          {!recorder.isRecording && (
            <Section title="Test with Sample Audio">
              {SAMPLE_AUDIO_FILES.map(audio => (
                <ThemedButton
                  key={audio.id}
                  label={fileProcessing ? 'Processing...' : `Stream: ${audio.name}`}
                  variant="secondary"
                  onPress={() => handleDemoStreaming(audio.module)}
                  disabled={fileProcessing}
                  style={{ marginBottom: 8 }}
                />
              ))}
            </Section>
          )}
        </>
      )}

      {/* Status Log (live mode) */}
      {mode === 'live' && statusLog.length > 0 && (
        <Section title="Log">
          {statusLog.map((log, i) => (
            <Text
              key={i}
              variant="bodySmall"
              style={{
                color: theme.colors.onSurfaceVariant,
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                lineHeight: 18,
              }}
            >
              {log}
            </Text>
          ))}
        </Section>
      )}
    </PageContainer>
  );
}
