package net.siteed.moonshine

import ai.moonshine.voice.IntentMatch
import ai.moonshine.voice.JNI
import ai.moonshine.voice.Transcript
import ai.moonshine.voice.TranscriberOption

internal data class MoonshineIntentMatchNative(
  val triggerPhrase: String,
  val similarity: Float
)

internal object MoonshineDirectJni {
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
      sampleRate
    )
  }

  fun clearIntents(intentRecognizerHandle: Int): Int {
    ensureLoaded()
    return JNI.moonshineClearIntents(intentRecognizerHandle)
  }

  fun createIntentRecognizer(
    modelPath: String,
    modelArch: Int,
    modelVariant: String?
  ): Int {
    ensureLoaded()
    return JNI.moonshineCreateIntentRecognizer(modelPath, modelArch, modelVariant)
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
    JNI.moonshineFreeIntentRecognizer(intentRecognizerHandle)
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
    val matches: Array<IntentMatch>? =
      JNI.moonshineGetClosestIntents(intentRecognizerHandle, utterance, threshold)
    if (matches == null) {
      throw RuntimeException("moonshineGetClosestIntents failed")
    }
    if (matches.isEmpty()) {
      return null
    }
    // Upstream contract (core/moonshine-c-api.h: moonshine_get_closest_intents):
    // returned array is sorted by descending similarity, so index 0 is the top.
    val top = matches[0]
    return MoonshineIntentMatchNative(
      triggerPhrase = top.canonicalPhrase ?: "",
      similarity = top.similarity
    )
  }

  fun getIntentCount(intentRecognizerHandle: Int): Int {
    ensureLoaded()
    return JNI.moonshineGetIntentCount(intentRecognizerHandle)
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
      modelArch,
      options
    )
  }

  fun registerIntent(intentRecognizerHandle: Int, triggerPhrase: String): Int {
    ensureLoaded()
    // (handle, canonicalPhrase, embedding=null → auto-compute, priority=0).
    return JNI.moonshineRegisterIntent(intentRecognizerHandle, triggerPhrase, null, 0)
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
    return JNI.moonshineUnregisterIntent(intentRecognizerHandle, triggerPhrase)
  }

  private fun ensureLoaded() {
    JNI.ensureLibraryLoaded()
  }
}
