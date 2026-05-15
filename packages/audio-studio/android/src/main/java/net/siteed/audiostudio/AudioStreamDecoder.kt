// packages/audio-studio/android/src/main/java/net/siteed/audiostudio/AudioStreamDecoder.kt
//
// Progressive file decoder for `streamAudioData`. Uses MediaExtractor +
// MediaCodec to decode a stored audio file into bounded Float32 PCM chunks
// without loading the full PCM range into memory. Output is sanitized
// (NaN/Inf -> 0, clamp to [-1, 1] when normalizeAudio=true) and supports
// per-request cancellation + back-pressure ack.
package net.siteed.audiostudio

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import androidx.core.os.bundleOf
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import kotlin.math.ceil

interface AudioStreamDecoderDelegate {
    fun streamDecoderEmit(eventName: String, payload: Bundle)
}

class AudioStreamDecoder(
    private val context: Context,
    private val options: Options,
    private val delegate: AudioStreamDecoderDelegate,
) {
    data class Options(
        val requestId: String,
        val fileUri: String,
        val startTimeMs: Long?,
        val endTimeMs: Long?,
        val targetSampleRate: Int?,
        val channels: Int?,
        val normalizeAudio: Boolean,
        val chunkDurationMs: Int,
        val maxChunkBytes: Int?,
        val maxBufferedChunks: Int,
        val backpressureTimeoutMs: Long?,
    )

    companion object {
        private const val TAG = "AudioStreamDecoder"
        private const val TIMEOUT_US = 10_000L
    }

    private val cancelled = AtomicBoolean(false)
    private val lastAckedIndex = AtomicInteger(-1)
    private val ackLock = Object()
    private var workerThread: Thread? = null

    fun start() {
        workerThread = thread(
            isDaemon = true,
            name = "AudioStreamDecoder-${options.requestId}"
        ) {
            run()
        }
    }

    fun cancel() {
        cancelled.set(true)
        synchronized(ackLock) { ackLock.notifyAll() }
    }

    fun acknowledgeChunk(index: Int) {
        synchronized(ackLock) {
            if (index > lastAckedIndex.get()) {
                lastAckedIndex.set(index)
            }
            ackLock.notifyAll()
        }
    }

    private fun run() {
        val resolved = resolveFilePath(options.fileUri)
        if (resolved == null) {
            emitError("ERR_AUDIO_STREAM_FILE_NOT_FOUND", "Cannot resolve file: ${options.fileUri}")
            return
        }
        val path = resolved.path
        val tempFile = resolved.tempFile
        if (!File(path).exists()) {
            tempFile?.let { runCatching { it.delete() } }
            emitError("ERR_AUDIO_STREAM_FILE_NOT_FOUND", "File not found: $path")
            return
        }

        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        var emittedChunks = 0
        var emittedSamples = 0L
        var backpressureTimedOut = false
        var outputSampleRate = options.targetSampleRate ?: 0
        var outputChannels = options.channels ?: 0

        try {
            try {
                extractor.setDataSource(path)
            } catch (e: Exception) {
                emitError(
                    "ERR_AUDIO_STREAM_DECODE_FAILED",
                    "setDataSource failed: ${e.message}"
                )
                return
            }

            val trackIndex = (0 until extractor.trackCount).firstOrNull { idx ->
                val format = extractor.getTrackFormat(idx)
                format.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            }
            if (trackIndex == null) {
                emitError(
                    "ERR_AUDIO_STREAM_UNSUPPORTED_FORMAT",
                    "No audio track found"
                )
                return
            }
            extractor.selectTrack(trackIndex)
            val format = extractor.getTrackFormat(trackIndex)
            val extractorDurationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) {
                format.getLong(MediaFormat.KEY_DURATION)
            } else {
                -1L
            }
            val metadataDurationMs = if (extractorDurationUs <= 0) {
                readMetadataDurationMs(path)
            } else {
                -1L
            }
            val assetDurationUs = if (extractorDurationUs > 0) {
                extractorDurationUs
            } else if (metadataDurationMs > 0) {
                metadataDurationMs * 1000L
            } else {
                -1L
            }
            val assetDurationMs = if (assetDurationUs > 0) {
                assetDurationUs / 1000.0
            } else {
                0.0
            }
            // Duration of the *decoded range*, not the whole file, so progress
            // and completion payloads match what the caller actually receives.
            val rangeDurationMs = when {
                options.startTimeMs != null && options.endTimeMs != null ->
                    (options.endTimeMs - options.startTimeMs).toDouble().coerceAtLeast(0.0)
                options.endTimeMs != null -> options.endTimeMs.toDouble().coerceAtLeast(0.0)
                options.startTimeMs != null ->
                    (assetDurationMs - options.startTimeMs).coerceAtLeast(0.0)
                else -> assetDurationMs
            }

            var sourceSampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var sourceChannels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            if (outputSampleRate <= 0) outputSampleRate = sourceSampleRate
            if (outputChannels <= 0) outputChannels = minOf(2, maxOf(1, sourceChannels))
            val maxOutputSamples = options.endTimeMs?.let {
                ((rangeDurationMs / 1000.0) * outputSampleRate.toDouble() * outputChannels.toDouble())
                    .toLong()
                    .coerceAtLeast(0L)
            } ?: Long.MAX_VALUE

            options.startTimeMs?.let {
                extractor.seekTo(it * 1000L, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
            }

            val mime = format.getString(MediaFormat.KEY_MIME)
                ?: run {
                    emitError(
                        "ERR_AUDIO_STREAM_UNSUPPORTED_FORMAT",
                        "Track has no MIME"
                    )
                    return
                }
            codec = try {
                MediaCodec.createDecoderByType(mime)
            } catch (e: Exception) {
                emitError(
                    "ERR_AUDIO_STREAM_UNSUPPORTED_FORMAT",
                    "No decoder for $mime: ${e.message}"
                )
                return
            }
            codec.configure(format, null, null, 0)
            codec.start()

            val endTimeUs = options.endTimeMs?.let { it * 1000L } ?: Long.MAX_VALUE
            val rangeStartMs = options.startTimeMs ?: 0L
            val targetStartUs = rangeStartMs * 1000L
            val samplesPerChunk = run {
                val byTime = (options.chunkDurationMs.toLong() *
                    outputSampleRate.toLong() / 1000L).toInt() * outputChannels
                // Round byte-cap down to a multiple of `outputChannels` so a
                // single interleaved frame is never split across chunks.
                val byBytes = options.maxChunkBytes?.let {
                    (it / 4 / outputChannels) * outputChannels
                } ?: Int.MAX_VALUE
                val raw = minOf(byTime, byBytes)
                maxOf(outputChannels, (raw / outputChannels) * outputChannels)
            }
            var pending = FloatArray(samplesPerChunk * 2)
            var pendingLen = 0
            var pendingHead = 0
            fun pendingAvailable(): Int = pendingLen - pendingHead
            fun compactPending() {
                val available = pendingAvailable()
                if (pendingHead == 0) return
                if (available > 0) {
                    System.arraycopy(pending, pendingHead, pending, 0, available)
                }
                pendingHead = 0
                pendingLen = available
            }
            fun appendPending(samples: FloatArray) {
                if (samples.isEmpty()) return
                val available = pendingAvailable()
                val requiredLen = available + samples.size
                if (requiredLen > pending.size) {
                    val grown = FloatArray(requiredLen.coerceAtLeast(pending.size * 2))
                    if (available > 0) {
                        System.arraycopy(pending, pendingHead, grown, 0, available)
                    }
                    pending = grown
                    pendingHead = 0
                    pendingLen = available
                } else if (pending.size - pendingLen < samples.size && pendingHead > 0) {
                    compactPending()
                }
                System.arraycopy(samples, 0, pending, pendingLen, samples.size)
                pendingLen += samples.size
            }
            val info = MediaCodec.BufferInfo()
            var sawInputEOS = false
            var sawOutputEOS = false

            // Resampling state across output buffers. We keep the last source
            // sample to interpolate across buffer boundaries.
            val resampler = LinearResampler(outputChannels)

            while (!sawOutputEOS) {
                if (cancelled.get()) break

                if (!sawInputEOS) {
                    val inputBufferIndex = codec.dequeueInputBuffer(TIMEOUT_US)
                    if (inputBufferIndex >= 0) {
                        val inputBuffer = codec.getInputBuffer(inputBufferIndex)
                        if (inputBuffer != null) {
                            val sampleSize = extractor.readSampleData(inputBuffer, 0)
                            val sampleTime = extractor.sampleTime
                            if (sampleSize < 0 || sampleTime > endTimeUs) {
                                codec.queueInputBuffer(
                                    inputBufferIndex,
                                    0,
                                    0,
                                    0,
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM
                                )
                                sawInputEOS = true
                            } else {
                                codec.queueInputBuffer(
                                    inputBufferIndex,
                                    0,
                                    sampleSize,
                                    sampleTime,
                                    0
                                )
                                extractor.advance()
                            }
                        }
                    }
                }

                val outputIndex = codec.dequeueOutputBuffer(info, TIMEOUT_US)
                if (outputIndex >= 0) {
                    val outputBuffer = codec.getOutputBuffer(outputIndex)
                    if (outputBuffer != null && info.size > 0) {
                        outputBuffer.position(info.offset)
                        outputBuffer.limit(info.offset + info.size)
                        val pcm = ByteArray(info.size)
                        outputBuffer.get(pcm)

                        val converted = pcmToFloat(
                            pcm,
                            sourceChannels,
                            outputChannels,
                            options.normalizeAudio
                        )
                        // SEEK_TO_CLOSEST_SYNC can land before the requested
                        // start (encoder priming on AAC/MP3, sync-frame
                        // granularity on lossy containers). Trim source-rate
                        // frames whose presentation time is before
                        // `targetStartUs` so the first emitted sample lines
                        // up with `startTimeMs`.
                        val bufferStartUs = info.presentationTimeUs
                        val trimmed: FloatArray = if (
                            targetStartUs > 0 &&
                            bufferStartUs in 0L until targetStartUs &&
                            converted.isNotEmpty()
                        ) {
                            val deltaUs = targetStartUs - bufferStartUs
                            val skipFrames = (
                                deltaUs.toDouble() * sourceSampleRate.toDouble() /
                                    1_000_000.0
                            ).toInt()
                            val totalFrames = converted.size / outputChannels
                            val actualSkip = minOf(skipFrames, totalFrames)
                            if (actualSkip >= totalFrames) {
                                FloatArray(0)
                            } else if (actualSkip > 0) {
                                val skipFloats = actualSkip * outputChannels
                                val out = FloatArray(converted.size - skipFloats)
                                System.arraycopy(
                                    converted,
                                    skipFloats,
                                    out,
                                    0,
                                    out.size
                                )
                                out
                            } else {
                                converted
                            }
                        } else {
                            converted
                        }
                        val resampled = resampler.process(
                            trimmed,
                            sourceSampleRate,
                            outputSampleRate
                        )
                        val remainingOutputSamples =
                            maxOutputSamples - emittedSamples - pendingAvailable().toLong()
                        val boundedResampled = when {
                            remainingOutputSamples <= 0L -> FloatArray(0)
                            resampled.size.toLong() > remainingOutputSamples -> {
                                val boundedSize = (
                                    remainingOutputSamples.toInt() / outputChannels
                                    ) * outputChannels
                                resampled.copyOf(boundedSize)
                            }
                            else -> resampled
                        }

                        appendPending(boundedResampled)

                        chunkLoop@ while (pendingAvailable() >= samplesPerChunk) {
                            if (cancelled.get()) break
                            val chunk = FloatArray(samplesPerChunk)
                            System.arraycopy(pending, pendingHead, chunk, 0, samplesPerChunk)
                            pendingHead += samplesPerChunk
                            if (pendingHead > pending.size / 2) {
                                compactPending()
                            }

                            val chunkDurationMs =
                                (chunk.size.toDouble() /
                                    (outputSampleRate.toDouble() * outputChannels.toDouble())) *
                                    1000.0
                            val startMs = rangeStartMs +
                                (emittedSamples.toDouble() /
                                    (outputSampleRate.toDouble() * outputChannels.toDouble())) *
                                    1000.0
                            emitChunk(
                                index = emittedChunks,
                                startTimeMs = startMs,
                                endTimeMs = startMs + chunkDurationMs,
                                startSample = emittedSamples / outputChannels,
                                sampleRate = outputSampleRate,
                                channels = outputChannels,
                                samples = chunk,
                                isFinal = false
                            )
                            emittedChunks += 1
                            emittedSamples += chunk.size
                            // Progress is elapsed decoded time within the
                            // requested range so `processedMs / durationMs`
                            // stays in [0, 1] regardless of `startTimeMs`.
                            // Chunk timestamps stay absolute (rangeStart +
                            // offset).
                            val elapsedMs = (emittedSamples.toDouble() /
                                (outputSampleRate.toDouble() *
                                    outputChannels.toDouble())) * 1000.0
                            emitProgress(
                                processedMs = elapsedMs,
                                durationMs = rangeDurationMs,
                                emittedChunks = emittedChunks
                            )
                            when (waitForAckOrCancel(emittedChunks - 1)) {
                                AckWaitResult.OK -> Unit
                                AckWaitResult.CANCELLED -> {
                                    cancelled.set(true)
                                    break@chunkLoop
                                }
                                AckWaitResult.TIMED_OUT -> {
                                    backpressureTimedOut = true
                                    break@chunkLoop
                                }
                            }
                        }
                    }
                    codec.releaseOutputBuffer(outputIndex, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        sawOutputEOS = true
                    }
                    if (backpressureTimedOut) {
                        break
                    }
                } else if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val newFormat = codec.outputFormat
                    // Codec output format is authoritative once decoding starts;
                    // the resampler is told the new source rate on its next call
                    // so the output rate (and chunk timestamps) stay correct.
                    if (newFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                        sourceSampleRate = newFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    }
                    if (newFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                        sourceChannels = newFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    }
                }
            }

            if (!cancelled.get() && !backpressureTimedOut) {
                val resamplerTail = resampler.flush()
                if (resamplerTail.isNotEmpty()) {
                    appendPending(resamplerTail)
                }
            }

            if (backpressureTimedOut) {
                emitError(
                    "ERR_AUDIO_STREAM_BACKPRESSURE_TIMEOUT",
                    "Timed out waiting for JS acknowledgement after ${options.backpressureTimeoutMs}ms"
                )
                return
            }

            if (cancelled.get()) {
                emitError("ERR_AUDIO_STREAM_CANCELLED", "Stream cancelled")
                emitComplete(
                    durationMs = rangeDurationMs,
                    sampleRate = outputSampleRate,
                    channels = outputChannels,
                    chunks = emittedChunks,
                    samples = emittedSamples,
                    cancelled = true
                )
                return
            }

            // Flush remainder as final chunk
            if (pendingAvailable() > 0) {
                val tail = FloatArray(pendingAvailable())
                System.arraycopy(pending, pendingHead, tail, 0, tail.size)
                val tailDurationMs =
                    (tail.size.toDouble() /
                        (outputSampleRate.toDouble() * outputChannels.toDouble())) *
                        1000.0
                val startMs = rangeStartMs +
                    (emittedSamples.toDouble() /
                        (outputSampleRate.toDouble() * outputChannels.toDouble())) *
                        1000.0
                emitChunk(
                    index = emittedChunks,
                    startTimeMs = startMs,
                    endTimeMs = startMs + tailDurationMs,
                    startSample = emittedSamples / outputChannels,
                    sampleRate = outputSampleRate,
                    channels = outputChannels,
                    samples = tail,
                    isFinal = true
                )
                emittedChunks += 1
                emittedSamples += tail.size
                // Mirror the per-chunk progress emission so consumers always
                // see a final `processedMs / durationMs ≈ 1.0` from
                // `onProgress`.
                val elapsedMs = (emittedSamples.toDouble() /
                    (outputSampleRate.toDouble() *
                        outputChannels.toDouble())) * 1000.0
                emitProgress(
                    processedMs = elapsedMs,
                    durationMs = rangeDurationMs,
                    emittedChunks = emittedChunks
                )
            } else {
                emitChunk(
                    index = emittedChunks,
                    startTimeMs = rangeStartMs +
                        (emittedSamples.toDouble() /
                            (outputSampleRate.toDouble() * outputChannels.toDouble())) *
                            1000.0,
                    endTimeMs = rangeStartMs +
                        (emittedSamples.toDouble() /
                            (outputSampleRate.toDouble() * outputChannels.toDouble())) *
                            1000.0,
                    startSample = emittedSamples / outputChannels,
                    sampleRate = outputSampleRate,
                    channels = outputChannels,
                    samples = FloatArray(0),
                    isFinal = true
                )
                emittedChunks += 1
            }

            emitComplete(
                durationMs = rangeDurationMs,
                sampleRate = outputSampleRate,
                channels = outputChannels,
                chunks = emittedChunks,
                samples = emittedSamples,
                cancelled = false
            )
        } catch (e: Exception) {
            LogUtils.e(TAG, "Decode failed: ${e.message}", e)
            emitError(
                "ERR_AUDIO_STREAM_DECODE_FAILED",
                e.message ?: "Unknown decode error"
            )
        } finally {
            try {
                codec?.stop()
            } catch (_: Exception) { /* noop */ }
            try {
                codec?.release()
            } catch (_: Exception) { /* noop */ }
            try {
                extractor.release()
            } catch (_: Exception) { /* noop */ }
            tempFile?.let { runCatching { it.delete() } }
        }
    }

    private data class ResolvedFile(val path: String, val tempFile: File?)

    private fun readMetadataDurationMs(path: String): Long {
        return try {
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(path)
                retriever
                    .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    ?.toLongOrNull()
                    ?: -1L
            } finally {
                retriever.release()
            }
        } catch (_: Exception) {
            -1L
        }
    }

    private fun resolveFilePath(uri: String): ResolvedFile? {
        if (uri.startsWith("/")) return ResolvedFile(uri, null)
        return try {
            val parsed = Uri.parse(uri)
            when (parsed.scheme) {
                "file" -> parsed.path?.let { ResolvedFile(it, null) }
                "content" -> {
                    // MediaExtractor needs a real file path; copy the content
                    // URI into the cache dir and remember the temp file so we
                    // can delete it in `finally` (otherwise every call leaks a
                    // copy of the source audio onto disk).
                    val temp = File.createTempFile(
                        "audiostream_${options.requestId}_",
                        null,
                        context.cacheDir
                    )
                    context.contentResolver.openInputStream(parsed)?.use { input ->
                        temp.outputStream().use { out -> input.copyTo(out) }
                    }
                    ResolvedFile(temp.absolutePath, temp)
                }
                null -> ResolvedFile(uri, null)
                else -> null
            }
        } catch (e: Exception) {
            LogUtils.e(TAG, "resolveFilePath failed: ${e.message}", e)
            null
        }
    }

    private fun pcmToFloat(
        pcm: ByteArray,
        sourceChannels: Int,
        targetChannels: Int,
        normalize: Boolean,
    ): FloatArray {
        if (pcm.isEmpty() || sourceChannels <= 0) return FloatArray(0)
        val buffer = ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN)
        val totalShorts = pcm.size / 2
        val srcFrames = totalShorts / sourceChannels
        val out = FloatArray(srcFrames * targetChannels)
        var outIdx = 0
        val tempFrame = FloatArray(sourceChannels)
        for (frame in 0 until srcFrames) {
            for (c in 0 until sourceChannels) {
                val s = buffer.short.toFloat() / 32768.0f
                val safe = if (s.isFinite()) s else 0f
                tempFrame[c] = if (normalize) {
                    when {
                        safe > 1f -> 1f
                        safe < -1f -> -1f
                        else -> safe
                    }
                } else {
                    safe
                }
            }
            when {
                sourceChannels == targetChannels -> {
                    for (c in 0 until targetChannels) {
                        out[outIdx++] = tempFrame[c]
                    }
                }
                targetChannels == 1 -> {
                    // Downmix average
                    var sum = 0f
                    for (c in 0 until sourceChannels) sum += tempFrame[c]
                    out[outIdx++] = sum / sourceChannels
                }
                sourceChannels == 1 -> {
                    // Upmix mono -> N (duplicate)
                    for (c in 0 until targetChannels) {
                        out[outIdx++] = tempFrame[0]
                    }
                }
                else -> {
                    // Drop or duplicate channels; for simplicity take first N or zero-pad.
                    for (c in 0 until targetChannels) {
                        out[outIdx++] = if (c < sourceChannels) tempFrame[c] else 0f
                    }
                }
            }
        }
        return out
    }

    private enum class AckWaitResult { OK, CANCELLED, TIMED_OUT }

    private fun waitForAckOrCancel(emittedIndex: Int): AckWaitResult {
        val deadlineMs = options.backpressureTimeoutMs
            ?.takeIf { it > 0 }
            ?.let { System.currentTimeMillis() + it }
        synchronized(ackLock) {
            while (true) {
                if (cancelled.get()) return AckWaitResult.CANCELLED
                val inFlight = emittedIndex - lastAckedIndex.get()
                if (inFlight < options.maxBufferedChunks) return AckWaitResult.OK
                val remainingMs = deadlineMs?.let { it - System.currentTimeMillis() }
                if (remainingMs != null && remainingMs <= 0L) {
                    return AckWaitResult.TIMED_OUT
                }
                ackLock.wait(minOf(50L, remainingMs ?: 50L))
            }
        }
    }

    private fun emitChunk(
        index: Int,
        startTimeMs: Double,
        endTimeMs: Double,
        startSample: Long,
        sampleRate: Int,
        channels: Int,
        samples: FloatArray,
        isFinal: Boolean,
    ) {
        // Pass FloatArray directly; expo-modules-core converts to JS array.
        val payload = bundleOf(
            "requestId" to options.requestId,
            "chunkIndex" to index,
            "startTimeMs" to startTimeMs,
            "endTimeMs" to endTimeMs,
            "startSample" to startSample,
            "sampleCount" to samples.size,
            "sampleRate" to sampleRate,
            "channels" to channels,
            "samples" to samples,
            "isFinal" to isFinal,
        )
        delegate.streamDecoderEmit(Constants.AUDIO_STREAM_CHUNK_EVENT, payload)
    }

    private fun emitProgress(
        processedMs: Double,
        durationMs: Double,
        emittedChunks: Int,
    ) {
        val progress = if (durationMs > 0) {
            (processedMs / durationMs).coerceIn(0.0, 1.0)
        } else {
            0.0
        }
        val payload = bundleOf(
            "requestId" to options.requestId,
            "processedMs" to processedMs,
            "durationMs" to durationMs,
            "progress" to progress,
            "emittedChunks" to emittedChunks,
        )
        delegate.streamDecoderEmit(Constants.AUDIO_STREAM_PROGRESS_EVENT, payload)
    }

    private fun emitComplete(
        durationMs: Double,
        sampleRate: Int,
        channels: Int,
        chunks: Int,
        samples: Long,
        cancelled: Boolean,
    ) {
        val payload = bundleOf(
            "requestId" to options.requestId,
            "durationMs" to durationMs,
            "sampleRate" to sampleRate,
            "channels" to channels,
            "chunks" to chunks,
            "samples" to samples,
            "cancelled" to cancelled,
        )
        delegate.streamDecoderEmit(Constants.AUDIO_STREAM_COMPLETE_EVENT, payload)
    }

    private fun emitError(code: String, message: String) {
        val payload = bundleOf(
            "requestId" to options.requestId,
            "code" to code,
            "message" to message,
        )
        delegate.streamDecoderEmit(Constants.AUDIO_STREAM_ERROR_EVENT, payload)
    }
}

