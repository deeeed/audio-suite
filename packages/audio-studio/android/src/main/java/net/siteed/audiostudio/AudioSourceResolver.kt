package net.siteed.audiostudio

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder

/**
 * Chooses the `MediaRecorder.AudioSource` to capture from.
 *
 * Recording was hardcoded to `MIC`, which runs whatever voice processing the OEM applies —
 * noise suppression, AGC, and on Honor/Huawei and Xiaomi/Redmi devices an aggressive
 * "enhancement" pass. That is reasonable for a voice memo and actively harmful for
 * speech-to-text or acoustic analysis (#428). iOS already exposes an escape hatch via
 * `ios.audioSession.mode: 'measurement'`; this is the Android equivalent.
 *
 * `UNPROCESSED` is not available on every device, so a request for it is verified by
 * actually opening an `AudioRecord` rather than trusting a constant to exist. The resolved
 * source is reported back to JS so a caller can tell a fallback from an honoured request.
 */
internal object AudioSourceResolver {

    private const val CLASS_NAME = "AudioSourceResolver"

    /** What the caller asked for and what they actually got. */
    data class Resolution(
        val source: Int,
        /** Stable name for the JS layer: mic, voiceRecognition, unprocessed. */
        val name: String,
        /** True when the requested source was unavailable and something else was used. */
        val fellBack: Boolean,
    )

    /**
     * @param requested one of mic, voiceRecognition, unprocessed, auto, or null for the default
     * @param sampleRate used to probe availability at the rate recording will actually use
     * @param channelConfig `AudioFormat.CHANNEL_IN_*`
     * @param audioFormat `AudioFormat.ENCODING_*`
     */
    fun resolve(
        requested: String?,
        sampleRate: Int,
        channelConfig: Int,
        audioFormat: Int,
    ): Resolution {
        return when (requested) {
            null, "mic" -> Resolution(MediaRecorder.AudioSource.MIC, "mic", fellBack = false)

            "voiceRecognition" -> Resolution(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                "voiceRecognition",
                fellBack = false,
            )

            "unprocessed" -> {
                if (isUsable(MediaRecorder.AudioSource.UNPROCESSED, sampleRate, channelConfig, audioFormat)) {
                    Resolution(MediaRecorder.AudioSource.UNPROCESSED, "unprocessed", fellBack = false)
                } else {
                    LogUtils.w(
                        CLASS_NAME,
                        "UNPROCESSED audio source is not usable on this device; falling back to MIC"
                    )
                    Resolution(MediaRecorder.AudioSource.MIC, "mic", fellBack = true)
                }
            }

            "auto" -> {
                if (isUsable(MediaRecorder.AudioSource.UNPROCESSED, sampleRate, channelConfig, audioFormat)) {
                    Resolution(MediaRecorder.AudioSource.UNPROCESSED, "unprocessed", fellBack = false)
                } else if (isUsable(MediaRecorder.AudioSource.VOICE_RECOGNITION, sampleRate, channelConfig, audioFormat)) {
                    Resolution(MediaRecorder.AudioSource.VOICE_RECOGNITION, "voiceRecognition", fellBack = false)
                } else {
                    Resolution(MediaRecorder.AudioSource.MIC, "mic", fellBack = false)
                }
            }

            else -> {
                LogUtils.w(CLASS_NAME, "Unknown androidConfig.audioSource '$requested'; using MIC")
                Resolution(MediaRecorder.AudioSource.MIC, "mic", fellBack = true)
            }
        }
    }

    /**
     * Can this source actually be opened here?
     *
     * `MediaRecorder.AudioSource.UNPROCESSED` is a compile-time constant on every API level
     * this library supports, so its presence proves nothing — plenty of devices reject it at
     * `AudioRecord` construction or return `STATE_UNINITIALIZED`. The only reliable check is
     * to open one and release it.
     */
    private fun isUsable(
        source: Int,
        sampleRate: Int,
        channelConfig: Int,
        audioFormat: Int,
    ): Boolean {
        var record: AudioRecord? = null
        return try {
            val minBuffer = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
            if (minBuffer <= 0) return false
            record = AudioRecord(source, sampleRate, channelConfig, audioFormat, minBuffer)
            record.state == AudioRecord.STATE_INITIALIZED
        } catch (e: Exception) {
            // Missing RECORD_AUDIO permission also lands here. Reporting "unusable" is right
            // either way: the caller gets MIC, and the permission failure surfaces later
            // through the normal recording path with a clearer message than this probe could give.
            LogUtils.d(CLASS_NAME, "Audio source $source is not usable: ${e.message}")
            false
        } finally {
            try {
                record?.release()
            } catch (_: Exception) {
                // Releasing a never-initialized AudioRecord can throw; nothing to do about it.
            }
        }
    }
}
