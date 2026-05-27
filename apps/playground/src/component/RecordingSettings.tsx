import React, { useState, useMemo } from 'react'

import { StyleSheet, View, Platform } from 'react-native'
import { SegmentedButtons } from 'react-native-paper'

import type { AppTheme } from '@siteed/design-system'
import { Text, useTheme, LabelSwitch, EditableInfoCard } from '@siteed/design-system'
import type {
  RecordingConfig,
  SampleRate,
  AudioDevice,
  NotificationConfig,
  DeviceDisconnectionBehaviorType,
} from '@siteed/audio-studio'

import { AndroidSettingsConfig } from './AndroidSettingsConfig'
import { DeviceValidationManager } from './DeviceValidationManager'
import { IOSSettingsConfig } from './IOSSettingsConfig'
import { NativeNotificationConfig } from './NativeNotificationConfig'
import { SegmentDurationSelector } from './SegmentDurationSelector'
import { WhisperSampleRate } from '../config'
import { isWeb } from '../utils/utils'

import type { SegmentDuration } from './SegmentDurationSelector'

// Import WhisperSampleRate from config

const DEFAULT_BITRATE = Platform.OS === 'ios' ? 32000 : 24000
const MAX_DURATION_OPTIONS = [
  { value: '0', label: 'Off' },
  { value: '10000', label: '10s' },
  { value: '30000', label: '30s' },
  { value: '60000', label: '1m' },
  { value: '300000', label: '5m' },
]

const getStyles = (_theme: AppTheme) => StyleSheet.create({
  container: {
    gap: 16,
  },
})

interface RecordingSettingsProps {
  config: RecordingConfig;
  onConfigChange: (config: RecordingConfig) => void;
  customFileName: string;
  onCustomFileNameChange: (name: string) => void;
  isRecording: boolean;
  isPaused: boolean;
  isRecordingPrepared?: boolean; // Make optional
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  enableLiveTranscription: boolean;
  // Add state for visualization display
  showVisualization: boolean;
  onShowVisualizationChange: (show: boolean) => void;
  // Add current device as a prop
  currentDevice?: AudioDevice | null;
  // Add prop to hide the filename input when already shown in parent
  hideFilenameInput?: boolean;
}

