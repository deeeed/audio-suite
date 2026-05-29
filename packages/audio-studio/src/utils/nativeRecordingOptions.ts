import { RecordingConfig } from '../AudioStudio.types'
import { cleanNativeOptions } from './cleanNativeOptions'

export function createNativeRecordingOptions(recordingOptions: RecordingConfig) {
    const {
        onAudioStream,
        onRecordingInterrupted,
        onMaxDurationReached,
        onRecordingStopped,
        onAudioAnalysis,
        keepFullAnalysis: _keepFullAnalysis,
        // Keep hook-owned auto-stop out of the native bridge so the hook can
        // reuse the same finalization path as manual stop and expose the
        // resulting AudioRecording consistently.
        autoStopOnMaxDuration: _autoStopOnMaxDuration,
        ...options
    } = recordingOptions

    return cleanNativeOptions(options)
}
