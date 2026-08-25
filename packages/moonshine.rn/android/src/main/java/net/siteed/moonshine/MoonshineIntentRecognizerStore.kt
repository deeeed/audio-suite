package net.siteed.moonshine

import ai.moonshine.voice.EmbeddingModel
import ai.moonshine.voice.JNI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

internal interface MoonshineEmbeddingModel {
  fun calculateEmbedding(text: String): FloatArray
  fun distance(left: FloatArray, right: FloatArray): Float
  fun close()
}

private class UpstreamMoonshineEmbeddingModel(
  modelPath: String,
  modelArch: Int,
  modelVariant: String?
) : MoonshineEmbeddingModel {
  private val model = EmbeddingModel(modelPath, modelArch, modelVariant)

  override fun calculateEmbedding(text: String): FloatArray = model.calculateEmbedding(text)

  override fun distance(left: FloatArray, right: FloatArray): Float =
    model.distance(left, right)

  override fun close() = model.close()
}

internal class MoonshineIntentRecognizerStore(
  private val modelFactory: (String, Int, String?) -> MoonshineEmbeddingModel =
    { modelPath, modelArch, modelVariant ->
      UpstreamMoonshineEmbeddingModel(modelPath, modelArch, modelVariant)
    }
) {
  private class State(private val model: MoonshineEmbeddingModel) {
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
      return MoonshineIntentMatchNative(bestPhrase, bestScore)
    }

    @Synchronized
    fun close() = model.close()
  }

  private val states = ConcurrentHashMap<Int, State>()
  private val nextHandle = AtomicInteger(1)

  fun create(modelPath: String, modelArch: Int, modelVariant: String?): Int {
    return try {
      val state = State(modelFactory(modelPath, modelArch, modelVariant))
      val handle = nextHandle.getAndIncrement()
      states[handle] = state
      handle
    } catch (_: RuntimeException) {
      JNI.MOONSHINE_ERROR_INVALID_ARGUMENT
    }
  }

  fun register(handle: Int, triggerPhrase: String): Int =
    states[handle]?.register(triggerPhrase) ?: JNI.MOONSHINE_ERROR_INVALID_HANDLE

  fun unregister(handle: Int, triggerPhrase: String): Int =
    states[handle]?.unregister(triggerPhrase) ?: JNI.MOONSHINE_ERROR_INVALID_HANDLE

  fun clear(handle: Int): Int =
    states[handle]?.clear() ?: JNI.MOONSHINE_ERROR_INVALID_HANDLE

  fun count(handle: Int): Int =
    states[handle]?.count() ?: JNI.MOONSHINE_ERROR_INVALID_HANDLE

  fun closest(handle: Int, utterance: String, threshold: Float): MoonshineIntentMatchNative? {
    val state = states[handle]
      ?: throw IllegalArgumentException("Moonshine intent recognizer handle is invalid: $handle")
    return state.closest(utterance, threshold)
  }

  fun release(handle: Int) {
    states.remove(handle)?.close()
  }
}