/**
 * Per-stream linear resampler keyed by output channel count. Maintains the
 * last source frame across buffer boundaries so resampling is continuous.
 */
private class LinearResampler(private val channels: Int) {
    private var lastSrcFrame: FloatArray? = null
    private var fractional: Double = 0.0
    private var lastSourceRate: Int? = null
    private var lastTargetRate: Int? = null
    private var canFlushLastFrame = false

    fun process(input: FloatArray, sourceRate: Int, targetRate: Int): FloatArray {
        if (input.isEmpty() || channels <= 0) return FloatArray(0)
        val srcFrames = input.size / channels
        if (srcFrames <= 0) return FloatArray(0)

        if (lastSourceRate != null &&
            (lastSourceRate != sourceRate || lastTargetRate != targetRate)
        ) {
            reset()
        }
        lastSourceRate = sourceRate
        lastTargetRate = targetRate

        if (sourceRate == targetRate) {
            stashLastFrame(input, srcFrames)
            fractional = 0.0
            canFlushLastFrame = false
            return input
        }

        val ratio = sourceRate.toDouble() / targetRate.toDouble()
        val previousFrame = lastSrcFrame
        val totalSrcFrames = srcFrames + if (previousFrame != null) 1 else 0
        if (totalSrcFrames < 2) {
            // Not enough to interpolate yet; stash and return empty.
            stashLastFrame(input, srcFrames)
            canFlushLastFrame = true
            return FloatArray(0)
        }

        // Build virtual stream: [previousFrame?, input...].
        val virtualLen = totalSrcFrames
        val outFrames = ceil(((virtualLen - 1) - fractional) / ratio)
            .toInt()
            .coerceAtLeast(0)
        // Add one frame of slack for floating-point boundary rounding; trim
        // below if the conservative capacity was not used.
        val out = FloatArray((outFrames + 1) * channels)
        var outIdx = 0
        var srcPos = fractional
        while (srcPos < virtualLen - 1) {
            val i = srcPos.toInt()
            val frac = (srcPos - i).toFloat()
            for (c in 0 until channels) {
                val a = sampleAt(i, c, previousFrame, input)
                val b = sampleAt(i + 1, c, previousFrame, input)
                out[outIdx++] = a + (b - a) * frac
            }
            srcPos += ratio
        }
        fractional = srcPos - (virtualLen - 1)

        // Stash last source frame for the next call. The interpolation loop
        // intentionally stops before the final frame so that it can interpolate
        // across the next decoder buffer; flush() emits this tail at EOS.
        stashLastFrame(input, srcFrames)
        canFlushLastFrame = true

        return if (outIdx == out.size) out else out.copyOf(outIdx)
    }

    fun flush(): FloatArray {
        val tail = if (canFlushLastFrame) {
            lastSrcFrame?.copyOf() ?: FloatArray(0)
        } else {
            FloatArray(0)
        }
        reset()
        return tail
    }

    private fun reset() {
        lastSrcFrame = null
        fractional = 0.0
        canFlushLastFrame = false
    }

    private fun stashLastFrame(input: FloatArray, srcFrames: Int) {
        lastSrcFrame = FloatArray(channels).also { dst ->
            System.arraycopy(input, (srcFrames - 1) * channels, dst, 0, channels)
        }
    }

    private fun sampleAt(
        frame: Int,
        channel: Int,
        previous: FloatArray?,
        input: FloatArray,
    ): Float {
        return if (previous != null) {
            if (frame == 0) {
                previous[channel]
            } else {
                input[(frame - 1) * channels + channel]
            }
        } else {
            input[frame * channels + channel]
        }
    }
}
