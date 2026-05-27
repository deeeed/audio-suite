package net.siteed.audiostudio

import android.media.AudioFormat
import android.os.Build
import java.io.File

// New output configuration structure
data class OutputConfig(
    val primary: PrimaryOutput = PrimaryOutput(),
    val compressed: CompressedOutput = CompressedOutput()
) {
    data class PrimaryOutput(
        val enabled: Boolean = true,
        val format: String = "wav"
    )
    
    data class CompressedOutput(
        val enabled: Boolean = false,
        val format: String = "aac",
        val bitrate: Int = 128000,
        val preferRawStream: Boolean = false
    )
    
    companion object {
        fun fromMap(map: Map<String, Any?>?): OutputConfig {
            if (map == null) return OutputConfig()
            
            val primaryMap = map.getTypedMap<Any?>("primary") { true }
            val compressedMap = map.getTypedMap<Any?>("compressed") { true }
            
            val primary = PrimaryOutput(
                enabled = primaryMap.getBooleanOrDefault("enabled", true),
                format = primaryMap.getStringOrDefault("format", "wav")
            )
            
            val compressed = CompressedOutput(
                enabled = compressedMap.getBooleanOrDefault("enabled", false),
                format = compressedMap.getStringOrDefault("format", "aac").lowercase(),
                bitrate = compressedMap.getNumberOrDefault("bitrate", 128000),
                preferRawStream = compressedMap.getBooleanOrDefault("preferRawStream", false)
            )
            
            return OutputConfig(primary = primary, compressed = compressed)
        }
    }
}

