package net.siteed.sherpaonnx

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.Promise
import com.facebook.react.turbomodule.core.interfaces.TurboModule

class SherpaOnnxTurboModuleImpl(
    private val reactContext: ReactApplicationContext
) : SherpaOnnxTurboModule {

    private val implementation = SherpaOnnxImpl(reactContext)

    override fun initialize() {
        // Initialize any necessary resources
    }

    override fun invalidate() {
        // Clean up any resources
    }

    override fun initTts(config: ReadableMap, promise: Promise) {
        implementation.initTts(config, promise)
    }

    override fun generateTts(config: ReadableMap, promise: Promise) {
        implementation.generateTts(config, promise)
    }

    override fun stopTts(promise: Promise) {
        implementation.stopTts(promise)
    }

    override fun releaseTts(promise: Promise) {
        implementation.releaseTts(promise)
    }

    override fun initAsr(config: ReadableMap, promise: Promise) {
        implementation.initAsr(config, promise)
    }

    override fun recognizeFromSamples(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        implementation.recognizeFromSamples(sampleRate, audioBuffer, promise)
    }

    override fun recognizeFromFile(filePath: String, promise: Promise) {
        implementation.recognizeFromFile(filePath, promise)
    }

    override fun releaseAsr(promise: Promise) {
        implementation.releaseAsr(promise)
    }

    override fun initAudioTagging(config: ReadableMap, promise: Promise) {
        implementation.initAudioTagging(config, promise)
    }

    override fun processAudioSamples(sampleRate: Int, audioBuffer: ReadableArray, topK: Int, promise: Promise) {
        implementation.processAudioSamples(sampleRate, audioBuffer, topK, promise)
    }

    override fun computeAudioTagging(topK: Int, promise: Promise) {
        implementation.computeAudioTagging(topK, promise)
    }

    override fun processAndComputeAudioTagging(filePath: String, topK: Int, promise: Promise) {
        implementation.processAndComputeAudioTagging(filePath, topK, promise)
    }

    override fun processAudioFile(filePath: String, topK: Int, promise: Promise) {
        implementation.processAudioFile(filePath, topK, promise)
    }

    override fun releaseAudioTagging(promise: Promise) {
        implementation.releaseAudioTagging(promise)
    }

    override fun initSpeakerId(config: ReadableMap, promise: Promise) {
        implementation.initSpeakerId(config, promise)
    }

    override fun processSpeakerIdSamples(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        implementation.processSpeakerIdSamples(sampleRate, audioBuffer, promise)
    }

    override fun computeSpeakerEmbedding(promise: Promise) {
        implementation.computeSpeakerEmbedding(promise)
    }

    override fun registerSpeaker(name: String, embedding: ReadableArray, promise: Promise) {
        implementation.registerSpeaker(name, embedding, promise)
    }

    override fun removeSpeaker(name: String, promise: Promise) {
        implementation.removeSpeaker(name, promise)
    }

    override fun getSpeakers(promise: Promise) {
        implementation.getSpeakers(promise)
    }

    override fun identifySpeaker(embedding: ReadableArray, threshold: Float, promise: Promise) {
        implementation.identifySpeaker(embedding, threshold, promise)
    }

    override fun verifySpeaker(name: String, embedding: ReadableArray, threshold: Float, promise: Promise) {
        implementation.verifySpeaker(name, embedding, threshold, promise)
    }

    override fun processSpeakerIdFile(filePath: String, promise: Promise) {
        implementation.processSpeakerIdFile(filePath, promise)
    }

    override fun processSpeakerIdFileWindow(filePath: String, startTimeMs: Double, durationMs: Double, promise: Promise) {
        implementation.processSpeakerIdFileWindow(filePath, startTimeMs, durationMs, promise)
    }

    override fun releaseSpeakerId(promise: Promise) {
        implementation.releaseSpeakerId(promise)
    }

    override fun initDiarization(config: ReadableMap, promise: Promise) {
        implementation.initDiarization(config, promise)
    }

    override fun processDiarizationFile(filePath: String, numClusters: Int, threshold: Float, promise: Promise) {
        implementation.processDiarizationFile(filePath, numClusters, threshold, promise)
    }

    override fun processDiarizationFileWindow(filePath: String, startTimeMs: Double, durationMs: Double, numClusters: Int, threshold: Float, promise: Promise) {
        implementation.processDiarizationFileWindow(filePath, startTimeMs, durationMs, numClusters, threshold, promise)
    }

    override fun releaseDiarization(promise: Promise) {
        implementation.releaseDiarization(promise)
    }

    override fun initDenoiser(config: ReadableMap, promise: Promise) {
        implementation.initDenoiser(config, promise)
    }

    override fun denoiseFile(filePath: String, promise: Promise) {
        implementation.denoiseFile(filePath, promise)
    }

    override fun releaseDenoiser(promise: Promise) {
        implementation.releaseDenoiser(promise)
    }

    override fun extractTarBz2(sourcePath: String, targetDir: String, promise: Promise) {
        implementation.extractTarBz2(sourcePath, targetDir, promise)
    }

    override fun validateLibraryLoaded(promise: Promise) {
        implementation.validateLibraryLoaded(promise)
    }

    override fun testOnnxIntegration(promise: Promise) {
        implementation.testOnnxIntegration(promise)
    }

    override fun getArchitectureInfo(promise: Promise) {
        implementation.getArchitectureInfo(promise)
    }

    override fun getSystemInfo(promise: Promise) {
        implementation.getSystemInfo(promise)
    }
}
