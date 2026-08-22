package net.siteed.moonshine

import ai.moonshine.voice.EmbeddingModel
import ai.moonshine.voice.JNI
import ai.moonshine.voice.Transcript
import ai.moonshine.voice.TranscriberOption
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

internal data class MoonshineIntentMatchNative(
  val triggerPhrase: String,
  val similarity: Float
)

internal object MoonshineDirectJni {
  private class IntentRecognizerState(val model: EmbeddingModel) {
    private val phrases = LinkedHashMap<String, FloatArray>()

    @Synchronized
    fun register(triggerPhrase: String): Int {
      return try {
        phrases[triggerPhrase] = model.calculateEmbedding(triggerPhrase)
        JNI.MOONSHINE_ERROR_NONE
      } catch (_: RuntimeException) {
        JNI.MOONSHINE_ERROR_INVALID_ARGUMENT
      }
    }

    @Synchronized
    fun unregister(triggerPhrase: String): Int {
      phrases.remove(triggerPhrase)
      return JNI.MOONSHINE_ERROR_NONE
    }

    @Synchronized
    fun clear(): Int {
      phrases.clear()
      return JNI.MOONSHINE_ERROR_NONE
    }

    @Synchronized
    fun count(): Int = phrases.size

    @Synchronized
    fun closest(utterance: String, threshold: Float): MoonshineIntentMatchNative? {
      if (phrases.isEmpty()) {
        return null
      }
      val utteranceEmbedding = try {
        model.calculateEmbedding(utterance)
      } catch (_: RuntimeException) {
        throw RuntimeException("moonshineCalculateEmbedding failed")
      }
      var bestPhrase: String? = null
      var bestScore = Float.NEGATIVE_INFINITY
      for ((phrase, embedding) in phrases) {
        val score = try {
          model.distance(utteranceEmbedding, embedding)
        } catch (_: RuntimeException) {
          continue
        }
        if (score > bestScore) {
          bestScore = score
          bestPhrase = phrase
        }
      }
      if (bestPhrase == null || bestScore < threshold) {
        return null
      }
      return MoonshineIntentMatchNative(
        triggerPhrase = bestPhrase,
        similarity = bestScore
      )
    }

    fun close() {
      model.close()
    }
  }

  private val intentRecognizers = ConcurrentHashMap<Int, IntentRecognizerState>()
  private val nextIntentHandle = AtomicInteger(1)

  fun addAudioToStream(
    transcriberHandle: Int,
    streamHandle: Int,
    audioData: FloatArray,
    sampleRate: Int
  ): Int {
    ensureLoaded()
    return JNI.moonshineAddAudioToStream(
      transcriberHandle,
      streamHandle,
      audioData,
      sampleRate,
      0
    )
  }

  fun clearIntents(intentRecognizerHandle: Int): Int {
    ensureLoaded()
    val state = intentRecognizers[intentRecognizerHandle]
      ?: return JNI.MOONSHINE_ERROR_INVALID_HANDLE
    return state.clear()
  }

  fun createIntentRecognizer(
    modelPath: String,
    modelArch: Int,
    modelVariant: String?
  ): Int {
    ensureLoaded()
    return try {
      val model = EmbeddingModel(modelPath, modelArch, modelVariant)
      val handle = nextIntentHandle.getAndIncrement()
      intentRecognizers[handle] = IntentRecognizerState(model)
      handle
    } catch (_: RuntimeException) {
      JNI.MOONSHINE_ERROR_INVALID_ARGUMENT
    }
  }

  fun createStream(transcriberHandle: Int): Int {
    ensureLoaded()
    return JNI.moonshineCreateStream(transcriberHandle, 0)
  }

  fun errorToString(code: Int): String {
    ensureLoaded()
    return JNI.moonshineErrorToString(code)
  }

  fun freeIntentRecognizer(intentRecognizerHandle: Int) {
    ensureLoaded()
    intentRecognizers.remove(intentRecognizerHandle)?.close()
  }

  fun freeStream(transcriberHandle: Int, streamHandle: Int) {
    ensureLoaded()
    JNI.moonshineFreeStream(transcriberHandle, streamHandle)
  }

  fun freeTranscriber(transcriberHandle: Int) {
    ensureLoaded()
    JNI.moonshineFreeTranscriber(transcriberHandle)
  }

  fun getClosestIntent(
    intentRecognizerHandle: Int,
    utterance: String,
    threshold: Float
  ): MoonshineIntentMatchNative? {
    ensureLoaded()
    val state = intentRecognizers[intentRecognizerHandle]
      ?: throw RuntimeException(
        "Failed to get closest intent: ${JNI.moonshineErrorToString(JNI.MOONSHINE_ERROR_INVALID_HANDLE)}"
      )
    return state.closest(utterance, threshold)
  }

  fun getIntentCount(intentRecognizerHandle: Int): Int {
    ensureLoaded()
    val state = intentRecognizers[intentRecognizerHandle]
      ?: return JNI.MOONSHINE_ERROR_INVALID_HANDLE
    return state.count()
  }

  fun getVersion(): Int {
    ensureLoaded()
    return JNI.moonshineGetVersion()
  }

  fun loadTranscriberFromFiles(
    path: String,
    modelArch: Int,
    options: Array<TranscriberOption>
  ): Int {
    ensureLoaded()
    return JNI.moonshineLoadTranscriberFromFiles(path, modelArch, options)
  }

  fun loadTranscriberFromMemory(
    encoderModelData: ByteArray,
    decoderModelData: ByteArray,
    tokenizerData: ByteArray,
    modelArch: Int,
    options: Array<TranscriberOption>
  ): Int {
    ensureLoaded()
    return JNI.moonshineLoadTranscriberFromMemory(
      encoderModelData,
      decoderModelData,
      tokenizerData,
      null,
      modelArch,
      options
    )
  }

  fun registerIntent(intentRecognizerHandle: Int, triggerPhrase: String): Int {
    ensureLoaded()
    val state = intentRecognizers[intentRecognizerHandle]
      ?: return JNI.MOONSHINE_ERROR_INVALID_HANDLE
    return state.register(triggerPhrase)
  }

  fun startStream(transcriberHandle: Int, streamHandle: Int): Int {
    ensureLoaded()
    return JNI.moonshineStartStream(transcriberHandle, streamHandle)
  }

  fun stopStream(transcriberHandle: Int, streamHandle: Int): Int {
    ensureLoaded()
    return JNI.moonshineStopStream(transcriberHandle, streamHandle)
  }

  fun transcribeStream(transcriberHandle: Int, streamHandle: Int, flags: Int): Transcript? {
    ensureLoaded()
    return JNI.moonshineTranscribeStream(transcriberHandle, streamHandle, flags)
  }

  fun transcribeWithoutStreaming(
    transcriberHandle: Int,
    audioData: FloatArray,
    sampleRate: Int,
    flags: Int = 0
  ): Transcript? {
    ensureLoaded()
    return JNI.moonshineTranscribeWithoutStreaming(
      transcriberHandle,
      audioData,
      sampleRate,
      flags
    )
  }

  fun unregisterIntent(intentRecognizerHandle: Int, triggerPhrase: String): Int {
    ensureLoaded()
    val state = intentRecognizers[intentRecognizerHandle]
      ?: return JNI.MOONSHINE_ERROR_INVALID_HANDLE
    return state.unregister(triggerPhrase)
  }

  private fun ensureLoaded() {
    JNI.ensureLibraryLoaded()
  }
}