export function RecordingSettings({
  config,
  onConfigChange,
  customFileName,
  onCustomFileNameChange,
  isRecording,
  isPaused,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  enableLiveTranscription,
  // Add props for visualization display
  showVisualization,
  onShowVisualizationChange,
  // Add currentDevice prop
  currentDevice,
  // Add the new prop with default value
  hideFilenameInput = false,
}: RecordingSettingsProps) {
  const theme = useTheme()
  const styles = useMemo(() => getStyles(theme), [theme])

  const [notificationEnabled, setNotificationEnabled] = useState(
    config.showNotification ?? true
  )
  const [notificationConfig, setNotificationConfig] = useState<NotificationConfig>(
    config.notification || {
      title: 'Recording in progress',
      text: '',
      android: {
        notificationId: 1,
        channelId: 'audio_recording_channel',
        channelName: 'Audio Recording',
        channelDescription: 'Shows audio recording status',
      },
    }
  )
  const [iosSettingsEnabled, setIOSSettingsEnabled] = useState(false)
  const [iosSettings, setIOSSettings] = useState<RecordingConfig['ios']>(
    config.ios
  )
  const [androidSettingsEnabled, setAndroidSettingsEnabled] = useState(!!config.android?.audioFocusStrategy)
  const [androidSettings, setAndroidSettings] = useState<RecordingConfig['android']>(
    config.android
  )

  const handleConfigUpdate = (updates: Partial<RecordingConfig>) => {
    const updatedConfig = {
      ...config,
      ...updates,
    }
    onConfigChange(updatedConfig)
  }

  const isDisabled = isRecording || isPaused

  return (
    <View style={styles.container}>
      {/* Only render filename input if not hidden */}
      {!hideFilenameInput && (
        <EditableInfoCard
          testID="filename-input"
          label="File Name"
          value={customFileName}
          placeholder="pick a filename for your recording"
          inlineEditable
          editable={!isDisabled}
          containerStyle={{
            backgroundColor: theme.colors.secondaryContainer,
          }}
          onInlineEdit={(newFileName) => {
            if (typeof newFileName === 'string') {
              onCustomFileNameChange(newFileName)
            }
          }}
        />
      )}

      {currentDevice && (
        <DeviceValidationManager
          device={currentDevice}
          recordingConfig={config}
          sampleRateForTranscription={WhisperSampleRate}
          enableLiveTranscription={enableLiveTranscription}
          onUpdateConfig={handleConfigUpdate}
        />
      )}

      <View>
        <Text variant="titleMedium" style={{ marginBottom: 8 }}>Sample Rate</Text>
        <SegmentedButtons
          value={String(config.sampleRate || WhisperSampleRate)}
          onValueChange={(value) => {
            const updatedConfig = {
              ...config,
              sampleRate: parseInt(value, 10) as SampleRate,
            }
            onConfigChange(updatedConfig)
          }}
          buttons={[
            { value: '16000', label: '16 kHz' },
            { value: '44100', label: '44.1 kHz' },
            { value: '48000', label: '48 kHz' },
          ]}
        />
      </View>

      <View
        style={{
          backgroundColor: theme.colors.surfaceVariant,
          borderRadius: 8,
          padding: 12,
          marginVertical: 8,
        }}
      >
        <Text variant="titleMedium" style={{ marginBottom: 12 }}>Output Configuration</Text>

        <LabelSwitch
          label="Primary Output (WAV)"
          value={config.output?.primary?.enabled ?? true}
          onValueChange={(enabled) => {
            const updatedConfig = {
              ...config,
              output: {
                ...config.output,
                primary: {
                  ...config.output?.primary,
                  enabled,
                },
              },
            }
            onConfigChange(updatedConfig)
          }}
          disabled={isDisabled}
        />

        <Text variant="bodySmall" style={{ marginTop: 4, marginBottom: 12, color: theme.colors.outline }}>
          Creates uncompressed WAV file. Disable for streaming-only or compressed-only recording.
        </Text>

        <LabelSwitch
          label="Compressed Output"
          value={config.output?.compressed?.enabled ?? false}
          onValueChange={(enabled) => {
            const updatedConfig = {
              ...config,
              output: {
                ...config.output,
                compressed: {
                  ...config.output?.compressed,
                  enabled,
                  format: config.output?.compressed?.format || (Platform.OS === 'ios' ? 'aac' : 'opus'),
                  bitrate: config.output?.compressed?.bitrate || DEFAULT_BITRATE,
                },
              },
            }
            onConfigChange(updatedConfig)
          }}
          disabled={isDisabled}
        />

        {config.output?.compressed?.enabled && (
          <View style={{ marginLeft: 12, marginTop: 8 }}>
            <View>
              <Text variant="titleSmall" style={{ marginBottom: 8 }}>Format</Text>
              {Platform.OS === 'ios' ? (
                <>
                  <Text>AAC</Text>
                  <Text variant="bodySmall" style={{ marginTop: 4, color: theme.colors.outline }}>
                    Only AAC format is supported on iOS devices. Opus will automatically fall back to AAC.
                  </Text>
                </>
              ) : isWeb ? (
                <>
                  <Text>OPUS</Text>
                  <Text variant="bodySmall" style={{ marginTop: 4, color: theme.colors.outline }}>
                    Only Opus format is supported on web. AAC is not available in browsers.
                  </Text>
                </>
              ) : (
                <SegmentedButtons
                  value={config.output?.compressed?.format || 'opus'}
                  onValueChange={(value) => {
                    const updatedConfig = {
                      ...config,
                      output: {
                        ...config.output,
                        compressed: {
                          ...config.output?.compressed,
                          enabled: true,
                          format: value as 'aac' | 'opus',
                        },
                      },
                    }
                    onConfigChange(updatedConfig)
                  }}
                  buttons={[
                    { value: 'opus', label: 'OPUS' },
                    ...(!isWeb ? [{ value: 'aac', label: 'AAC' }] : []),
                  ]}
                />
              )}
            </View>

            <View style={{ marginTop: 12 }}>
              <Text variant="titleSmall" style={{ marginBottom: 8 }}>Bitrate</Text>
              <SegmentedButtons
                value={String(config.output?.compressed?.bitrate || DEFAULT_BITRATE)}
                onValueChange={(value) => {
                  const updatedConfig = {
                    ...config,
                    output: {
                      ...config.output,
                      compressed: {
                        ...config.output?.compressed,
                        enabled: true,
                        bitrate: parseInt(value, 10),
                      },
                    },
                  }
                  onConfigChange(updatedConfig)
                }}
                buttons={[
                  { value: '32000', label: '32 kbps (Voice)' },
                  { value: '64000', label: '64 kbps (Studio)' },
                  { value: '128000', label: '128 kbps (High)' },
                ]}
              />
            </View>

            <Text variant="bodySmall" style={{ marginTop: 12, color: theme.colors.outline }}>
              Compression reduces file size but may affect audio quality. Higher bitrates preserve more detail.
            </Text>
          </View>
        )}

        {/* Show warning if both outputs are disabled */}
        {!config.output?.primary?.enabled && !config.output?.compressed?.enabled && (
          <View style={{
            backgroundColor: theme.colors.errorContainer,
            borderRadius: 4,
            padding: 8,
            marginTop: 8,
          }}>
            <Text variant="bodySmall" style={{ color: theme.colors.onErrorContainer }}>
              ⚠️ Streaming-only mode: No files will be created. Audio data will only be available through events.
            </Text>
          </View>
        )}
      </View>

      <SegmentDurationSelector
        testID="segment-duration-selector"
        value={(config.segmentDurationMs ?? 100) as SegmentDuration}
        onChange={(duration) => {
          const updatedConfig = {
            ...config,
            segmentDurationMs: duration,
          }
          onConfigChange(updatedConfig)
        }}
        maxDurationMs={1000}
        skipConfirmation
      />

      <View
        style={{
          backgroundColor: theme.colors.surfaceVariant,
          borderRadius: 8,
          padding: 12,
          marginVertical: 8,
        }}
      >
        <Text variant="titleMedium" style={{ marginBottom: 12 }}>Max Duration</Text>
        <View testID="record-max-duration-selector">
          <SegmentedButtons
            value={String(config.maxDurationMs ?? 0)}
            onValueChange={(value) => {
              const maxDurationMs = parseInt(value, 10)
              handleConfigUpdate({
                maxDurationMs: maxDurationMs > 0 ? maxDurationMs : undefined,
                autoStopOnMaxDuration:
                  maxDurationMs > 0 ? config.autoStopOnMaxDuration : false,
              })
            }}
            buttons={MAX_DURATION_OPTIONS.map((option) => ({
              ...option,
              disabled: isDisabled,
            }))}
          />
        </View>
        <LabelSwitch
          testID="record-auto-stop-max-duration"
          label="Auto-stop at limit"
          value={!!config.autoStopOnMaxDuration}
          onValueChange={(enabled) => {
            handleConfigUpdate({
              autoStopOnMaxDuration: enabled,
            })
          }}
          disabled={isDisabled || !(config.maxDurationMs && config.maxDurationMs > 0)}
        />
      </View>

      <LabelSwitch
        label="Keep Recording in Background"
        value={config.keepAwake ?? true}
        onValueChange={(enabled) => {
          const updatedConfig = {
            ...config,
            keepAwake: enabled,
          }
          onConfigChange(updatedConfig)
        }}
        disabled={isDisabled}
      />



      {Platform.OS !== 'web' && (
        <NativeNotificationConfig
          enabled={notificationEnabled}
          onEnabledChange={(enabled) => {
            setNotificationEnabled(enabled)
            onConfigChange({ ...config, showNotification: enabled })
          }}
          config={notificationConfig}
          onConfigChange={(newNotificationConfig) => {
            setNotificationConfig(newNotificationConfig)
            onConfigChange({ ...config, notification: newNotificationConfig })
          }}
        />
      )}

      {Platform.OS === 'ios' && (
        <>
          <LabelSwitch
            label="Custom iOS Audio Settings"
            value={iosSettingsEnabled}
            onValueChange={setIOSSettingsEnabled}
            disabled={isDisabled}
          />
          {iosSettingsEnabled && (
            <IOSSettingsConfig
              config={iosSettings}
              onConfigChange={(newConfig) => {
                setIOSSettings(newConfig)
                onConfigChange({ ...config, ios: newConfig })
              }}
            />
          )}
        </>
      )}

      {Platform.OS === 'android' && (
        <>
          <LabelSwitch
            label="Android Audio Focus Strategy"
            value={androidSettingsEnabled}
            onValueChange={setAndroidSettingsEnabled}
            disabled={isDisabled}
          />
          {androidSettingsEnabled && (
            <AndroidSettingsConfig
              config={androidSettings}
              onConfigChange={(newConfig) => {
                setAndroidSettings(newConfig)
                onConfigChange({ ...config, android: newConfig })
              }}
            />
          )}
        </>
      )}

      <View>
        <Text variant="titleMedium" style={{ marginBottom: 8 }}>Device Disconnection Behavior</Text>
        <SegmentedButtons
          value={config.deviceDisconnectionBehavior || 'fallback'}
          onValueChange={(value) => {
            const updatedConfig = {
              ...config,
              deviceDisconnectionBehavior: value as DeviceDisconnectionBehaviorType,
            }
            onConfigChange(updatedConfig)
          }}
          buttons={[
            { value: 'fallback', label: 'Fallback to Default', disabled: isDisabled },
            { value: 'pause', label: 'Pause Recording', disabled: isDisabled },
          ]}
        />
      </View>

      {/* Switch for enabling/disabling audio processing (data generation) */}
      <LabelSwitch
        label="Enable Audio Processing"
        value={config.enableProcessing ?? false} // Default to false if undefined
        onValueChange={(enabled) => {
          const updatedConfig = {
            ...config,
            enableProcessing: enabled,
          }
          onConfigChange(updatedConfig)
        }}
        disabled={isDisabled}
      />

      {/* Switch for showing/hiding the visualization UI */}
      <LabelSwitch
        label="Show Visualization"
        value={showVisualization}
        onValueChange={onShowVisualizationChange}
        disabled={isDisabled || !(config.enableProcessing ?? false)} // Disable if recording/paused, or if processing is off
      />
    </View>
  )
}
