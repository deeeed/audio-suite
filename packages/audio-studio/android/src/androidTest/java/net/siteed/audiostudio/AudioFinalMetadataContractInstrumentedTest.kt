package net.siteed.audiostudio

import android.content.Context
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Regression coverage for Android range processing where the final PCM bytes,
 * returned metadata, and WAV headers must all describe the post-conversion data.
 */
@RunWith(AndroidJUnit4::class)
class AudioFinalMetadataContractInstrumentedTest {
    private lateinit var context: Context
    private lateinit var filesDir: File
    private lateinit var audioProcessor: AudioProcessor

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        filesDir = context.filesDir
        audioProcessor = AudioProcessor(filesDir)
        copyAssetToFilesDir("chorus.wav")
    }

    @After
    fun tearDown() {
        filesDir.listFiles()?.forEach { file ->
            if (file.name.startsWith("final_metadata_contract_") || file.name == "chorus.wav") {
                file.delete()
            }
        }
    }

    @Test
    fun loadAudioRange_returnsMetadataFromFinalConvertedWavBytes() {
        val audioData = audioProcessor.loadAudioRange(
            fileUri = File(filesDir, "chorus.wav").absolutePath,
            startTimeMs = 0,
            endTimeMs = ONE_SECOND_MS,
            config = DecodingConfig(
                targetSampleRate = TARGET_SAMPLE_RATE,
                targetChannels = TARGET_CHANNELS,
                targetBitDepth = TARGET_BIT_DEPTH,
                normalizeAudio = false
            )
        )

        val converted = requireNotNull(audioData) { "Audio range should load" }
        val bytesPerTargetFrame = TARGET_CHANNELS * BYTES_PER_TARGET_SAMPLE
        val finalFrameCount = converted.data.size / bytesPerTargetFrame
        val durationFromFinalBytes = finalFrameCount * 1_000L / TARGET_SAMPLE_RATE

        assertEquals("sampleRate should describe final converted bytes", TARGET_SAMPLE_RATE, converted.sampleRate)
        assertEquals("channels should describe final converted bytes", TARGET_CHANNELS, converted.channels)
        assertEquals("bitDepth should describe final converted bytes", TARGET_BIT_DEPTH, converted.bitDepth)
        assertEquals("final PCM data must end on a target frame boundary", 0, converted.data.size % bytesPerTargetFrame)
        assertEquals(
            "duration should be derived from actual final PCM bytes",
            durationFromFinalBytes,
            converted.durationMs
        )
        assertTrue(
            "duration should remain close to requested range: ${converted.durationMs}ms",
            kotlin.math.abs(converted.durationMs - ONE_SECOND_MS) <= 25
        )
    }

    @Test
    fun loadAudioRange_alignsConvertedWavBytesToTargetFrameSize() {
        val audioData = audioProcessor.loadAudioRange(
            fileUri = File(filesDir, "chorus.wav").absolutePath,
            startTimeMs = 0,
            endTimeMs = ONE_SECOND_MS,
            config = DecodingConfig(
                targetSampleRate = TARGET_SAMPLE_RATE,
                targetChannels = TARGET_CHANNELS,
                targetBitDepth = TARGET_BIT_DEPTH,
                normalizeAudio = false
            )
        )

        val converted = requireNotNull(audioData) { "Audio range should load" }
        val bytesPerTargetFrame = TARGET_CHANNELS * BYTES_PER_TARGET_SAMPLE

        assertEquals("final PCM data must end on a target frame boundary", 0, converted.data.size % bytesPerTargetFrame)
    }

    @Test
    fun trimAudio_writesWavHeaderFromFinalConvertedBytes() {
        val outputFileName = "final_metadata_contract_processor_trim.wav"
        val trimmed = audioProcessor.trimAudio(
            fileUri = File(filesDir, "chorus.wav").absolutePath,
            startTimeMs = 0,
            endTimeMs = ONE_SECOND_MS,
            config = DecodingConfig(
                targetSampleRate = TARGET_SAMPLE_RATE,
                targetChannels = TARGET_CHANNELS,
                targetBitDepth = TARGET_BIT_DEPTH,
                normalizeAudio = false
            ),
            outputFileName = outputFileName
        )

        requireNotNull(trimmed) { "Trimmed audio should be returned" }
        val header = readWavHeader(File(filesDir, outputFileName))

        assertEquals("WAV header sample rate should be target sample rate", TARGET_SAMPLE_RATE, header.sampleRate)
        assertEquals("WAV header channels should be target channels", TARGET_CHANNELS, header.channels)
        assertEquals("WAV header bit depth should be target bit depth", TARGET_BIT_DEPTH, header.bitDepth)
        assertEquals("WAV data chunk should match returned final PCM bytes", trimmed.data.size, header.dataSize)
    }

    @Test
    fun audioTrimmer_honorsJsNumberOutputFormatWhenWritingWavHeader() {
        val trimmer = AudioTrimmer(context, AudioFileHandler(filesDir))
        val result = trimmer.trimAudio(
            fileUri = Uri.fromFile(File(filesDir, "chorus.wav")).toString(),
            startTimeMs = 0,
            endTimeMs = ONE_SECOND_MS,
            outputFileName = "final_metadata_contract_audio_trimmer",
            outputFormat = mapOf(
                "format" to "wav",
                "sampleRate" to TARGET_SAMPLE_RATE.toDouble(),
                "channels" to TARGET_CHANNELS.toDouble(),
                "bitDepth" to TARGET_BIT_DEPTH.toDouble()
            )
        )

        val outputPath = result["uri"] as String
        val header = readWavHeader(File(outputPath))

        assertEquals("Double sampleRate option should drive WAV header", TARGET_SAMPLE_RATE, header.sampleRate)
        assertEquals("Double channels option should drive WAV header", TARGET_CHANNELS, header.channels)
        assertEquals("Double bitDepth option should drive WAV header", TARGET_BIT_DEPTH, header.bitDepth)
    }

    private fun copyAssetToFilesDir(fileName: String) {
        context.assets.open(fileName).use { input ->
            File(filesDir, fileName).outputStream().use { output ->
                input.copyTo(output)
            }
        }
    }

    private fun readWavHeader(file: File): WavHeader {
        assertTrue("WAV file should exist: ${file.absolutePath}", file.exists())
        val bytes = file.inputStream().use { it.readNBytes(44) }
        assertEquals("RIFF", String(bytes.sliceArray(0..3)))
        assertEquals("WAVE", String(bytes.sliceArray(8..11)))
        assertEquals("data", String(bytes.sliceArray(36..39)))

        return WavHeader(
            channels = bytes.shortAt(22),
            sampleRate = bytes.intAt(24),
            bitDepth = bytes.shortAt(34),
            dataSize = bytes.intAt(40)
        )
    }

    private fun ByteArray.shortAt(offset: Int): Int =
        ByteBuffer.wrap(this, offset, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt()

    private fun ByteArray.intAt(offset: Int): Int =
        ByteBuffer.wrap(this, offset, 4).order(ByteOrder.LITTLE_ENDIAN).int

    private data class WavHeader(
        val channels: Int,
        val sampleRate: Int,
        val bitDepth: Int,
        val dataSize: Int
    )

    companion object {
        private const val ONE_SECOND_MS = 1_000L
        private const val TARGET_SAMPLE_RATE = 16_000
        private const val TARGET_CHANNELS = 2
        private const val TARGET_BIT_DEPTH = 16
        private const val BYTES_PER_TARGET_SAMPLE = TARGET_BIT_DEPTH / 8
    }
}
