package net.siteed.moonshine

import ai.moonshine.voice.JNI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class MoonshineIntentRecognizerStoreTest {
  private class FakeModel : MoonshineEmbeddingModel {
    var closed = false
    var failEmbeddingFor: String? = null
    var failDistanceForValue: Float? = null
    val embeddings = mutableMapOf<String, FloatArray>()

    override fun calculateEmbedding(text: String): FloatArray {
      if (text == failEmbeddingFor) throw IllegalArgumentException("embedding failed")
      return embeddings[text] ?: error("Missing fake embedding for $text")
    }

    override fun distance(left: FloatArray, right: FloatArray): Float {
      if (right.first() == failDistanceForValue) throw IllegalStateException("distance failed")
      return right.first()
    }

    override fun close() {
      closed = true
    }
  }

  @Test
  fun registersMatchesUnregistersAndClearsIntents() {
    val model = FakeModel().apply {
      embeddings["play music"] = floatArrayOf(0.85f)
      embeddings["stop music"] = floatArrayOf(0.95f)
      embeddings["please stop"] = floatArrayOf(0.1f)
    }
    val store = MoonshineIntentRecognizerStore { _, _, _ -> model }
    val handle = store.create("/model", 1, null)

    assertTrue(handle > 0)
    assertEquals(JNI.MOONSHINE_ERROR_NONE, store.register(handle, "play music"))
    assertEquals(JNI.MOONSHINE_ERROR_NONE, store.register(handle, "stop music"))
    assertEquals(2, store.count(handle))
    assertEquals("stop music", store.closest(handle, "please stop", 0.9f)?.triggerPhrase)
    assertNull(store.closest(handle, "please stop", 0.96f))

    assertEquals(JNI.MOONSHINE_ERROR_NONE, store.unregister(handle, "stop music"))
    assertEquals(1, store.count(handle))
    assertEquals(JNI.MOONSHINE_ERROR_NONE, store.clear(handle))
    assertEquals(0, store.count(handle))
    assertNull(store.closest(handle, "please stop", 0f))

    store.release(handle)
    assertTrue(model.closed)
    assertEquals(JNI.MOONSHINE_ERROR_INVALID_HANDLE, store.count(handle))
  }

  @Test
  fun reportsInvalidHandlesAndModelFailures() {
    val creationFailure = MoonshineIntentRecognizerStore { _, _, _ ->
      throw IllegalArgumentException("bad model")
    }
    assertEquals(JNI.MOONSHINE_ERROR_INVALID_ARGUMENT, creationFailure.create("bad", 1, null))

    val model = FakeModel().apply {
      embeddings["valid"] = floatArrayOf(0.8f)
      embeddings["utterance"] = floatArrayOf(0.1f)
      failEmbeddingFor = "invalid"
    }
    val store = MoonshineIntentRecognizerStore { _, _, _ -> model }
    val handle = store.create("/model", 1, null)

    assertEquals(JNI.MOONSHINE_ERROR_INVALID_HANDLE, store.register(-1, "valid"))
    assertEquals(JNI.MOONSHINE_ERROR_INVALID_HANDLE, store.unregister(-1, "valid"))
    assertEquals(JNI.MOONSHINE_ERROR_INVALID_HANDLE, store.clear(-1))
    assertEquals(JNI.MOONSHINE_ERROR_INVALID_HANDLE, store.count(-1))
    assertThrows(IllegalArgumentException::class.java) { store.closest(-1, "utterance", 0f) }
    assertEquals(JNI.MOONSHINE_ERROR_INVALID_ARGUMENT, store.register(handle, "invalid"))

    assertEquals(JNI.MOONSHINE_ERROR_NONE, store.register(handle, "valid"))
    model.failEmbeddingFor = "utterance"
    assertThrows(RuntimeException::class.java) { store.closest(handle, "utterance", 0f) }
  }

  @Test
  fun skipsFailedDistancesAndKeepsFirstPhraseOnTies() {
    val model = FakeModel().apply {
      embeddings["broken"] = floatArrayOf(0.7f)
      embeddings["first"] = floatArrayOf(0.9f)
      embeddings["second"] = floatArrayOf(0.9f)
      embeddings["utterance"] = floatArrayOf(0.1f)
      failDistanceForValue = 0.7f
    }
    val store = MoonshineIntentRecognizerStore { _, _, _ -> model }
    val handle = store.create("/model", 1, null)
    store.register(handle, "broken")
    store.register(handle, "first")
    store.register(handle, "second")

    val match = store.closest(handle, "utterance", 0.9f)
    assertEquals("first", match?.triggerPhrase)
    assertEquals(0.9f, match?.similarity)
    assertFalse(model.closed)
  }
}
