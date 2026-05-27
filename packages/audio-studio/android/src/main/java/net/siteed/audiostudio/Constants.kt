package net.siteed.audiostudio

/**
 * Constants used throughout the AudioStudio module
 */
object Constants {
    // Event names
    const val TAG = "AudioStudio"
    const val AUDIO_EVENT_NAME = "AudioData"
    const val AUDIO_ANALYSIS_EVENT_NAME = "AudioAnalysis"
    const val RECORDING_INTERRUPTED_EVENT_NAME = "onRecordingInterrupted"
    const val MAX_DURATION_REACHED_EVENT_NAME = "MaxDurationReached"
    const val TRIM_PROGRESS_EVENT = "TrimProgress"
    const val DEVICE_CHANGED_EVENT = "deviceChangedEvent"
    const val AUDIO_STREAM_CHUNK_EVENT = "AudioDataStreamChunk"
    const val AUDIO_STREAM_PROGRESS_EVENT = "AudioDataStreamProgress"
    const val AUDIO_STREAM_COMPLETE_EVENT = "AudioDataStreamComplete"
    const val AUDIO_STREAM_ERROR_EVENT = "AudioDataStreamError"
    
    // Audio constants
    const val DEFAULT_SAMPLE_RATE = 16000 // Default sample rate for audio recording
    const val DEFAULT_CHANNEL_CONFIG = 1 // Mono
    const val DEFAULT_AUDIO_FORMAT = 16 // 16-bit PCM
    const val DEFAULT_INTERVAL = 1000L
    const val DEFAULT_INTERVAL_ANALYSIS = 500L
    const val MIN_INTERVAL = 10L // Minimum interval in ms for emitting audio data
    const val WAV_HEADER_SIZE = 44
    const val RIFF_HEADER = 0x52494646 // "RIFF"
    const val WAVE_HEADER = 0x57415645 // "WAVE"
    const val FMT_CHUNK_ID = 0x666d7420 // "fmt "
    const val DATA_CHUNK_ID = 0x64617461 // "data"
    const val INFO_CHUNK_ID = 0x494E464F // "info"
    
    // Device constants
    const val DEVICE_TYPE_BUILTIN_MIC = "builtin_mic"
    const val DEVICE_TYPE_BLUETOOTH = "bluetooth"
    const val DEVICE_TYPE_USB = "usb"
    const val DEVICE_TYPE_WIRED_HEADSET = "wired_headset"
    const val DEVICE_TYPE_WIRED_HEADPHONES = "wired_headphones"
    const val DEVICE_TYPE_SPEAKER = "speaker"
    const val DEVICE_TYPE_UNKNOWN = "unknown"
}
