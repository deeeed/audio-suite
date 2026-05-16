package net.siteed.sherpaonnx

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.turbomodule.core.interfaces.TurboModule

interface SherpaOnnxTurboModule : TurboModule {
    fun initTts(config: ReadableMap, promise: Promise)
    fun generateTts(config: ReadableMap, promise: Promise)
    fun stopTts(promise: Promise)
    fun releaseTts(promise: Promise)
    fun initAsr(config: ReadableMap, promise: Promise)
    fun recognizeFromSamples(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise)
    fun recognizeFromFile(filePath: String, promise: Promise)
    fun releaseAsr(promise: Promise)
    fun initAudioTagging(config: ReadableMap, promise: Promise)
    fun processAudioSamples(sampleRate: Int, audioBuffer: ReadableArray, topK: Int, promise: Promise)
    fun computeAudioTagging(topK: Int, promise: Promise)
    fun processAndComputeAudioTagging(filePath: String, topK: Int, promise: Promise)
    fun processAudioFile(filePath: String, topK: Int, promise: Promise)
    fun releaseAudioTagging(promise: Promise)
    fun initSpeakerId(config: ReadableMap, promise: Promise)
    fun processSpeakerIdSamples(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise)
    fun computeSpeakerEmbedding(promise: Promise)
    fun registerSpeaker(name: String, embedding: ReadableArray, promise: Promise)
    fun removeSpeaker(name: String, promise: Promise)
    fun getSpeakers(promise: Promise)
    fun identifySpeaker(embedding: ReadableArray, threshold: Float, promise: Promise)
    fun verifySpeaker(name: String, embedding: ReadableArray, threshold: Float, promise: Promise)
    fun processSpeakerIdFile(filePath: String, promise: Promise)
    fun processSpeakerIdFileWindow(filePath: String, startTimeMs: Double, durationMs: Double, promise: Promise)
    fun releaseSpeakerId(promise: Promise)
    fun initDiarization(config: ReadableMap, promise: Promise)
    fun processDiarizationFile(filePath: String, numClusters: Int, threshold: Float, promise: Promise)
    fun processDiarizationFileWindow(filePath: String, startTimeMs: Double, durationMs: Double, numClusters: Int, threshold: Float, promise: Promise)
    fun releaseDiarization(promise: Promise)
    fun initDenoiser(config: ReadableMap, promise: Promise)
    fun denoiseFile(filePath: String, promise: Promise)
    fun releaseDenoiser(promise: Promise)
    fun extractTarBz2(sourcePath: String, targetDir: String, promise: Promise)
    fun validateLibraryLoaded(promise: Promise)
    fun testOnnxIntegration(promise: Promise)
    fun getArchitectureInfo(promise: Promise)
    fun getSystemInfo(promise: Promise)
}
