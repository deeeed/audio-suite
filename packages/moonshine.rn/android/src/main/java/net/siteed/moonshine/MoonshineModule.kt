package net.siteed.moonshine

import ai.moonshine.voice.JNI
import ai.moonshine.voice.SpeakerSpan
import ai.moonshine.voice.Transcript
import ai.moonshine.voice.TranscriberOption
import ai.moonshine.voice.TranscriptLine
import ai.moonshine.voice.WordTiming
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import android.net.Uri
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

private data class ParsedStreamId(
  val transcriberId: String,
  val handle: Int
)

private data class OfflineTranscriptionJob(
  val streamHandle: Int,
  var cancelEventEmitted: Boolean = false,
  var cancelRequested: Boolean = false
)

private data class TranscriberState(
  val handle: Int,
  val defaultStreamHandle: Int,
  val includeAudioDataInLines: Boolean,
  var activeOfflineJob: OfflineTranscriptionJob? = null,
  val activeStreamHandles: MutableSet<Int> = mutableSetOf(),
  val streamLines: ConcurrentHashMap<Int, LinkedHashMap<Long, TranscriptLine>> = ConcurrentHashMap(),
  val completedLineIds: ConcurrentHashMap<Int, MutableSet<Long>> = ConcurrentHashMap()
)

class MoonshineModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private fun resolveModelRootPath(rawPath: String, label: String): File {
    val trimmed = rawPath.trim()
    if (trimmed.isEmpty()) {
      throw IllegalArgumentException("Moonshine ${label} is required")
    }

    val candidate = if (trimmed.startsWith("file://", ignoreCase = true)) {
      val parsed = Uri.parse(trimmed)
      parsed.path?.let(::File) ?: File(trimmed.removePrefix("file://"))
    } else {
      File(trimmed)
    }

    if (!candidate.exists()) {
      throw IllegalArgumentException("Moonshine ${label} does not exist: $rawPath")
    }

