package net.siteed.sherpaonnx

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap

class SherpaOnnxModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "SherpaOnnx"
    }

    private val implementation = SherpaOnnxImpl(reactContext)

    override fun getName(): String = NAME

    @ReactMethod fun initTts(config: ReadableMap, promise: Promise) = implementation.initTts(config, promise)
    @ReactMethod fun generateTts(config: ReadableMap, promise: Promise) = implementation.generateTts(config, promise)
    @ReactMethod fun stopTts(promise: Promise) = implementation.stopTts(promise)
    @ReactMethod fun releaseTts(promise: Promise) = implementation.releaseTts(promise)
    @ReactMethod fun initAsr(config: ReadableMap, promise: Promise) = implementation.initAsr(config, promise)
    @ReactMethod fun recognizeFromSamples(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) = implementation.recognizeFromSamples(sampleRate, audioBuffer, promise)
    @ReactMethod fun recognizeFromFile(filePath: String, promise: Promise) = implementation.recognizeFromFile(filePath, promise)
    @ReactMethod fun releaseAsr(promise: Promise) = implementation.releaseAsr(promise)
    @ReactMethod fun createAsrOnlineStream(promise: Promise) = implementation.createAsrOnlineStream(promise)
    @ReactMethod fun acceptAsrOnlineWaveform(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) = implementation.acceptAsrOnlineWaveform(sampleRate, audioBuffer, promise)
    @ReactMethod fun isAsrOnlineEndpoint(promise: Promise) = implementation.isAsrOnlineEndpoint(promise)
    @ReactMethod fun getAsrOnlineResult(promise: Promise) = implementation.getAsrOnlineResult(promise)
    @ReactMethod fun finishAsrOnlineInput(promise: Promise) = implementation.finishAsrOnlineInput(promise)
    @ReactMethod fun resetAsrOnlineStream(promise: Promise) = implementation.resetAsrOnlineStream(promise)
    @ReactMethod fun initAudioTagging(config: ReadableMap, promise: Promise) = implementation.initAudioTagging(config, promise)
    @ReactMethod fun processAndComputeAudioTagging(filePath: String, promise: Promise) = implementation.processAndComputeAudioTagging(filePath, -1, promise)
    @ReactMethod fun processAndComputeAudioSamples(sampleRate: Int, samples: ReadableArray, promise: Promise) = implementation.processAudioSamples(sampleRate, samples, -1, promise)
    @ReactMethod fun releaseAudioTagging(promise: Promise) = implementation.releaseAudioTagging(promise)
    @ReactMethod fun initSpeakerId(config: ReadableMap, promise: Promise) = implementation.initSpeakerId(config, promise)
    @ReactMethod fun processSpeakerIdSamples(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) = implementation.processSpeakerIdSamples(sampleRate, audioBuffer, promise)
    @ReactMethod fun computeSpeakerEmbedding(promise: Promise) = implementation.computeSpeakerEmbedding(promise)
    @ReactMethod fun resetSpeakerIdStream(promise: Promise) = implementation.resetSpeakerIdStream(promise)
    @ReactMethod fun registerSpeaker(name: String, embedding: ReadableArray, promise: Promise) = implementation.registerSpeaker(name, embedding, promise)
    @ReactMethod fun removeSpeaker(name: String, promise: Promise) = implementation.removeSpeaker(name, promise)
    @ReactMethod fun getSpeakers(promise: Promise) = implementation.getSpeakers(promise)
    @ReactMethod fun identifySpeaker(embedding: ReadableArray, threshold: Float, promise: Promise) = implementation.identifySpeaker(embedding, threshold, promise)
    @ReactMethod fun verifySpeaker(name: String, embedding: ReadableArray, threshold: Float, promise: Promise) = implementation.verifySpeaker(name, embedding, threshold, promise)
    @ReactMethod fun processSpeakerIdFile(filePath: String, promise: Promise) = implementation.processSpeakerIdFile(filePath, promise)
    @ReactMethod fun processSpeakerIdFileWindow(filePath: String, startTimeMs: Double, durationMs: Double, promise: Promise) =
        implementation.processSpeakerIdFileWindow(filePath, startTimeMs, durationMs, promise)
    @ReactMethod fun releaseSpeakerId(promise: Promise) = implementation.releaseSpeakerId(promise)
    @ReactMethod fun initDiarization(config: ReadableMap, promise: Promise) = implementation.initDiarization(config, promise)
    @ReactMethod fun processDiarizationFile(filePath: String, numClusters: Int, threshold: Float, promise: Promise) = implementation.processDiarizationFile(filePath, numClusters, threshold, promise)
    @ReactMethod fun processDiarizationFileWindow(filePath: String, startTimeMs: Double, durationMs: Double, numClusters: Int, threshold: Float, promise: Promise) = implementation.processDiarizationFileWindow(filePath, startTimeMs, durationMs, numClusters, threshold, promise)
    @ReactMethod fun releaseDiarization(promise: Promise) = implementation.releaseDiarization(promise)
    @ReactMethod fun initKws(config: ReadableMap, promise: Promise) = implementation.initKws(config, promise)
    @ReactMethod fun acceptKwsWaveform(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) = implementation.acceptKwsWaveform(sampleRate, audioBuffer, promise)
    @ReactMethod fun resetKwsStream(promise: Promise) = implementation.resetKwsStream(promise)
    @ReactMethod fun releaseKws(promise: Promise) = implementation.releaseKws(promise)
    @ReactMethod fun initVad(config: ReadableMap, promise: Promise) = implementation.initVad(config, promise)
    @ReactMethod fun acceptVadWaveform(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) = implementation.acceptVadWaveform(sampleRate, audioBuffer, promise)
    @ReactMethod fun resetVad(promise: Promise) = implementation.resetVad(promise)
    @ReactMethod fun releaseVad(promise: Promise) = implementation.releaseVad(promise)
    @ReactMethod fun initLanguageId(config: ReadableMap, promise: Promise) = implementation.initLanguageId(config, promise)
    @ReactMethod fun detectLanguage(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) = implementation.detectLanguage(sampleRate, audioBuffer, promise)
    @ReactMethod fun detectLanguageFromFile(filePath: String, promise: Promise) = implementation.detectLanguageFromFile(filePath, promise)
    @ReactMethod fun releaseLanguageId(promise: Promise) = implementation.releaseLanguageId(promise)
    @ReactMethod fun initPunctuation(config: ReadableMap, promise: Promise) = implementation.initPunctuation(config, promise)
    @ReactMethod fun addPunctuation(text: String, promise: Promise) = implementation.addPunctuation(text, promise)
    @ReactMethod fun releasePunctuation(promise: Promise) = implementation.releasePunctuation(promise)
    @ReactMethod fun initDenoiser(config: ReadableMap, promise: Promise) = implementation.initDenoiser(config, promise)
    @ReactMethod fun denoiseFile(filePath: String, promise: Promise) = implementation.denoiseFile(filePath, promise)
    @ReactMethod fun releaseDenoiser(promise: Promise) = implementation.releaseDenoiser(promise)
    @ReactMethod fun createOnnxSession(config: ReadableMap, promise: Promise) = implementation.createOnnxSession(config, promise)
    @ReactMethod fun runOnnxSession(sessionId: String, inputNames: ReadableArray, inputTypes: ReadableArray, inputDims: ReadableArray, inputData: ReadableArray, promise: Promise) = implementation.runOnnxSession(sessionId, inputNames, inputTypes, inputDims, inputData, promise)
    @ReactMethod fun releaseOnnxSession(sessionId: String, promise: Promise) = implementation.releaseOnnxSession(sessionId, promise)
    @ReactMethod fun extractTarBz2(sourcePath: String, targetDir: String, promise: Promise) = implementation.extractTarBz2(sourcePath, targetDir, promise)
    @ReactMethod fun validateLibraryLoaded(promise: Promise) = implementation.validateLibraryLoaded(promise)
    @ReactMethod fun testOnnxIntegration(promise: Promise) = implementation.testOnnxIntegration(promise)
    @ReactMethod fun getArchitectureInfo(promise: Promise) = implementation.getArchitectureInfo(promise)
    @ReactMethod fun getSystemInfo(promise: Promise) = implementation.getSystemInfo(promise)
}