data class RecordingConfig(
    val sampleRate: Int = Constants.DEFAULT_SAMPLE_RATE,
    val channels: Int = 1,
    val encoding: String = "pcm_16bit",
    val keepAwake: Boolean = true,
    val interval: Long = Constants.DEFAULT_INTERVAL,
    val intervalAnalysis: Long = Constants.DEFAULT_INTERVAL_ANALYSIS,
    val enableProcessing: Boolean = false,
    val segmentDurationMs: Int = 100,
    val showNotification: Boolean = false,
    val showWaveformInNotification: Boolean = false,
    val notification: NotificationConfig = NotificationConfig(),
    val features: Map<String, Boolean> = emptyMap(),
    val output: OutputConfig = OutputConfig(),
    val autoResumeAfterInterruption: Boolean = false,
    val outputDirectory: String? = null,
    val filename: String? = null,
    val deviceId: String? = null,
    val deviceDisconnectionBehavior: String? = null,
    val audioFocusStrategy: String? = null,
    val bufferDurationSeconds: Double? = null,
    val streamFormat: String = "raw",
    val maxDurationMs: Long = 0L,
    val autoStopOnMaxDuration: Boolean = false,
) {
    companion object {
        fun fromMap(options: Map<String, Any?>?): Result<Pair<RecordingConfig, AudioFormatInfo>> {
            if (options == null) {
                val defaultConfig = RecordingConfig()
                val defaultFormat = AudioFormatInfo(
                    format = AudioFormat.ENCODING_PCM_16BIT,
                    mimeType = "audio/wav",
                    fileExtension = "wav"
                )
                return Result.success(Pair(defaultConfig, defaultFormat))
            }

            // Extract features using type-safe helper
            val features = options.getTypedMap<Boolean>("features") { it is Boolean }

            // Parse notification config using type-safe helper
            val notificationMap = options.getTypedMap<Any?>("notification") { true }
            val notificationConfig = NotificationConfig.fromMap(notificationMap)

            // Parse output config
            val outputMap = options.getTypedMap<Any?>("output") { true }
            val outputConfig = OutputConfig.fromMap(outputMap)

            // Validate bitrate if compression is enabled
            if (outputConfig.compressed.enabled) {
                when {
                    outputConfig.compressed.bitrate < 8000 -> return Result.failure(
                        IllegalArgumentException("Bitrate must be at least 8000 bps")
                    )
                    outputConfig.compressed.bitrate > 960000 -> return Result.failure(
                        IllegalArgumentException("Bitrate cannot exceed 960000 bps")
                    )
                }
            }

            // Only validate directory if it's provided
            val outputDirectory = options["outputDirectory"] as? String
            if (outputDirectory != null) {
                // Clean up the directory path by removing file:// protocol and normalizing
                val cleanDirectory = outputDirectory
                    .replace(Regex("^file://"), "")
                    .trim('/')
                    .replace("//", "/")

                val directory = File(cleanDirectory)
                if (!directory.exists()) {
                    return Result.failure(IllegalArgumentException("Directory does not exist: $cleanDirectory"))
                }
                if (!directory.isDirectory) {
                    return Result.failure(IllegalArgumentException("Path is not a directory: $cleanDirectory"))
                }
                if (!directory.canWrite()) {
                    return Result.failure(IllegalArgumentException("Directory is not writable: $cleanDirectory"))
                }
            }

            // Get device-related settings
            val deviceId = options["deviceId"] as? String
            val deviceDisconnectionBehavior = options["deviceDisconnectionBehavior"] as? String
            
            // Get Android-specific settings
            val androidConfig = options["android"] as? Map<String, Any>
            val audioFocusStrategy = androidConfig?.get("audioFocusStrategy") as? String

            // Initialize the recording configuration with cleaned directory path
            val tempRecordingConfig = RecordingConfig(
                sampleRate = options.getNumberOrDefault("sampleRate", Constants.DEFAULT_SAMPLE_RATE),
                channels = options.getNumberOrDefault("channels", 1),
                encoding = options.getStringOrDefault("encoding", "pcm_16bit"),
                keepAwake = options.getBooleanOrDefault("keepAwake", true),
                // Enforce minimum intervals to prevent excessive CPU usage
                interval = maxOf(Constants.MIN_INTERVAL, options.getNumberOrDefault("interval", Constants.DEFAULT_INTERVAL)),
                intervalAnalysis = maxOf(Constants.MIN_INTERVAL, options.getNumberOrDefault("intervalAnalysis", Constants.DEFAULT_INTERVAL_ANALYSIS)),
                enableProcessing = options.getBooleanOrDefault("enableProcessing", false),
                segmentDurationMs = options.getNumberOrDefault("segmentDurationMs", 100),
                showNotification = options.getBooleanOrDefault("showNotification", false),
                showWaveformInNotification = options.getBooleanOrDefault("showWaveformInNotification", false),
                notification = notificationConfig,
                features = features,
                output = outputConfig,
                autoResumeAfterInterruption = options.getBooleanOrDefault("autoResumeAfterInterruption", false),
                outputDirectory = outputDirectory?.let {
                    it.replace(Regex("^file://"), "")
                        .trim('/')
                        .replace("//", "/")
                },
                filename = options["filename"] as? String,
                deviceId = deviceId,
                deviceDisconnectionBehavior = deviceDisconnectionBehavior,
                audioFocusStrategy = audioFocusStrategy,
                bufferDurationSeconds = (options["bufferDurationSeconds"] as? Number)?.toDouble(),
                streamFormat = options.getStringOrDefault("streamFormat", "raw"),
                maxDurationMs = options.getNumberOrDefault("maxDurationMs", 0L),
                autoStopOnMaxDuration = options.getBooleanOrDefault("autoStopOnMaxDuration", false),
            )

            // Validate sample rate and channels
            if (tempRecordingConfig.sampleRate !in listOf(16000, 44100, 48000)) {
                return Result.failure(
                    IllegalArgumentException("Sample rate must be one of 16000, 44100, or 48000 Hz")
                )
            }
            if (tempRecordingConfig.channels !in 1..2) {
                return Result.failure(
                    IllegalArgumentException("Channels must be either 1 (Mono) or 2 (Stereo)")
                )
            }

            // Set encoding and file extension
            val audioFormatInfo = when (tempRecordingConfig.encoding) {
                "pcm_8bit" -> AudioFormatInfo(
                    format = AudioFormat.ENCODING_PCM_8BIT,
                    mimeType = "audio/wav",
                    fileExtension = "wav"
                )
                "pcm_16bit" -> AudioFormatInfo(
                    format = AudioFormat.ENCODING_PCM_16BIT,
                    mimeType = "audio/wav",
                    fileExtension = "wav"
                )
                "pcm_32bit" -> AudioFormatInfo(
                    format = AudioFormat.ENCODING_PCM_FLOAT,
                    mimeType = "audio/wav",
                    fileExtension = "wav"
                )
                "opus" -> {
                    if (Build.VERSION.SDK_INT < 29) {
                        return Result.failure(
                            IllegalArgumentException("Opus encoding not supported on this Android version.")
                        )
                    }
                    AudioFormatInfo(
                        format = if (Build.VERSION.SDK_INT >= 29) 20 else AudioFormat.ENCODING_DEFAULT, // 20 is ENCODING_OPUS
                        mimeType = "audio/opus",
                        fileExtension = "opus"
                    )
                }
                "aac_lc" -> AudioFormatInfo(
                    format = AudioFormat.ENCODING_AAC_LC,
                    mimeType = "audio/aac",
                    fileExtension = "aac"
                )
                else -> AudioFormatInfo(
                    format = AudioFormat.ENCODING_DEFAULT,
                    mimeType = "audio/wav",
                    fileExtension = "wav"
                )
            }

            return Result.success(Pair(tempRecordingConfig, audioFormatInfo))
        }
    }
}

// Extension functions for type-safe map access
private inline fun <reified T> Map<String, Any?>.getTypedMap(
    key: String,
    predicate: (Any?) -> Boolean
): Map<String, T> {
    return (this[key] as? Map<*, *>)?.mapNotNull { (k, v) ->
        if (k is String && predicate(v)) {
            k to (v as T)
        } else null
    }?.toMap() ?: emptyMap()
}

private fun Map<String, Any?>.getStringOrDefault(key: String, default: String): String {
    return this[key] as? String ?: default
}

private fun Map<String, Any?>.getBooleanOrDefault(key: String, default: Boolean): Boolean {
    return this[key] as? Boolean ?: default
}

private fun Map<String, Any?>.getNumberOrDefault(key: String, default: Int): Int {
    return (this[key] as? Number)?.toInt() ?: default
}

private fun Map<String, Any?>.getNumberOrDefault(key: String, default: Long): Long {
    return (this[key] as? Number)?.toLong() ?: default
}

private fun Map<String, Any?>.getNumberOrDefault(key: String, default: Double): Double {
    return (this[key] as? Number)?.toDouble() ?: default
}

data class AudioFormatInfo(
    val format: Int,
    val mimeType: String,
    val fileExtension: String
)