    return candidate
  }

  companion object {
    const val EVENT_NAME = "MoonshineTranscriptEvent"
    const val NAME = "Moonshine"
    private const val DEFAULT_INTENT_THRESHOLD = 0.7f
  }

  private val transcriberStates = ConcurrentHashMap<String, TranscriberState>()
  private val intentRecognizerHandles = ConcurrentHashMap<String, Int>()
  private val intentThresholds = ConcurrentHashMap<String, Float>()
  private val transcriberCounter = AtomicInteger(1)
  private var defaultTranscriberId: String? = null

  override fun getName(): String = NAME

  override fun invalidate() {
    releaseAllInternal()
    super.invalidate()
  }

  @ReactMethod
  fun addAudio(sampleRate: Int, samples: ReadableArray, promise: Promise) {
    withDefaultTranscriber(promise) { transcriberId, state ->
      addAudioToTrackedStream(
        transcriberId = transcriberId,
        state = state,
        streamHandle = state.defaultStreamHandle,
        sampleRate = sampleRate,
        audio = readableArrayToFloatArray(samples)
      )
      promise.resolve(successMap())
    }
  }

  @ReactMethod
  fun addAudioForTranscriber(
    transcriberId: String,
    sampleRate: Int,
    samples: ReadableArray,
    promise: Promise
  ) {
    withTranscriber(transcriberId, promise) { resolvedId, state ->
      addAudioToTrackedStream(
        transcriberId = resolvedId,
        state = state,
        streamHandle = state.defaultStreamHandle,
        sampleRate = sampleRate,
        audio = readableArrayToFloatArray(samples)
      )
      promise.resolve(successMap())
    }
  }

  @ReactMethod
  fun addAudioToStream(
    streamId: String,
    sampleRate: Int,
    samples: ReadableArray,
    promise: Promise
  ) {
    val parsedStreamId = try {
      parseStreamId(streamId)
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
      return
    }
    addAudioToStreamForTranscriber(
      parsedStreamId.transcriberId,
      streamId,
      sampleRate,
      samples,
      promise
    )
  }

  @ReactMethod
  fun addAudioToStreamForTranscriber(
    transcriberId: String,
    streamId: String,
    sampleRate: Int,
    samples: ReadableArray,
    promise: Promise
  ) {
    withTranscriber(transcriberId, promise) { resolvedId, state ->
      val streamHandle = parseStreamHandleForTranscriber(resolvedId, streamId)
      addAudioToTrackedStream(
        transcriberId = resolvedId,
        state = state,
        streamHandle = streamHandle,
        sampleRate = sampleRate,
        audio = readableArrayToFloatArray(samples)
      )
      promise.resolve(successMap())
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by NativeEventEmitter.
  }

  @ReactMethod
  fun clearIntents(intentRecognizerId: String, promise: Promise) {
    try {
      val handle = parseIntentRecognizerId(intentRecognizerId)
      requireNoError(
        MoonshineDirectJni.clearIntents(handle),
        "clear intents"
      )
      promise.resolve(successMap())
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun createIntentRecognizer(config: ReadableMap, promise: Promise) {
    try {
      val modelPath = config.getString("modelPath")
      val modelRoot = resolveModelRootPath(modelPath ?: "", "intent model path")
      val modelArch = resolveIntentModelArch(config)
      val modelVariant =
        if (config.hasKey("modelVariant") && !config.isNull("modelVariant")) {
          config.getString("modelVariant")
        } else {
          null
        }
      val threshold =
        if (config.hasKey("threshold") && !config.isNull("threshold")) {
          config.getDouble("threshold").toFloat()
        } else {
          DEFAULT_INTENT_THRESHOLD
        }

      val handle = MoonshineDirectJni.createIntentRecognizer(
        modelRoot.absolutePath,
        modelArch,
        modelVariant
      )
      requireNonNegativeHandle(handle, "create intent recognizer")
      val intentId = intentRecognizerIdForHandle(handle)
      intentRecognizerHandles[intentId] = handle
      intentThresholds[intentId] = threshold

      val result = successMap()
      result.putString("intentRecognizerId", intentId)
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun createStream(promise: Promise) {
    withDefaultTranscriber(promise) { transcriberId, state ->
      val streamId = createStreamForState(transcriberId, state)
      val result = successMap()
      result.putString("streamId", streamId)
      promise.resolve(result)
    }
  }

  @ReactMethod
  fun createStreamForTranscriber(transcriberId: String, promise: Promise) {
    withTranscriber(transcriberId, promise) { resolvedId, state ->
      val streamId = createStreamForState(resolvedId, state)
      val result = successMap()
      result.putString("streamId", streamId)
      promise.resolve(result)
    }
  }

  @ReactMethod
  fun createTranscriberFromAssets(config: ReadableMap, promise: Promise) {
    createTranscriber(config, promise, assignAsDefault = false) { options, modelArch ->
      val assetPath = config.getString("assetPath")
      if (assetPath.isNullOrBlank()) {
        throw IllegalArgumentException("Moonshine assetPath is required")
      }
      loadTranscriberFromAssets(assetPath, modelArch, options)
    }
  }

  @ReactMethod
  fun createTranscriberFromFiles(config: ReadableMap, promise: Promise) {
    createTranscriber(config, promise, assignAsDefault = false) { options, modelArch ->
      val modelPath = config.getString("modelPath")
      val modelRoot = resolveModelRootPath(modelPath ?: "", "model path")
      MoonshineDirectJni.loadTranscriberFromFiles(modelRoot.absolutePath, modelArch, options)
    }
  }

  @ReactMethod
  fun createTranscriberFromMemory(config: ReadableMap, promise: Promise) {
    createTranscriber(config, promise, assignAsDefault = false) { options, modelArch ->
      val modelData = requireArray(config, "modelData")
      if (modelData.size() != 3) {
        throw IllegalArgumentException("Moonshine modelData must contain exactly 3 binary parts")
      }
      MoonshineDirectJni.loadTranscriberFromMemory(
        readableArrayToByteArray(requireNestedArray(modelData, 0)),
        readableArrayToByteArray(requireNestedArray(modelData, 1)),
        readableArrayToByteArray(requireNestedArray(modelData, 2)),
        modelArch,
        options
      )
    }
  }

  @ReactMethod
  fun errorToString(code: Int, promise: Promise) {
    promise.resolve(MoonshineDirectJni.errorToString(code))
  }

  @ReactMethod
  fun getIntentCount(intentRecognizerId: String, promise: Promise) {
    try {
      val handle = parseIntentRecognizerId(intentRecognizerId)
      val count = MoonshineDirectJni.getIntentCount(handle)
      if (count < 0) {
        throw IllegalStateException(
          "Failed to get Moonshine intent count: ${MoonshineDirectJni.errorToString(count)}"
        )
      }
      promise.resolve(count)
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun getIntentThreshold(intentRecognizerId: String, promise: Promise) {
    try {
      parseIntentRecognizerId(intentRecognizerId)
      val threshold = intentThresholds[intentRecognizerId] ?: DEFAULT_INTENT_THRESHOLD
      promise.resolve(threshold.toDouble())
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun getVersion(promise: Promise) {
    promise.resolve(MoonshineDirectJni.getVersion())
  }

  @ReactMethod
  fun initialize(config: ReadableMap, promise: Promise) {
    loadFromFiles(config, promise)
  }

  @ReactMethod
  fun loadFromAssets(config: ReadableMap, promise: Promise) {
    createTranscriber(config, promise, assignAsDefault = true) { options, modelArch ->
      val assetPath = config.getString("assetPath")
      if (assetPath.isNullOrBlank()) {
        throw IllegalArgumentException("Moonshine assetPath is required")
      }
      loadTranscriberFromAssets(assetPath, modelArch, options)
    }
  }

  @ReactMethod
  fun loadFromFiles(config: ReadableMap, promise: Promise) {
    createTranscriber(config, promise, assignAsDefault = true) { options, modelArch ->
      val modelPath = config.getString("modelPath")
      val modelRoot = resolveModelRootPath(modelPath ?: "", "model path")
      MoonshineDirectJni.loadTranscriberFromFiles(modelRoot.absolutePath, modelArch, options)
    }
  }

  @ReactMethod
  fun loadFromMemory(config: ReadableMap, promise: Promise) {
    createTranscriber(config, promise, assignAsDefault = true) { options, modelArch ->
      val modelData = requireArray(config, "modelData")
      if (modelData.size() != 3) {
        throw IllegalArgumentException("Moonshine modelData must contain exactly 3 binary parts")
      }
      MoonshineDirectJni.loadTranscriberFromMemory(
        readableArrayToByteArray(requireNestedArray(modelData, 0)),
        readableArrayToByteArray(requireNestedArray(modelData, 1)),
        readableArrayToByteArray(requireNestedArray(modelData, 2)),
        modelArch,
        options
      )
    }
  }

  @ReactMethod
  fun processUtterance(intentRecognizerId: String, utterance: String, promise: Promise) {
    try {
      val handle = parseIntentRecognizerId(intentRecognizerId)
      val threshold = intentThresholds[intentRecognizerId] ?: DEFAULT_INTENT_THRESHOLD
      val match = MoonshineDirectJni.getClosestIntent(handle, utterance, threshold)
      val result = successMap()
      result.putBoolean("matched", match != null)
      if (match != null) {
        val matchMap = Arguments.createMap()
        matchMap.putString("triggerPhrase", match.triggerPhrase)
        matchMap.putString("utterance", utterance)
        matchMap.putDouble("similarity", match.similarity.toDouble())
        result.putMap("match", matchMap)
      }
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun registerIntent(intentRecognizerId: String, triggerPhrase: String, promise: Promise) {
    try {
      if (triggerPhrase.isBlank()) {
        throw IllegalArgumentException("Moonshine intent triggerPhrase is required")
      }
      val handle = parseIntentRecognizerId(intentRecognizerId)
      requireNoError(
        MoonshineDirectJni.registerIntent(handle, triggerPhrase),
        "register intent"
      )
      promise.resolve(successMap())
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun release(promise: Promise) {
    defaultTranscriberId?.let { releaseTranscriberInternal(it) }
    val result = Arguments.createMap()
    result.putBoolean("released", true)
    promise.resolve(result)
  }

  @ReactMethod
  fun releaseIntentRecognizer(intentRecognizerId: String, promise: Promise) {
    try {
      val handle = parseIntentRecognizerId(intentRecognizerId)
      MoonshineDirectJni.freeIntentRecognizer(handle)
      intentRecognizerHandles.remove(intentRecognizerId)
      intentThresholds.remove(intentRecognizerId)
      promise.resolve(successMap())
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun releaseTranscriber(transcriberId: String, promise: Promise) {
    try {
      val released = releaseTranscriberInternal(transcriberId)
      val result = Arguments.createMap()
      result.putBoolean("released", released)
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    // Required by NativeEventEmitter.
  }

  @ReactMethod
  fun removeStream(streamId: String, promise: Promise) {
    val parsedStreamId = try {
      parseStreamId(streamId)
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
      return
    }
    removeStreamForTranscriber(parsedStreamId.transcriberId, streamId, promise)
  }

  @ReactMethod
  fun removeStreamForTranscriber(transcriberId: String, streamId: String, promise: Promise) {
    withTranscriber(transcriberId, promise) { resolvedId, state ->
      val streamHandle = parseStreamHandleForTranscriber(resolvedId, streamId)
      if (streamHandle == state.defaultStreamHandle) {
        throw IllegalArgumentException("Moonshine default stream cannot be removed")
      }
      MoonshineDirectJni.freeStream(state.handle, streamHandle)
      state.activeStreamHandles.remove(streamHandle)
      releaseStreamState(state, streamHandle)
      promise.resolve(successMap())
    }
  }

  @ReactMethod
  fun setIntentThreshold(intentRecognizerId: String, threshold: Double, promise: Promise) {
    try {
      parseIntentRecognizerId(intentRecognizerId)
      intentThresholds[intentRecognizerId] = threshold.toFloat()
      promise.resolve(successMap())
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun start(promise: Promise) {
    withDefaultTranscriber(promise) { transcriberId, state ->
      requireNoError(MoonshineDirectJni.startStream(state.handle, state.defaultStreamHandle), "start stream")
      promise.resolve(successMap())
    }
  }

  @ReactMethod
  fun startStream(streamId: String, promise: Promise) {
    val parsedStreamId = try {
      parseStreamId(streamId)
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
      return
    }
    startStreamForTranscriber(parsedStreamId.transcriberId, streamId, promise)
  }

  @ReactMethod
  fun startStreamForTranscriber(transcriberId: String, streamId: String, promise: Promise) {
    withTranscriber(transcriberId, promise) { resolvedId, state ->
      val streamHandle = parseStreamHandleForTranscriber(resolvedId, streamId)
      requireNoError(MoonshineDirectJni.startStream(state.handle, streamHandle), "start stream")
      promise.resolve(successMap())
    }
  }

  @ReactMethod
  fun startTranscriber(transcriberId: String, promise: Promise) {
    withTranscriber(transcriberId, promise) { _, state ->
      requireNoError(MoonshineDirectJni.startStream(state.handle, state.defaultStreamHandle), "start stream")
      promise.resolve(successMap())
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    withDefaultTranscriber(promise) { transcriberId, state ->
      stopAndFlushStream(transcriberId, state, state.defaultStreamHandle)
      promise.resolve(successMap())
    }
  }

  @ReactMethod
  fun stopStream(streamId: String, promise: Promise) {
    val parsedStreamId = try {
      parseStreamId(streamId)
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
      return
    }
    stopStreamForTranscriber(parsedStreamId.transcriberId, streamId, promise)
  }

  @ReactMethod
  fun stopStreamForTranscriber(transcriberId: String, streamId: String, promise: Promise) {
    withTranscriber(transcriberId, promise) { resolvedId, state ->
      val streamHandle = parseStreamHandleForTranscriber(resolvedId, streamId)
      stopAndFlushStream(resolvedId, state, streamHandle)
      promise.resolve(successMap())
    }
  }

  @ReactMethod
  fun stopTranscriber(transcriberId: String, promise: Promise) {
    withTranscriber(transcriberId, promise) { resolvedId, state ->
      stopAndFlushStream(resolvedId, state, state.defaultStreamHandle)
      promise.resolve(successMap())
    }
  }

  @ReactMethod
  fun cancelCurrentTranscriptionForTranscriber(transcriberId: String, promise: Promise) {
    withTranscriber(transcriberId, promise) { _, state ->
      val cancelled = state.activeOfflineJob != null
      state.activeOfflineJob?.cancelRequested = true
      val result = successMap()
      result.putBoolean("cancelled", cancelled)
      promise.resolve(result)
    }
  }

  @ReactMethod
  fun transcribeFromSamples(
    sampleRate: Int,
    samples: ReadableArray,
    options: ReadableMap?,
    promise: Promise
  ) {
    withDefaultTranscriber(promise) { transcriberId, state ->
      transcribeFromSamplesInternal(
        transcriberId = transcriberId,
        state = state,
        sampleRate = sampleRate,
        samples = readableArrayToFloatArray(samples),
        options = options,
        promise = promise
      )
    }
  }

  @ReactMethod
  fun transcribeFromSamplesForTranscriber(
    transcriberId: String,
    sampleRate: Int,
    samples: ReadableArray,
    options: ReadableMap?,
    promise: Promise
  ) {
    withTranscriber(transcriberId, promise) { resolvedId, state ->
      transcribeFromSamplesInternal(
        transcriberId = resolvedId,
        state = state,
        sampleRate = sampleRate,
        samples = readableArrayToFloatArray(samples),
        options = options,
        promise = promise
      )
    }
  }

  @ReactMethod
  fun transcribeWithoutStreaming(
    sampleRate: Int,
    samples: ReadableArray,
    promise: Promise
  ) {
    withDefaultTranscriber(promise) { transcriberId, state ->
      transcribeWithoutStreamingInternal(
        transcriberId,
        state,
        sampleRate,
        readableArrayToFloatArray(samples),
        promise
      )
    }
  }

  @ReactMethod
  fun transcribeWithoutStreamingForTranscriber(
    transcriberId: String,
    sampleRate: Int,
    samples: ReadableArray,
    promise: Promise
  ) {
    withTranscriber(transcriberId, promise) { resolvedId, state ->
      transcribeWithoutStreamingInternal(
        resolvedId,
        state,
        sampleRate,
        readableArrayToFloatArray(samples),
        promise
      )
    }
  }

  @ReactMethod
  fun unregisterIntent(intentRecognizerId: String, triggerPhrase: String, promise: Promise) {
    try {
      val handle = parseIntentRecognizerId(intentRecognizerId)
      requireNoError(
        MoonshineDirectJni.unregisterIntent(handle, triggerPhrase),
        "unregister intent"
      )
      promise.resolve(successMap())
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
    }
  }

  private fun addAudioToTrackedStream(
    transcriberId: String,
    state: TranscriberState,
    streamHandle: Int,
    sampleRate: Int,
    audio: FloatArray
  ) {
    requireNoError(
      MoonshineDirectJni.addAudioToStream(state.handle, streamHandle, audio, sampleRate),
      "add audio to stream"
    )
    val transcript = MoonshineDirectJni.transcribeStream(state.handle, streamHandle, 0)
      ?: throw IllegalStateException("Moonshine stream transcription returned no transcript")
    notifyFromTranscript(transcriberId, state, transcript, streamHandle)
  }

  private fun buildLineMap(line: TranscriptLine, includeAudioDataInLines: Boolean): WritableMap {
    val result = Arguments.createMap()
    result.putString("lineId", line.id.toString())
    result.putString("text", line.text ?: "")
    result.putBoolean("isFinal", line.isComplete)
    result.putBoolean("isNew", line.isNew)
    result.putBoolean("isUpdated", line.isUpdated)
    result.putDouble("startedAtMs", (line.startTime * 1000).toDouble())
    result.putDouble("durationMs", (line.duration * 1000).toDouble())
    if (line.isComplete) {
      result.putDouble(
        "completedAtMs",
        ((line.startTime + line.duration) * 1000).toDouble()
      )
    }
    result.putBoolean("hasTextChanged", line.hasTextChanged)
    val speaker = dominantSpeakerSpan(line)
    result.putBoolean("hasSpeakerId", speaker != null)
    if (speaker != null) {
      result.putString("speakerId", speaker.speakerId.toString())
      result.putInt("speakerIndex", speaker.speakerIndex)
    }
    result.putInt("lastTranscriptionLatencyMs", line.lastTranscriptionLatencyMs)
    if (includeAudioDataInLines && line.audioData != null) {
      result.putArray("audioData", buildAudioArray(line.audioData))
    }
    if (line.words != null) {
      result.putArray("words", buildWordsArray(line.words))
    }
    return result
  }

  private fun buildTranscriptionResult(state: TranscriberState, streamHandle: Int): WritableMap {
    val linesForStream = state.streamLines[streamHandle]?.values?.toList().orEmpty()
    val text = linesForStream.joinToString(" ") { it.text.orEmpty().trim() }.trim()
    val linesArray = Arguments.createArray()
    linesForStream.forEach { linesArray.pushMap(buildLineMap(it, state.includeAudioDataInLines)) }

    val result = Arguments.createMap()
    result.putString("text", text)
    result.putArray("lines", linesArray)
    return result
  }

  private fun buildTranscriptionResult(
    state: TranscriberState,
    transcript: Transcript
  ): WritableMap {
    val text = transcript.text().trim()
    val linesArray = Arguments.createArray()
    transcript.lines.orEmpty().forEach { line ->
      linesArray.pushMap(buildLineMap(line, state.includeAudioDataInLines))
    }
    val result = Arguments.createMap()
    result.putString("text", text)
    result.putArray("lines", linesArray)
    return result
  }

  private fun buildAudioArray(audioData: FloatArray): WritableArray {
    val array = Arguments.createArray()
    audioData.forEach { sample ->
      array.pushDouble(sample.toDouble())
    }
    return array
  }

  private fun buildTranscriberOptions(config: ReadableMap): Array<TranscriberOption> {
    val options = mutableListOf<TranscriberOption>()
    val includeAudioData = readIncludeAudioData(config)
    // `includeAudioData` is the public RN switch for returning per-line PCM.
    // The upstream native core defaults `return_audio_data` to true, which makes
    // long streaming transcripts retain each VAD segment's FloatArray even when
    // RN suppresses `line.audioData` in emitted maps. Keep the native retention
    // policy aligned with the JS contract and default it off for long sessions.
    if (config.hasKey("options") && !config.isNull("options")) {
      val nativeOptions = config.getMap("options")
      nativeOptions?.let {
        if (it.hasKey("identifySpeakers") && !it.isNull("identifySpeakers")) {
          options.add(
            TranscriberOption(
              "identify_speakers",
              it.getBoolean("identifySpeakers").toString()
            )
          )
        }
        if (it.hasKey("logApiCalls") && !it.isNull("logApiCalls")) {
          options.add(TranscriberOption("log_api_calls", it.getBoolean("logApiCalls").toString()))
        }
        if (it.hasKey("logOrtRuns") && !it.isNull("logOrtRuns")) {
          options.add(TranscriberOption("log_ort_run", it.getBoolean("logOrtRuns").toString()))
        }
        if (it.hasKey("logOutputText") && !it.isNull("logOutputText")) {
          options.add(
            TranscriberOption(
              "log_output_text",
              it.getBoolean("logOutputText").toString()
            )
          )
        }
        if (it.hasKey("maxTokensPerSecond") && !it.isNull("maxTokensPerSecond")) {
          options.add(
            TranscriberOption(
              "max_tokens_per_second",
              it.getDouble("maxTokensPerSecond").toString()
            )
          )
        }
        if (it.hasKey("saveInputWavPath") && !it.isNull("saveInputWavPath")) {
          options.add(TranscriberOption("save_input_wav_path", it.getString("saveInputWavPath")))
        }
        if (
          it.hasKey("speakerIdClusterThreshold") &&
          !it.isNull("speakerIdClusterThreshold")
        ) {
          options.add(
            TranscriberOption(
              "speaker_id_cluster_threshold",
              it.getDouble("speakerIdClusterThreshold").toString()
            )
          )
        }
        if (it.hasKey("vadThreshold") && !it.isNull("vadThreshold")) {
          options.add(
            TranscriberOption("vad_threshold", it.getDouble("vadThreshold").toString())
          )
        }
        if (it.hasKey("vadHopSize") && !it.isNull("vadHopSize")) {
          options.add(
            TranscriberOption("vad_hop_size", it.getDouble("vadHopSize").toInt().toString())
          )
        }
        if (
          it.hasKey("vadMaxSegmentDurationMs") &&
          !it.isNull("vadMaxSegmentDurationMs")
        ) {
          options.add(
            TranscriberOption(
              "vad_max_segment_duration",
              (it.getDouble("vadMaxSegmentDurationMs") / 1000.0).toString()
            )
          )
        }
        if (
          it.hasKey("vadLookBehindSampleCount") &&
          !it.isNull("vadLookBehindSampleCount")
        ) {
          options.add(
            TranscriberOption(
              "vad_look_behind_sample_count",
              it.getDouble("vadLookBehindSampleCount").toInt().toString()
            )
          )
        }
        if (it.hasKey("vadWindowDurationMs") && !it.isNull("vadWindowDurationMs")) {
          options.add(
            TranscriberOption(
              "vad_window_duration",
              (it.getDouble("vadWindowDurationMs") / 1000.0).toString()
            )
          )
        }
        if (it.hasKey("wordTimestamps") && !it.isNull("wordTimestamps")) {
          options.add(
            TranscriberOption(
              "word_timestamps",
              it.getBoolean("wordTimestamps").toString()
            )
          )
        }
      }
    }
    if (config.hasKey("updateIntervalMs") && !config.isNull("updateIntervalMs")) {
      options.add(
        TranscriberOption(
          "transcription_interval",
          (config.getDouble("updateIntervalMs") / 1000.0).toString()
        )
      )
    }
    if (config.hasKey("transcriberOptions") && !config.isNull("transcriberOptions")) {
      val transcriberOptions = config.getArray("transcriberOptions")
      if (transcriberOptions != null) {
        for (index in 0 until transcriberOptions.size()) {
          val option = transcriberOptions.getMap(index) ?: continue
          val name = option.getString("name")
          if (name.isNullOrBlank()) {
            continue
          }
          val value = when {
            !option.hasKey("value") || option.isNull("value") -> ""
            else -> {
              val dynamicValue = option.getDynamic("value")
              when (dynamicValue.type) {
                ReadableType.Boolean -> option.getBoolean("value").toString()
                ReadableType.Number -> option.getDouble("value").toString()
                ReadableType.String -> option.getString("value") ?: ""
                else -> ""
              }
            }
          }
          options.add(TranscriberOption(name, value))
        }
      }
    }
    options.add(TranscriberOption("return_audio_data", includeAudioData.toString()))
    return options.toTypedArray()
  }

  private fun buildWordsArray(words: List<WordTiming>): WritableArray {
    val array = Arguments.createArray()
    words.forEach { word ->
      val map = Arguments.createMap()
      map.putString("word", word.word)
      map.putDouble("startTimeMs", (word.start * 1000).toDouble())
      map.putDouble("endTimeMs", (word.end * 1000).toDouble())
      map.putDouble("confidence", word.confidence.toDouble())
      array.pushMap(map)
    }
    return array
  }

  private fun createStreamForState(transcriberId: String, state: TranscriberState): String {
    val streamHandle = MoonshineDirectJni.createStream(state.handle)
    requireNonNegativeHandle(streamHandle, "create stream")
    state.activeStreamHandles.add(streamHandle)
    registerStreamState(state, streamHandle)
    return streamIdForHandle(transcriberId, streamHandle)
  }

  private fun createTranscriber(
    config: ReadableMap,
    promise: Promise,
    assignAsDefault: Boolean,
    loader: (Array<TranscriberOption>, Int) -> Int
  ) {
    try {
      if (assignAsDefault) {
        defaultTranscriberId?.let { releaseTranscriberInternal(it) }
      }

      val transcriberOptions = buildTranscriberOptions(config)
      val modelArch = resolveModelArch(config)
      val handle = loader(transcriberOptions, modelArch)
      requireNonNegativeHandle(handle, "load transcriber")

      val loadedDefaultStreamHandle = MoonshineDirectJni.createStream(handle)
      requireNonNegativeHandle(loadedDefaultStreamHandle, "create default stream")

      val transcriberId = nextTranscriberId()
      val state = TranscriberState(
        handle = handle,
        defaultStreamHandle = loadedDefaultStreamHandle,
        includeAudioDataInLines = readIncludeAudioData(config)
      )
      registerStreamState(state, loadedDefaultStreamHandle)
      transcriberStates[transcriberId] = state
      if (assignAsDefault) {
        defaultTranscriberId = transcriberId
      }

      val result = successMap()
      result.putString("transcriberId", transcriberId)
      promise.resolve(result)
    } catch (error: Throwable) {
      promise.resolve(errorResult(error.message ?: "Moonshine load failed"))
    }
  }

  private fun readIncludeAudioData(config: ReadableMap): Boolean {
    return config.hasKey("includeAudioData") &&
      !config.isNull("includeAudioData") &&
      config.getBoolean("includeAudioData")
  }

  private fun emitEvent(
    type: String,
    transcriberId: String,
    streamHandle: Int,
    includeAudioDataInLines: Boolean,
    line: TranscriptLine? = null,
    error: String? = null
  ) {
    val params = Arguments.createMap()
    params.putString("type", type)
    params.putString("transcriberId", transcriberId)
    params.putString("streamId", streamIdForHandle(transcriberId, streamHandle))
    if (line != null) {
      params.putMap("line", buildLineMap(line, includeAudioDataInLines))
    }
    if (!error.isNullOrBlank()) {
      params.putString("error", error)
    }
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_NAME, params)
  }

  private fun emitOfflineProgress(
    transcriberId: String,
    streamHandle: Int,
    processedSampleCount: Int,
    totalSampleCount: Int,
    sampleRate: Int
  ) {
    if (sampleRate <= 0) {
      return
    }

    val totalDurationMs =
      if (totalSampleCount <= 0) {
        0.0
      } else {
        (totalSampleCount.toDouble() * 1000.0) / sampleRate
      }
    val processedDurationMs =
      if (totalSampleCount <= 0) {
        totalDurationMs
      } else {
        (processedSampleCount.toDouble() * 1000.0) / sampleRate
      }
    val progress =
      if (totalSampleCount <= 0) {
        1.0
      } else {
        (processedSampleCount.toDouble() / totalSampleCount).coerceIn(0.0, 1.0)
      }

    val params = Arguments.createMap()
    params.putString("type", "transcriptionProgress")
    params.putString("transcriberId", transcriberId)
    params.putString("streamId", streamIdForHandle(transcriberId, streamHandle))
    params.putDouble("progress", progress)
    params.putDouble("processedDurationMs", processedDurationMs)
    params.putDouble("totalDurationMs", totalDurationMs)
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_NAME, params)
  }

  private fun nextTranscriberId(): String = "transcriber-${transcriberCounter.getAndIncrement()}"

  private fun notifyFromTranscript(
    transcriberId: String,
    state: TranscriberState,
    transcript: Transcript,
    streamHandle: Int
  ) {
    val completedForStream = state.completedLineIds.getOrPut(streamHandle) { mutableSetOf() }
    transcript.lines.orEmpty().forEach { line ->
      if (line.isNew) {
        onTranscriptLineEvent("lineStarted", transcriberId, state, streamHandle, line)
      }
      if (line.isUpdated && !line.isNew && !line.isComplete) {
        onTranscriptLineEvent("lineUpdated", transcriberId, state, streamHandle, line)
      }
      if (line.hasTextChanged) {
        onTranscriptLineEvent("lineTextChanged", transcriberId, state, streamHandle, line)
      }
      if (line.isComplete && line.isUpdated && completedForStream.add(line.id)) {
        onTranscriptLineEvent("lineCompleted", transcriberId, state, streamHandle, line)
      }
    }
  }

  private fun onTranscriptLineEvent(
    type: String,
    transcriberId: String,
    state: TranscriberState,
    streamHandle: Int,
    line: TranscriptLine
  ) {
    val linesForStream = state.streamLines.getOrPut(streamHandle) { LinkedHashMap() }
    linesForStream[line.id] = line
    emitEvent(type, transcriberId, streamHandle, state.includeAudioDataInLines, line)
  }

  private fun parseIntentRecognizerId(intentRecognizerId: String): Int {
    return intentRecognizerHandles[intentRecognizerId]
      ?: throw IllegalArgumentException(
        "Moonshine intent recognizer is not active: $intentRecognizerId"
      )
  }

  private fun parseStreamHandleForTranscriber(transcriberId: String, streamId: String): Int {
    val parsedStreamId = parseStreamId(streamId)
    if (parsedStreamId.transcriberId != transcriberId) {
      throw IllegalArgumentException(
        "Moonshine stream $streamId does not belong to transcriber $transcriberId"
      )
    }
    val state = transcriberStates[transcriberId]
      ?: throw IllegalArgumentException(
        "Moonshine transcriber is not initialized: $transcriberId"
      )
    val isKnownStream =
      parsedStreamId.handle == state.defaultStreamHandle ||
        state.activeStreamHandles.contains(parsedStreamId.handle)
    if (!isKnownStream) {
      throw IllegalArgumentException("Moonshine stream is not active: $streamId")
    }
    return parsedStreamId.handle
  }

  private fun parseStreamId(streamId: String): ParsedStreamId {
    if (streamId.contains(":stream-")) {
      val parts = streamId.split(":stream-", limit = 2)
      val transcriberId = parts.getOrNull(0).orEmpty()
      val handle = parts.getOrNull(1)?.toIntOrNull()
      if (transcriberId.isBlank() || handle == null) {
        throw IllegalArgumentException("Invalid Moonshine stream id: $streamId")
      }
      return ParsedStreamId(transcriberId, handle)
    }

    val fallbackTranscriberId = defaultTranscriberId
      ?: throw IllegalArgumentException("Moonshine default transcriber is not initialized")
    val handle = streamId.removePrefix("stream-").toIntOrNull()
      ?: throw IllegalArgumentException("Invalid Moonshine stream id: $streamId")
    return ParsedStreamId(fallbackTranscriberId, handle)
  }

  private fun readableArrayToByteArray(data: ReadableArray): ByteArray {
    val result = ByteArray(data.size())
    for (index in 0 until data.size()) {
      result[index] = data.getDouble(index).toInt().toByte()
    }
    return result
  }

  private fun readableArrayToFloatArray(samples: ReadableArray): FloatArray {
    val result = FloatArray(samples.size())
    for (index in 0 until samples.size()) {
      result[index] = samples.getDouble(index).toFloat()
    }
    return result
  }

  private fun copyAssetTree(assetPath: String, destination: File) {
    val assetManager = reactApplicationContext.assets
    val entries = assetManager.list(assetPath)?.filter { it.isNotBlank() }.orEmpty()

    if (entries.isEmpty()) {
      destination.parentFile?.mkdirs()
      assetManager.open(assetPath).use { input ->
        FileOutputStream(destination).use { output ->
          input.copyTo(output)
        }
      }
      return
    }

    if (destination.exists() && !destination.isDirectory) {
      destination.delete()
    }
    destination.mkdirs()
    entries.forEach { child ->
      copyAssetTree("$assetPath/$child", File(destination, child))
    }
  }

  private fun loadTranscriberFromAssets(
    assetPath: String,
    modelArch: Int,
    options: Array<TranscriberOption>
  ): Int {
    val trimmedAssetPath = assetPath.trim().trim('/')
    if (trimmedAssetPath.isBlank()) {
      throw IllegalArgumentException("Moonshine assetPath is required")
    }

    // Materialize the whole asset directory so streaming bundles with multiple
    // .ort files and configs can use the same file-based JNI loader path.
    val cacheKey = trimmedAssetPath.replace(Regex("[^A-Za-z0-9._-]+"), "_")
    val targetDir = File(reactApplicationContext.cacheDir, "moonshine-assets/$cacheKey")
    copyAssetTree(trimmedAssetPath, targetDir)
    return MoonshineDirectJni.loadTranscriberFromFiles(
      targetDir.absolutePath,
      modelArch,
      options
    )
  }

  private fun registerStreamState(state: TranscriberState, streamHandle: Int) {
    state.streamLines[streamHandle] = LinkedHashMap()
    state.completedLineIds[streamHandle] = mutableSetOf()
  }

  private fun releaseAllInternal() {
    transcriberStates.keys.toList().forEach { releaseTranscriberInternal(it) }
    intentRecognizerHandles.values.toList().forEach { intentRecognizerHandle ->
      try {
        MoonshineDirectJni.freeIntentRecognizer(intentRecognizerHandle)
      } catch (_: Throwable) {
      }
    }
    intentRecognizerHandles.clear()
    intentThresholds.clear()
  }

  private fun releaseStreamState(state: TranscriberState, streamHandle: Int) {
    state.streamLines.remove(streamHandle)
    state.completedLineIds.remove(streamHandle)
  }

  private fun releaseTranscriberInternal(transcriberId: String): Boolean {
    val state = transcriberStates.remove(transcriberId) ?: return false
    state.activeStreamHandles.toList().forEach { streamHandle ->
      try {
        MoonshineDirectJni.freeStream(state.handle, streamHandle)
      } catch (_: Throwable) {
      }
    }
    state.activeStreamHandles.clear()

    try {
      MoonshineDirectJni.freeStream(state.handle, state.defaultStreamHandle)
    } catch (_: Throwable) {
    }

    try {
      MoonshineDirectJni.freeTranscriber(state.handle)
    } catch (_: Throwable) {
    }

    state.streamLines.clear()
    state.completedLineIds.clear()
    if (defaultTranscriberId == transcriberId) {
      defaultTranscriberId = null
    }
    return true
  }

  private fun beginOfflineTranscription(state: TranscriberState, streamHandle: Int): OfflineTranscriptionJob {
    if (state.activeOfflineJob != null) {
      throw IllegalStateException("Moonshine offline transcription is already running")
    }
    return OfflineTranscriptionJob(streamHandle = streamHandle).also {
      state.activeOfflineJob = it
    }
  }

  private fun clearOfflineTranscription(state: TranscriberState, streamHandle: Int) {
    if (state.activeOfflineJob?.streamHandle == streamHandle) {
      state.activeOfflineJob = null
    }
  }

  private fun throwIfOfflineTranscriptionCancelled(
    transcriberId: String,
    state: TranscriberState,
    job: OfflineTranscriptionJob
  ) {
    if (!job.cancelRequested) {
      return
    }

    if (!job.cancelEventEmitted) {
      job.cancelEventEmitted = true
      emitEvent(
        "transcriptionCancelled",
        transcriberId,
        job.streamHandle,
        state.includeAudioDataInLines
      )
    }

    throw IllegalStateException("Moonshine transcription cancelled for transcriber $transcriberId")
  }

  private fun cleanupOfflineTemporaryStream(state: TranscriberState, streamHandle: Int) {
    clearOfflineTranscription(state, streamHandle)
    try {
      MoonshineDirectJni.stopStream(state.handle, streamHandle)
    } catch (_: Throwable) {
    }
    try {
      MoonshineDirectJni.freeStream(state.handle, streamHandle)
    } catch (_: Throwable) {
    }
    state.activeStreamHandles.remove(streamHandle)
    releaseStreamState(state, streamHandle)
  }

  private fun requireArray(config: ReadableMap, key: String): ReadableArray {
    return config.getArray(key)
      ?: throw IllegalArgumentException("Moonshine $key is required")
  }

  private fun requireNestedArray(data: ReadableArray, index: Int): ReadableArray {
    return data.getArray(index)
      ?: throw IllegalArgumentException("Moonshine modelData[$index] is required")
  }

  private fun dominantSpeakerSpan(line: TranscriptLine): SpeakerSpan? {
    val spans = line.speakerSpans ?: return null
    if (spans.isEmpty()) {
      return null
    }
    return spans.reduce { best, span ->
      if (span.duration > best.duration) span else best
    }
  }

  private fun requireNoError(code: Int, operation: String) {
    if (code != JNI.MOONSHINE_ERROR_NONE) {
      throw IllegalStateException(
        "Failed to $operation: ${MoonshineDirectJni.errorToString(code)} ($code)"
      )
    }
  }

  private fun requireNonNegativeHandle(handle: Int, operation: String) {
    if (handle < 0) {
      throw IllegalStateException(
        "Failed to $operation: ${MoonshineDirectJni.errorToString(handle)} ($handle)"
      )
    }
  }

  private fun resolveIntentModelArch(config: ReadableMap): Int {
    val rawValue = when {
      config.hasKey("modelArch") && !config.isNull("modelArch") -> config.getDynamic("modelArch")
      else -> return 0
    }

    return when (rawValue.type.name) {
      "Number" -> rawValue.asInt()
      "String" -> when (rawValue.asString()) {
        "gemma-300m" -> 0
        else -> throw IllegalArgumentException("Unsupported Moonshine intent modelArch: ${rawValue.asString()}")
      }
      else -> throw IllegalArgumentException("Unsupported Moonshine intent modelArch value")
    }
  }

  private fun resolveModelArch(config: ReadableMap): Int {
    val rawValue = when {
      config.hasKey("modelArch") && !config.isNull("modelArch") -> config.getDynamic("modelArch")
      else -> throw IllegalArgumentException("Moonshine modelArch is required")
    }

    return when (rawValue.type.name) {
      "Number" -> rawValue.asInt()
      "String" -> when (rawValue.asString()) {
        "tiny" -> JNI.MOONSHINE_MODEL_ARCH_TINY
        "base" -> JNI.MOONSHINE_MODEL_ARCH_BASE
        "tiny-streaming" -> JNI.MOONSHINE_MODEL_ARCH_TINY_STREAMING
        "base-streaming" -> JNI.MOONSHINE_MODEL_ARCH_BASE_STREAMING
        "small-streaming" -> JNI.MOONSHINE_MODEL_ARCH_SMALL_STREAMING
        "medium-streaming" -> JNI.MOONSHINE_MODEL_ARCH_MEDIUM_STREAMING
        else -> throw IllegalArgumentException("Unsupported Moonshine modelArch: ${rawValue.asString()}")
      }
      else -> throw IllegalArgumentException("Unsupported Moonshine modelArch value")
    }
  }

  private fun stopAndFlushStream(
    transcriberId: String,
    state: TranscriberState,
    streamHandle: Int
  ) {
    requireNoError(MoonshineDirectJni.stopStream(state.handle, streamHandle), "stop stream")
    val transcript = MoonshineDirectJni.transcribeStream(
      state.handle,
      streamHandle,
      JNI.MOONSHINE_FLAG_FORCE_UPDATE
    )
      ?: throw IllegalStateException("Moonshine stream flush returned no transcript")
    notifyFromTranscript(transcriberId, state, transcript, streamHandle)
  }

  private fun streamIdForHandle(transcriberId: String, handle: Int): String {
    return "$transcriberId:stream-$handle"
  }

  private fun intentRecognizerIdForHandle(handle: Int): String = "intent-$handle"

  private fun successMap(): WritableMap {
    val result = Arguments.createMap()
    result.putBoolean("success", true)
    return result
  }

  private fun errorResult(message: String): WritableMap {
    val result = Arguments.createMap()
    result.putBoolean("success", false)
    result.putString("error", message)
    return result
  }

  private fun transcribeFromSamplesInternal(
    transcriberId: String,
    state: TranscriberState,
    sampleRate: Int,
    samples: FloatArray,
    options: ReadableMap?,
    promise: Promise
  ) {
    try {
      val audio = samples
      val chunkDurationMs = options
        ?.takeIf { it.hasKey("chunkDurationMs") && !it.isNull("chunkDurationMs") }
        ?.getDouble("chunkDurationMs")
        ?.toInt()
        ?: 200
      val hasProgressOptions =
        options?.hasKey("progress") == true &&
          !options.isNull("progress") &&
          options.getType("progress") == ReadableType.Map
      val progressOptions =
        if (hasProgressOptions) options?.getMap("progress") else null
      val progressEnabled = progressOptions != null
      val progressIntervalMs =
        if (
          progressEnabled &&
          progressOptions != null &&
          progressOptions.hasKey("intervalMs") &&
          !progressOptions.isNull("intervalMs")
        ) {
          progressOptions.getDouble("intervalMs").coerceAtLeast(0.0)
        } else {
          0.0
        }
      val streamHandle = MoonshineDirectJni.createStream(state.handle)
      requireNonNegativeHandle(streamHandle, "create stream")
      state.activeStreamHandles.add(streamHandle)
      registerStreamState(state, streamHandle)
      val job = try {
        beginOfflineTranscription(state, streamHandle)
      } catch (error: Throwable) {
        cleanupOfflineTemporaryStream(state, streamHandle)
        throw error
      }
      requireNoError(MoonshineDirectJni.startStream(state.handle, streamHandle), "start stream")

      val samplesPerChunk = ((sampleRate * chunkDurationMs) / 1000.0).toInt().coerceAtLeast(1)
      val totalSampleCount = audio.size
      var lastProgressEmitMs =
        if (progressEnabled) {
          emitOfflineProgress(
            transcriberId = transcriberId,
            streamHandle = streamHandle,
            processedSampleCount = 0,
            totalSampleCount = totalSampleCount,
            sampleRate = sampleRate
          )
          0.0
        } else {
          -1.0
        }
      fun processNextChunk(startIndex: Int) {
        try {
          throwIfOfflineTranscriptionCancelled(transcriberId, state, job)
          if (startIndex >= audio.size) {
            stopAndFlushStream(transcriberId, state, streamHandle)
            val result = buildTranscriptionResult(state, streamHandle)
            cleanupOfflineTemporaryStream(state, streamHandle)
            promise.resolve(result)
            return
          }

          val endIndex = minOf(startIndex + samplesPerChunk, audio.size)
          addAudioToTrackedStream(
            transcriberId = transcriberId,
            state = state,
            streamHandle = streamHandle,
            sampleRate = sampleRate,
            audio = audio.copyOfRange(startIndex, endIndex)
          )

          if (progressEnabled) {
            val processedDurationMs =
              if (totalSampleCount <= 0) {
                0.0
              } else {
                (endIndex.toDouble() * 1000.0) / sampleRate
              }
            if (
              lastProgressEmitMs < 0.0 ||
              processedDurationMs - lastProgressEmitMs >= progressIntervalMs ||
              endIndex >= totalSampleCount
            ) {
              emitOfflineProgress(
                transcriberId = transcriberId,
                streamHandle = streamHandle,
                processedSampleCount = endIndex,
                totalSampleCount = totalSampleCount,
                sampleRate = sampleRate
              )
              lastProgressEmitMs = processedDurationMs
            }
          }

          reactApplicationContext.runOnNativeModulesQueueThread {
            processNextChunk(endIndex)
          }
        } catch (error: Throwable) {
          cleanupOfflineTemporaryStream(state, streamHandle)
          val errorCode =
            if (error.message?.startsWith("Moonshine transcription cancelled") == true) {
              "MOONSHINE_TRANSCRIPTION_CANCELLED"
            } else {
              "MOONSHINE_TRANSCRIBE_ERROR"
            }
          promise.reject(errorCode, error.message, error)
        }
      }

      reactApplicationContext.runOnNativeModulesQueueThread {
        processNextChunk(0)
      }
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_TRANSCRIBE_ERROR", error.message, error)
    }
  }

  private fun transcribeWithoutStreamingInternal(
    transcriberId: String,
    state: TranscriberState,
    sampleRate: Int,
    samples: FloatArray,
    promise: Promise
  ) {
    val options = Arguments.createMap().apply {
      putInt("chunkDurationMs", 200)
    }
    transcribeFromSamplesInternal(
      transcriberId = transcriberId,
      state = state,
      sampleRate = sampleRate,
      samples = samples,
      options = options,
      promise = promise
    )
  }

  private fun withDefaultTranscriber(
    promise: Promise,
    block: (String, TranscriberState) -> Unit
  ) {
    val currentDefaultTranscriberId = defaultTranscriberId
    if (currentDefaultTranscriberId == null) {
      promise.reject("MOONSHINE_NOT_INITIALIZED", "Moonshine is not initialized")
      return
    }
    withTranscriber(currentDefaultTranscriberId, promise, block)
  }

  private fun withTranscriber(
    transcriberId: String,
    promise: Promise,
    block: (String, TranscriberState) -> Unit
  ) {
    val state = transcriberStates[transcriberId]
    if (state == null) {
      promise.reject(
        "MOONSHINE_NOT_INITIALIZED",
        "Moonshine transcriber is not initialized: $transcriberId"
      )
      return
    }

    try {
      block(transcriberId, state)
    } catch (error: Throwable) {
      promise.reject("MOONSHINE_ERROR", error.message, error)
    }
  }
}
