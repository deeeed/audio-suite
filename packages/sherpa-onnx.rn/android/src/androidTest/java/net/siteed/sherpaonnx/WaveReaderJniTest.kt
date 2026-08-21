package net.siteed.sherpaonnx

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.k2fsa.sherpa.onnx.WaveReader
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Exercises the WaveReader JNI boundary against the real prebuilt .so (#438).
 *
 * The Kotlin declarations said `Array<Any>` and index-cast the result, while the
 * .so constructs and returns a `WaveData` — so the first real call would have
 * thrown ClassCastException. Latent because nothing called it; this test is the
 * caller, on device, through the actual library.
 */
@RunWith(AndroidJUnit4::class)
class WaveReaderJniTest {

    @Test
    fun readWaveReturnsWaveDataThroughTheRealJni() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val sampleRate = 16000
        val seconds = 1
        val frames = sampleRate * seconds

        // A 440Hz mono 16-bit WAV, written by hand so the test needs no asset.
        val wav = File(context.cacheDir, "wavereader-jni-${System.currentTimeMillis()}.wav")
        val dataSize = frames * 2
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + dataSize); put("WAVE".toByteArray())
            put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
            putInt(sampleRate); putInt(sampleRate * 2); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(dataSize)
        }
        val samples = ByteBuffer.allocate(dataSize).order(ByteOrder.LITTLE_ENDIAN).apply {
            for (i in 0 until frames) {
                putShort((sin(2.0 * PI * 440.0 * i / sampleRate) * 12000).toInt().toShort())
            }
        }
        wav.writeBytes(header.array() + samples.array())

        try {
            val result = WaveReader.readWave(wav.absolutePath)

            // The declaration matching the .so is the fix; these prove the data
            // crossed the boundary intact rather than merely not crashing.
            assertEquals(sampleRate, result.sampleRate)
            assertEquals(frames, result.samples.size)
            val peak = result.samples.maxOf { kotlin.math.abs(it) }
            assertTrue("expected a non-silent sine wave, peak=$peak", peak > 0.25f)
        } finally {
            wav.delete()
        }
    }
}
