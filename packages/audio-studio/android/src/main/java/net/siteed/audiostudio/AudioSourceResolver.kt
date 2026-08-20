package net.siteed.audiostudio

import android.content.Context
import android.media.AudioFormat
import android.media.AudioManager
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
 * Verifying `UNPROCESSED` needs care. Android documents that a device without hardware
 * support treats it as `DEFAULT`, so an `AudioRecord` opens and reports
 * `STATE_INITIALIZED` while OEM processing stays on — the exact thing the caller asked to
 * avoid. Construction alone therefore proves nothing, and an earlier version of this file
 * got that wrong. The platform exposes `PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED` for
 * precisely this question, so that is the gate; the construction probe only confirms the
 * requested format also works.
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

    val MIC = Resolution(MediaRecorder.AudioSource.MIC, "mic", fellBack = false)

    /**
     * @param requested one of mic, voiceRecognition, unprocessed, auto, or null for the default
     * @param context used to query the platform's unprocessed-capture capability
     * @param sampleRate the rate recording will actually use
     * @param channelConfig `AudioFormat.CHANNEL_IN_*`
     * @param audioFormat `AudioFormat.ENCODING_*`
     */
    fun resolve(
        requested: String?,
        context: Context,
        sampleRate: Int,
        channelConfig: Int,
        audioFormat: Int,
    ): Resolution {
        return when (requested) {
            null, "mic" -> MIC

            "voiceRecognition" -> Resolution(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                "voiceRecognition",
                fellBack = false,
            )

            "unprocessed" -> {
                val resolved = unprocessedIfSupported(context, sampleRate, channelConfig, audioFormat)
                if (resolved != null) {
                    resolved
                } else {
                    LogUtils.w(
                        CLASS_NAME,
                        "This device does not support unprocessed capture; falling back to MIC. " +
                            "Audio will carry whatever processing the OEM applies."
                    )
                    MIC.copy(fellBack = true)
                }
            }

            "auto" -> unprocessedIfSupported(context, sampleRate, channelConfig, audioFormat)
                ?: Resolution(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    "voiceRecognition",
                    fellBack = false,
                )

            else -> {
                LogUtils.w(CLASS_NAME, "Unknown android.audioSource '$requested'; using MIC")
                MIC.copy(fellBack = true)
            }
        }
    }

    /**
     * `UNPROCESSED` when the device genuinely supports it at this format, otherwise null.
     *
     * Two gates, and both are needed. The capability property is the only reliable answer
     * to "does this hardware actually bypass processing" — without it a device silently
     * substitutes `DEFAULT`. The construction probe then confirms the requested sample
     * rate and channel layout work with that source, which the property says nothing about.
     */
    private fun unprocessedIfSupported(
        context: Context,
        sampleRate: Int,
        channelConfig: Int,
        audioFormat: Int,
    ): Resolution? {
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        val supported = audioManager
            ?.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED)
            ?.equals("true", ignoreCase = true) == true

        if (!supported) {
            LogUtils.d(CLASS_NAME, "PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED is not true")
            return null
        }
        if (!isUsable(MediaRecorder.AudioSource.UNPROCESSED, sampleRate, channelConfig, audioFormat)) {
            LogUtils.d(CLASS_NAME, "UNPROCESSED is supported but not usable at ${sampleRate}Hz")
            return null
        }
        return Resolution(MediaRecorder.AudioSource.UNPROCESSED, "unprocessed", fellBack = false)
    }

    /** Can an AudioRecord actually be opened with this source and format? */
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
            // Missing RECORD_AUDIO also lands here. Reporting "unusable" is right either
            // way: the caller gets MIC, and the permission failure surfaces through the
            // normal recording path with a clearer message than this probe could give.
            LogUtils.d(CLASS_NAME, "Audio source $source is not usable: ${e.message}")
            false
        } finally {
            try {
                record?.release()
            } catch (_: Exception) {
                // Releasing a never-initialized AudioRecord can throw; nothing to do.
            }
        }
    }
}
