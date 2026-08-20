package net.siteed.sherpaonnx

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Guards the AudioTrack prefill contract used by TtsHandler.
 *
 * A MODE_STREAM track does not begin output when play() is called — it waits until the
 * buffer holds startThresholdInFrames, which defaults to the full buffer capacity. The
 * TTS path builds a 16x buffer (well over a second) but only prefills ~200ms, so without
 * lowering the threshold playback stalls and short utterances never start at all.
 *
 * These tests assert the real framework behavior rather than mocking it, because the
 * defect was precisely a wrong assumption about what play() does.
 */
@RunWith(AndroidJUnit4::class)
class AudioTrackPrefillTest {

    private val sampleRate = 22050
    private val prefillFrames = sampleRate / 5 // 200ms, matching TtsHandler
    private var track: AudioTrack? = null

    @After
    fun tearDown() {
        track?.let {
            if (it.playState == AudioTrack.PLAYSTATE_PLAYING) it.stop()
            it.release()
        }
        track = null
    }

    private fun buildTrack(): AudioTrack {
        val bufferBytes = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        ) * 16

        return AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(bufferBytes)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
    }

    /**
     * The premise of the whole fix: the default start threshold is the full buffer, which
     * is far larger than the prefill target. If this ever stops being true, lowering the
     * threshold becomes unnecessary and this test should be revisited rather than deleted.
     */
    @Test
    fun defaultStartThresholdExceedsPrefillTarget() {
        assumeTrue(Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        val t = buildTrack().also { track = it }
        assertEquals(AudioTrack.STATE_INITIALIZED, t.state)

        assertTrue(
            "Default start threshold (${t.startThresholdInFrames}) is expected to exceed " +
                "the ${prefillFrames}-frame prefill target; if not, TtsHandler's threshold " +
                "override is no longer needed.",
            t.startThresholdInFrames > prefillFrames
        )
    }

    /** The override TtsHandler applies must actually take effect. */
    @Test
    fun startThresholdCanBeLoweredToPrefillTarget() {
        assumeTrue(Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        val t = buildTrack().also { track = it }

        t.startThresholdInFrames = prefillFrames

        assertEquals(prefillFrames, t.startThresholdInFrames)
    }

    /**
     * The behavioral assertion that matters: after writing exactly the prefill amount and
     * calling play(), output actually advances. Before the fix the head stayed at 0
     * because the track was still waiting for a full buffer.
     */
    @Test
    fun playbackAdvancesAfterPrefillWhenThresholdLowered() {
        assumeTrue(Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        val t = buildTrack().also { track = it }
        t.startThresholdInFrames = prefillFrames

        val samples = ShortArray(prefillFrames) { i ->
            // Quiet 440Hz tone; content is irrelevant, only that frames are consumed.
            (Math.sin(2.0 * Math.PI * 440.0 * i / sampleRate) * 2000).toInt().toShort()
        }
        val written = t.write(samples, 0, samples.size, AudioTrack.WRITE_BLOCKING)
        assertEquals(samples.size, written)

        t.play()

        // Poll rather than sleeping a fixed amount; emulators advance slowly.
        var head = 0
        val deadline = System.currentTimeMillis() + 3000
        while (System.currentTimeMillis() < deadline) {
            head = t.playbackHeadPosition
            if (head > 0) break
            Thread.sleep(50)
        }

        assertTrue(
            "playbackHeadPosition stayed at 0 after prefilling $prefillFrames frames and " +
                "calling play(); output never started.",
            head > 0
        )
    }

    /**
     * Short utterances finish below the prefill target. TtsHandler lowers the threshold to
     * whatever is buffered; without that, play() waits on samples that never arrive.
     */
    @Test
    fun shortUtteranceStartsWhenThresholdLoweredToBufferedFrames() {
        assumeTrue(Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        val t = buildTrack().also { track = it }
        t.startThresholdInFrames = prefillFrames

        val shortFrames = prefillFrames / 4 // well under the prefill target
        val samples = ShortArray(shortFrames)
        assertEquals(shortFrames, t.write(samples, 0, samples.size, AudioTrack.WRITE_BLOCKING))

        t.startThresholdInFrames = shortFrames
        t.play()

        var head = 0
        val deadline = System.currentTimeMillis() + 3000
        while (System.currentTimeMillis() < deadline) {
            head = t.playbackHeadPosition
            if (head > 0) break
            Thread.sleep(50)
        }

        assertTrue(
            "A $shortFrames-frame utterance never started even after lowering the " +
                "threshold to the buffered frame count.",
            head > 0
        )
    }
}
