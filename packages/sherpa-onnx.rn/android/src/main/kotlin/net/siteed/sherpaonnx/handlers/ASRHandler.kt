/**
 * Handler for Automatic Speech Recognition (ASR) functionality
 */
package net.siteed.sherpaonnx.handlers

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import net.siteed.sherpaonnx.SherpaOnnxImpl
import net.siteed.sherpaonnx.utils.AssetUtils
import net.siteed.sherpaonnx.utils.AudioExtractor
import java.io.File
import java.util.concurrent.Executors

// Import Sherpa ONNX classes for offline recognition
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineParaformerModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineStream
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig
import com.k2fsa.sherpa.onnx.OfflineNemoEncDecCtcModelConfig
import com.k2fsa.sherpa.onnx.OfflineMoonshineModelConfig
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig
import com.k2fsa.sherpa.onnx.OfflineFireRedAsrModelConfig
import com.k2fsa.sherpa.onnx.OfflineCanaryModelConfig
import com.k2fsa.sherpa.onnx.OfflineQwen3AsrModelConfig
import com.k2fsa.sherpa.onnx.OfflineCohereTranscribeModelConfig

// Import Sherpa ONNX classes for online recognition
import com.k2fsa.sherpa.onnx.OnlineRecognizer
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig

/**
 * Handler for Automatic Speech Recognition functionality in Sherpa-ONNX
 * Provides methods to initialize the ASR engine, recognize audio from
 * samples or files, and clean up resources.
 * 
 * Supports both offline and streaming (online) recognition.
 */
class ASRHandler(private val reactContext: ReactApplicationContext) {
    
    private val executor = Executors.newSingleThreadExecutor()
    
    // Offline recognition components
    private var offlineRecognizer: OfflineRecognizer? = null
    private var offlineStream: OfflineStream? = null
    
    // Online (streaming) recognition components
    private var onlineRecognizer: OnlineRecognizer? = null
    private var onlineStream: OnlineStream? = null
    
    private var isRecognizing = false
    private var isStreaming = false
    
    // Keep track of ASR configuration
    private var asrModelConfig: ReadableMap? = null
    
    companion object {
        private const val TAG = "SherpaOnnxASR"
        private const val DEFAULT_SAMPLE_RATE = 16000
        private const val DEFAULT_FEATURE_DIM = 80
        private const val DEFAULT_DEBUG = false
        private const val DEFAULT_PROVIDER = "cpu"
        private const val DEFAULT_NUM_THREADS = 2
        private const val DEFAULT_DECODING_METHOD = "greedy_search"
        private const val DEFAULT_MAX_ACTIVE_PATHS = 4
        private const val DEFAULT_CHUNK_SIZE_MS = 50
        private const val OFFLINE_WHISPER_MAX_WINDOW_SECONDS = 29
    }
    
    /**
     * Initialize ASR with the provided model configuration
     */
    fun init(modelConfig: ReadableMap, promise: Promise) {
        if (!SherpaOnnxImpl.isLibraryLoaded) {
            promise.reject("ERR_LIBRARY_NOT_LOADED", "Sherpa ONNX library is not loaded")
            return
        }
        
        // Store the configuration for later reference
        this.asrModelConfig = modelConfig
        
        executor.execute {
            try {
                Log.i(TAG, "===== ASR INITIALIZATION START =====")
                Log.i(TAG, "Received model config: ${modelConfig.toHashMap()}")
                
                // Extract common parameters from config
                val modelDir = AssetUtils.cleanFilePath(modelConfig.getString("modelDir") ?: "")
                val modelType = modelConfig.getString("modelType") ?: "transducer"
                val streaming = if (modelConfig.hasKey("streaming")) modelConfig.getBoolean("streaming") else false
                val numThreads = if (modelConfig.hasKey("numThreads")) modelConfig.getInt("numThreads") else DEFAULT_NUM_THREADS
                val sampleRate = if (modelConfig.hasKey("sampleRate")) modelConfig.getInt("sampleRate") else DEFAULT_SAMPLE_RATE
                val featureDim = if (modelConfig.hasKey("featureDim")) modelConfig.getInt("featureDim") else DEFAULT_FEATURE_DIM
                val decodingMethod = modelConfig.getString("decodingMethod") ?: DEFAULT_DECODING_METHOD
                val maxActivePaths = if (modelConfig.hasKey("maxActivePaths")) modelConfig.getInt("maxActivePaths") else DEFAULT_MAX_ACTIVE_PATHS
                val debug = if (modelConfig.hasKey("debug")) modelConfig.getBoolean("debug") else DEFAULT_DEBUG
                val provider = modelConfig.getString("provider") ?: DEFAULT_PROVIDER
                
                Log.i(TAG, "Using configuration:")
                Log.i(TAG, "- modelDir: $modelDir")
                Log.i(TAG, "- modelType: $modelType")
                Log.i(TAG, "- streaming: $streaming")
                Log.i(TAG, "- numThreads: $numThreads")
                Log.i(TAG, "- sampleRate: $sampleRate")
                Log.i(TAG, "- decodingMethod: $decodingMethod")
                Log.i(TAG, "- maxActivePaths: $maxActivePaths")
                Log.i(TAG, "- debug: $debug")
                
                // Extract model file paths (nested map or flattened TurboModule fields)
                val mutableModelFiles = mutableMapOf<String, String>()
                if (modelConfig.hasKey("modelFiles")) {
                    val modelFilesMap = modelConfig.getMap("modelFiles")
                    if (modelFilesMap != null) {
                        val iterator = modelFilesMap.keySetIterator()
                        while (iterator.hasNextKey()) {
                            val key = iterator.nextKey()
                            val value = modelFilesMap.getString(key)
                            if (value != null) {
                                mutableModelFiles[key] = value
                            }
                        }
                    }
                }
                // Also read flattened modelFile* fields (TurboModule codegen doesn't support nested objects)
                val flattenedKeys = mapOf(
                    "modelFileEncoder" to "encoder",
                    "modelFileDecoder" to "decoder",
                    "modelFileJoiner" to "joiner",
                    "modelFileTokens" to "tokens",
                    "modelFileModel" to "model",
                    "modelFilePreprocessor" to "preprocessor",
                    "modelFileUncachedDecoder" to "uncachedDecoder",
                    "modelFileCachedDecoder" to "cachedDecoder",
                    "modelFileConvFrontend" to "convFrontend",
                    "modelFileTokenizer" to "tokenizer"
                )
                for ((flatKey, mapKey) in flattenedKeys) {
                    if (modelConfig.hasKey(flatKey) && !mutableModelFiles.containsKey(mapKey)) {
                        val value = modelConfig.getString(flatKey)
                        if (value != null) {
                            mutableModelFiles[mapKey] = value
                        }
                    }
                }
                val modelFiles: Map<String, String> = mutableModelFiles

                Log.i(TAG, "Model files: $modelFiles")
                
                // Create feature configuration
                val featConfig = FeatureConfig()
                featConfig.sampleRate = sampleRate
                featConfig.featureDim = featureDim
                
                if (streaming) {
                    // Initialize online (streaming) ASR
                    initOnlineAsr(
                        modelDir, 
                        modelType, 
                        modelFiles, 
                        numThreads, 
                        decodingMethod, 
                        maxActivePaths, 
                        debug, 
                        provider, 
                        featConfig,
                        promise
                    )
                } else {
                    // Initialize offline ASR
                    initOfflineAsr(
                        modelDir, 
                        modelType, 
                        modelFiles, 
                        numThreads, 
                        decodingMethod, 
                        maxActivePaths, 
                        debug, 
                        provider, 
                        featConfig,
                        promise
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error initializing ASR: ${e.message}")
                e.printStackTrace()
                
                // Release resources in case of error
                releaseResources()
                
                Log.i(TAG, "===== ASR INITIALIZATION FAILED =====")
                
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_ASR_INIT", "Failed to initialize ASR: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Initialize offline ASR
     */
    private fun initOfflineAsr(
        modelDir: String,
        modelType: String,
        modelFiles: Map<String, String>,
        numThreads: Int,
        decodingMethod: String,
        maxActivePaths: Int,
        debug: Boolean,
        provider: String,
        featConfig: FeatureConfig,
        promise: Promise
    ) {
        try {
            Log.i(TAG, "Initializing OFFLINE ASR with model type: $modelType")
            
            // Create model configuration based on type
            val modelConfig = createOfflineModelConfig(modelDir, modelType, modelFiles)
            
            // Set common parameters
            modelConfig.numThreads = numThreads
            modelConfig.debug = debug
            modelConfig.provider = provider
            modelConfig.modelType = modelType
            
            // Create recognizer configuration
            val config = OfflineRecognizerConfig()
            config.featConfig = featConfig
            config.modelConfig = modelConfig
            config.decodingMethod = decodingMethod
            
            // Use default values for beam search if applicable
            if (decodingMethod == "beam_search") {
                config.maxActivePaths = maxActivePaths
            }
            
            Log.i(TAG, "Creating offline recognizer with config: " +
                    "modelType=$modelType, numThreads=$numThreads, decodingMethod=$decodingMethod")
            
            // Initialize the recognizer
            offlineRecognizer = OfflineRecognizer(null, config)

            // Get sample rate from feature config
            val actualSampleRate = featConfig.sampleRate
            
            Log.i(TAG, "ASR initialized successfully with sample rate: $actualSampleRate")
            
            // Return success result
            val resultMap = Arguments.createMap()
            resultMap.putBoolean("success", true)
            resultMap.putInt("sampleRate", actualSampleRate)
            resultMap.putString("modelType", modelType)
            
            Log.i(TAG, "===== ASR INITIALIZATION COMPLETE =====")
            
            reactContext.runOnUiQueueThread {
                promise.resolve(resultMap)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error initializing offline ASR: ${e.message}")
            e.printStackTrace()
            
            // Release resources in case of error
            releaseResources()
            
            reactContext.runOnUiQueueThread {
                promise.reject("ERR_ASR_INIT", "Failed to initialize offline ASR: ${e.message}")
            }
        }
    }
    
    /**
     * Initialize online (streaming) ASR
     */
    private fun initOnlineAsr(
        modelDir: String,
        modelType: String,
        modelFiles: Map<String, String>,
        numThreads: Int,
        decodingMethod: String,
        maxActivePaths: Int,
        debug: Boolean,
        provider: String,
        featConfig: FeatureConfig,
        promise: Promise
    ) {
        try {
            Log.i(TAG, "Initializing ONLINE (streaming) ASR with model type: $modelType")
            
            // Create model configuration based on type
            val modelConfig = createOnlineModelConfig(modelDir, modelType, modelFiles)
            
            // Set common parameters
            modelConfig.numThreads = numThreads
            modelConfig.debug = debug
            modelConfig.provider = provider
            modelConfig.modelType = modelType
            
            // Create recognizer configuration
            val config = OnlineRecognizerConfig()
            config.featConfig = featConfig
            config.modelConfig = modelConfig
            config.decodingMethod = decodingMethod
            
            // Use default values for beam search if applicable
            if (decodingMethod == "beam_search") {
                config.maxActivePaths = maxActivePaths
            }
            
            Log.i(TAG, "Creating online recognizer with config: " +
                    "modelType=$modelType, numThreads=$numThreads, decodingMethod=$decodingMethod")
            
            // Initialize the recognizer
            onlineRecognizer = OnlineRecognizer(null, config)
            
            // Set streaming flag
            isStreaming = true
            
            // Return success result
            val resultMap = Arguments.createMap()
            resultMap.putBoolean("success", true)
            resultMap.putInt("sampleRate", featConfig.sampleRate)
            resultMap.putString("modelType", modelType)
            resultMap.putBoolean("streaming", true)
            
            Log.i(TAG, "===== STREAMING ASR INITIALIZATION COMPLETE =====")
            
            reactContext.runOnUiQueueThread {
                promise.resolve(resultMap)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error initializing streaming ASR: ${e.message}")
            e.printStackTrace()
            
            // Release resources in case of error
            releaseResources()
            
            reactContext.runOnUiQueueThread {
                promise.reject("ERR_ASR_INIT", "Failed to initialize streaming ASR: ${e.message}")
            }
        }
    }
    
    /**
     * Create offline model configuration for the specific model type
     */
    private fun createOfflineModelConfig(
        modelDir: String,
        modelType: String,
        modelFiles: Map<String, String>
    ): OfflineModelConfig {
        val modelConfig = OfflineModelConfig()
        val language = asrModelConfig?.getString("language") ?: ""
        val task = asrModelConfig?.getString("task") ?: "transcribe"
        val useItn = if (asrModelConfig?.hasKey("useItn") == true) {
            asrModelConfig?.getBoolean("useItn") ?: true
        } else {
            true
        }
        val srcLang = asrModelConfig?.getString("srcLang") ?: "en"
        val tgtLang = asrModelConfig?.getString("tgtLang") ?: "en"
        val usePnc = if (asrModelConfig?.hasKey("usePnc") == true) {
            asrModelConfig?.getBoolean("usePnc") ?: true
        } else {
            true
        }
        val usePunct = if (asrModelConfig?.hasKey("usePunct") == true) {
            asrModelConfig?.getBoolean("usePunct") ?: true
        } else {
            true
        }
        val hotwords = asrModelConfig?.getString("hotwords") ?: ""
        // Qwen3 generation params: prefer flattened TurboModule keys, fall back to a
        // nested `qwen3` map for callers that bypass the SherpaOnnxAPI flatten layer.
        val qwen3NestedCfg: ReadableMap? = if (asrModelConfig?.hasKey("qwen3") == true) {
            asrModelConfig?.getMap("qwen3")
        } else {
            null
        }
        fun qwen3Int(flatKey: String, nestedKey: String, default: Int): Int {
            if (asrModelConfig?.hasKey(flatKey) == true) return asrModelConfig?.getInt(flatKey) ?: default
            if (qwen3NestedCfg?.hasKey(nestedKey) == true) return qwen3NestedCfg.getInt(nestedKey)
            return default
        }
        fun qwen3Float(flatKey: String, nestedKey: String, default: Float): Float {
            if (asrModelConfig?.hasKey(flatKey) == true) return asrModelConfig?.getDouble(flatKey)?.toFloat() ?: default
            if (qwen3NestedCfg?.hasKey(nestedKey) == true) return qwen3NestedCfg.getDouble(nestedKey).toFloat()
            return default
        }

        // Get tokens file path
        val tokensFile = modelFiles["tokens"] ?: "tokens.txt"
        val tokensPath = File(modelDir, tokensFile).absolutePath
        modelConfig.tokens = tokensPath
        
        when (modelType) {
            "transducer", "zipformer", "zipformer2" -> {
                Log.i(TAG, "Setting up transducer/zipformer model")
                val encoderFile = modelFiles["encoder"] ?: "encoder.onnx"
                val decoderFile = modelFiles["decoder"] ?: "decoder.onnx"
                val joinerFile = modelFiles["joiner"] ?: "joiner.onnx"
                
                val encoderPath = File(modelDir, encoderFile).absolutePath
                val decoderPath = File(modelDir, decoderFile).absolutePath
                val joinerPath = File(modelDir, joinerFile).absolutePath
                
                Log.i(TAG, "Using encoder: $encoderPath")
                Log.i(TAG, "Using decoder: $decoderPath")
                Log.i(TAG, "Using joiner: $joinerPath")
                
                val transducerConfig = OfflineTransducerModelConfig()
                transducerConfig.encoder = encoderPath
                transducerConfig.decoder = decoderPath
                transducerConfig.joiner = joinerPath
                
                modelConfig.transducer = transducerConfig
            }
            "paraformer" -> {
                Log.i(TAG, "Setting up paraformer model")
                val modelFile = modelFiles["model"] ?: "model.onnx"
                val modelPath = File(modelDir, modelFile).absolutePath
                
                Log.i(TAG, "Using model: $modelPath")
                
                val paraformerConfig = OfflineParaformerModelConfig()
                paraformerConfig.model = modelPath
                
                modelConfig.paraformer = paraformerConfig
            }
            "whisper" -> {
                Log.i(TAG, "Setting up whisper model")
                val encoderFile = modelFiles["encoder"] ?: "encoder.onnx"
                val decoderFile = modelFiles["decoder"] ?: "decoder.onnx"
                
                val encoderPath = File(modelDir, encoderFile).absolutePath
                val decoderPath = File(modelDir, decoderFile).absolutePath
                
                Log.i(TAG, "Using encoder: $encoderPath")
                Log.i(TAG, "Using decoder: $decoderPath")
                
                val whisperConfig = OfflineWhisperModelConfig()
                whisperConfig.encoder = encoderPath
                whisperConfig.decoder = decoderPath
                whisperConfig.language = language
                whisperConfig.task = task
                
                modelConfig.whisper = whisperConfig
            }
            "canary" -> {
                Log.i(TAG, "Setting up Canary model")
                val encoderFile = modelFiles["encoder"] ?: "encoder.int8.onnx"
                val decoderFile = modelFiles["decoder"] ?: "decoder.int8.onnx"

                val encoderPath = File(modelDir, encoderFile).absolutePath
                val decoderPath = File(modelDir, decoderFile).absolutePath

                Log.i(TAG, "Using encoder: $encoderPath")
                Log.i(TAG, "Using decoder: $decoderPath")

                val canaryConfig = OfflineCanaryModelConfig()
                canaryConfig.encoder = encoderPath
                canaryConfig.decoder = decoderPath
                canaryConfig.srcLang = srcLang
                canaryConfig.tgtLang = tgtLang
                canaryConfig.usePnc = usePnc

                modelConfig.canary = canaryConfig
            }
            "nemo_ctc", "nemo_transducer" -> {
                Log.i(TAG, "Setting up Nemo CTC/Transducer model")
                val modelFile = modelFiles["model"] ?: "model.onnx"
                val modelPath = File(modelDir, modelFile).absolutePath
                
                Log.i(TAG, "Using model: $modelPath")
                
                val nemoConfig = OfflineNemoEncDecCtcModelConfig()
                nemoConfig.model = modelPath
                
                modelConfig.nemo = nemoConfig
            }
            "moonshine" -> {
                Log.i(TAG, "Setting up Moonshine model")
                val preprocessorFile = modelFiles["preprocessor"] ?: "preprocess.onnx"
                val encoderFile = modelFiles["encoder"] ?: "encode.onnx"
                val uncachedDecoderFile = modelFiles["uncachedDecoder"] ?: "uncached_decode.onnx"
                val cachedDecoderFile = modelFiles["cachedDecoder"] ?: "cached_decode.onnx"
                
                val preprocessorPath = File(modelDir, preprocessorFile).absolutePath
                val encoderPath = File(modelDir, encoderFile).absolutePath
                val uncachedDecoderPath = File(modelDir, uncachedDecoderFile).absolutePath
                val cachedDecoderPath = File(modelDir, cachedDecoderFile).absolutePath
                
                Log.i(TAG, "Using preprocessor: $preprocessorPath")
                Log.i(TAG, "Using encoder: $encoderPath")
                Log.i(TAG, "Using uncachedDecoder: $uncachedDecoderPath")
                Log.i(TAG, "Using cachedDecoder: $cachedDecoderPath")
                
                val moonshineConfig = OfflineMoonshineModelConfig()
                moonshineConfig.preprocessor = preprocessorPath
                moonshineConfig.encoder = encoderPath
                moonshineConfig.uncachedDecoder = uncachedDecoderPath
                moonshineConfig.cachedDecoder = cachedDecoderPath
                
                modelConfig.moonshine = moonshineConfig
            }
            "sense_voice" -> {
                Log.i(TAG, "Setting up SenseVoice model")
                val modelFile = modelFiles["model"] ?: "model.onnx"
                val modelPath = File(modelDir, modelFile).absolutePath
                
                Log.i(TAG, "Using model: $modelPath")
                
                val senseVoiceConfig = OfflineSenseVoiceModelConfig()
                senseVoiceConfig.model = modelPath
                senseVoiceConfig.language = language
                senseVoiceConfig.useInverseTextNormalization = useItn
                
                modelConfig.senseVoice = senseVoiceConfig
            }
            "fire_red_asr" -> {
                Log.i(TAG, "Setting up FireRedASR model")
                val encoderFile = modelFiles["encoder"] ?: "encoder.onnx"
                val decoderFile = modelFiles["decoder"] ?: "decoder.onnx"
                
                val encoderPath = File(modelDir, encoderFile).absolutePath
                val decoderPath = File(modelDir, decoderFile).absolutePath
                
                Log.i(TAG, "Using encoder: $encoderPath")
                Log.i(TAG, "Using decoder: $decoderPath")
                
                val fireRedConfig = OfflineFireRedAsrModelConfig()
                fireRedConfig.encoder = encoderPath
                fireRedConfig.decoder = decoderPath
                
                modelConfig.fireRedAsr = fireRedConfig
            }
            "telespeech_ctc" -> {
                Log.i(TAG, "Setting up TeleSpeech CTC model")
                val modelFile = modelFiles["model"] ?: "model.onnx"
                val modelPath = File(modelDir, modelFile).absolutePath

                Log.i(TAG, "Using model: $modelPath")

                modelConfig.teleSpeech = modelPath
            }
            "qwen3" -> {
                Log.i(TAG, "Setting up Qwen3-ASR model")
                val convFrontendFile = modelFiles["convFrontend"] ?: "conv_frontend.onnx"
                val encoderFile = modelFiles["encoder"] ?: "encoder.int8.onnx"
                val decoderFile = modelFiles["decoder"] ?: "decoder.int8.onnx"
                val tokenizerName = modelFiles["tokenizer"] ?: "tokenizer"

                val convFrontendPath = File(modelDir, convFrontendFile).absolutePath
                val encoderPath = File(modelDir, encoderFile).absolutePath
                val decoderPath = File(modelDir, decoderFile).absolutePath
                val tokenizerPath = File(modelDir, tokenizerName).absolutePath

                Log.i(TAG, "Using convFrontend: $convFrontendPath")
                Log.i(TAG, "Using encoder: $encoderPath")
                Log.i(TAG, "Using decoder: $decoderPath")
                Log.i(TAG, "Using tokenizer: $tokenizerPath")

                val qwen3Config = OfflineQwen3AsrModelConfig()
                qwen3Config.convFrontend = convFrontendPath
                qwen3Config.encoder = encoderPath
                qwen3Config.decoder = decoderPath
                qwen3Config.tokenizer = tokenizerPath
                qwen3Config.maxTotalLen = qwen3Int("qwen3MaxTotalLen", "maxTotalLen", 512)
                qwen3Config.maxNewTokens = qwen3Int("qwen3MaxNewTokens", "maxNewTokens", 128)
                qwen3Config.temperature = qwen3Float("qwen3Temperature", "temperature", 1e-6f)
                qwen3Config.topP = qwen3Float("qwen3TopP", "topP", 0.8f)
                qwen3Config.seed = qwen3Int("qwen3Seed", "seed", 42)
                qwen3Config.hotwords = hotwords

                modelConfig.qwen3Asr = qwen3Config
                // Qwen3 ships its own tokenizer directory and does not consume the
                // root-level tokens.txt; clear it so the file-existence check below
                // does not fail on a missing file.
                modelConfig.tokens = ""
            }
            "cohere_transcribe" -> {
                Log.i(TAG, "Setting up Cohere Transcribe model")
                val encoderFile = modelFiles["encoder"] ?: "encoder.int8.onnx"
                val decoderFile = modelFiles["decoder"] ?: "decoder.int8.onnx"

                val encoderPath = File(modelDir, encoderFile).absolutePath
                val decoderPath = File(modelDir, decoderFile).absolutePath

                Log.i(TAG, "Using encoder: $encoderPath")
                Log.i(TAG, "Using decoder: $decoderPath")
                Log.i(TAG, "Using language hint: '$language', usePunct=$usePunct, useItn=$useItn")

                val cohereConfig = OfflineCohereTranscribeModelConfig()
                cohereConfig.encoder = encoderPath
                cohereConfig.decoder = decoderPath
                cohereConfig.language = language
                cohereConfig.usePunct = usePunct
                cohereConfig.useItn = useItn

                modelConfig.cohereTranscribe = cohereConfig
            }
            else -> {
                throw Exception("Unsupported model type: $modelType")
            }
        }
        
        // Check for required files
        val files = mutableListOf<String>()
        when (modelType) {
            "transducer", "zipformer", "zipformer2" -> {
                files.add(modelConfig.transducer.encoder)
                files.add(modelConfig.transducer.decoder)
                files.add(modelConfig.transducer.joiner)
            }
            "paraformer" -> {
                files.add(modelConfig.paraformer.model)
            }
            "whisper" -> {
                files.add(modelConfig.whisper.encoder)
                files.add(modelConfig.whisper.decoder)
            }
            "canary" -> {
                files.add(modelConfig.canary.encoder)
                files.add(modelConfig.canary.decoder)
            }
            "nemo_ctc", "nemo_transducer" -> {
                files.add(modelConfig.nemo.model)
            }
            "moonshine" -> {
                files.add(modelConfig.moonshine.preprocessor)
                files.add(modelConfig.moonshine.encoder)
                files.add(modelConfig.moonshine.uncachedDecoder)
                files.add(modelConfig.moonshine.cachedDecoder)
            }
            "sense_voice" -> {
                files.add(modelConfig.senseVoice.model)
            }
            "fire_red_asr" -> {
                files.add(modelConfig.fireRedAsr.encoder)
                files.add(modelConfig.fireRedAsr.decoder)
            }
            "telespeech_ctc" -> {
                files.add(modelConfig.teleSpeech)
            }
            "qwen3" -> {
                files.add(modelConfig.qwen3Asr.convFrontend)
                files.add(modelConfig.qwen3Asr.encoder)
                files.add(modelConfig.qwen3Asr.decoder)
                files.add(modelConfig.qwen3Asr.tokenizer)
            }
            "cohere_transcribe" -> {
                files.add(modelConfig.cohereTranscribe.encoder)
                files.add(modelConfig.cohereTranscribe.decoder)
            }
        }

        // Add tokens file (skipped for backends that don't use a root tokens.txt,
        // e.g. Qwen3 which ships a tokenizer directory instead).
        if (modelConfig.tokens.isNotEmpty()) {
            files.add(modelConfig.tokens)
        }
        
        // Check if files exist
        for (filePath in files) {
            val file = File(filePath)
            if (!file.exists()) {
                Log.e(TAG, "File not found: $filePath")
                throw Exception("File not found: $filePath")
            } else {
                Log.i(TAG, "File verified: $filePath")
            }
        }
        
        return modelConfig
    }
    
    /**
     * Create online model configuration for the specific model type
     */
    private fun createOnlineModelConfig(
        modelDir: String,
        modelType: String,
        modelFiles: Map<String, String>
    ): OnlineModelConfig {
        val modelConfig = OnlineModelConfig()
        
        // Get tokens file path
        val tokensFile = modelFiles["tokens"] ?: "tokens.txt"
        val tokensPath = File(modelDir, tokensFile).absolutePath
        modelConfig.tokens = tokensPath
        
        when (modelType) {
            "transducer", "zipformer", "zipformer2" -> {
                Log.i(TAG, "Setting up streaming transducer/zipformer model")
                val encoderFile = modelFiles["encoder"] ?: "encoder.onnx"
                val decoderFile = modelFiles["decoder"] ?: "decoder.onnx"
                val joinerFile = modelFiles["joiner"] ?: "joiner.onnx"
                
                val encoderPath = File(modelDir, encoderFile).absolutePath
                val decoderPath = File(modelDir, decoderFile).absolutePath
                val joinerPath = File(modelDir, joinerFile).absolutePath
                
                Log.i(TAG, "Using encoder: $encoderPath")
                Log.i(TAG, "Using decoder: $decoderPath")
                Log.i(TAG, "Using joiner: $joinerPath")
                
                val transducerConfig = OnlineTransducerModelConfig()
                transducerConfig.encoder = encoderPath
                transducerConfig.decoder = decoderPath
                transducerConfig.joiner = joinerPath
                
                modelConfig.transducer = transducerConfig
            }
            "paraformer" -> {
                Log.i(TAG, "Setting up streaming paraformer model")
                val encoderFile = modelFiles["encoder"] ?: "encoder.onnx"
                val decoderFile = modelFiles["decoder"] ?: "decoder.onnx"
                
                val encoderPath = File(modelDir, encoderFile).absolutePath
                val decoderPath = File(modelDir, decoderFile).absolutePath
                
                Log.i(TAG, "Using encoder: $encoderPath")
                Log.i(TAG, "Using decoder: $decoderPath")
                
                // Use reflection to create and configure the paraformer model
                try {
                    // Try to get the class using reflection
                    val paraformerConfigClass = Class.forName("com.k2fsa.sherpa.onnx.OnlineParaformerModelConfig")
                    val paraformerConfig = paraformerConfigClass.getDeclaredConstructor().newInstance()
                    
                    // Set encoder and decoder using reflection
                    val encoderSetter = paraformerConfigClass.getDeclaredMethod("setEncoder", String::class.java)
                    encoderSetter.invoke(paraformerConfig, encoderPath)
                    
                    val decoderSetter = paraformerConfigClass.getDeclaredMethod("setDecoder", String::class.java)
                    decoderSetter.invoke(paraformerConfig, decoderPath)
                    
                    // Set the paraformer config on the model config
                    val paraformerSetter = modelConfig.javaClass.getDeclaredMethod("setParaformer", paraformerConfigClass)
                    paraformerSetter.invoke(modelConfig, paraformerConfig)
                    
                    Log.i(TAG, "Successfully configured paraformer model using reflection")
                } catch (e: Exception) {
                    Log.e(TAG, "Error configuring paraformer model: ${e.message}")
                    e.printStackTrace()
                    throw Exception("Failed to configure paraformer model: ${e.message}")
                }
            }
            "zipformer2_ctc" -> {
                Log.i(TAG, "Setting up streaming zipformer2 CTC model")
                val modelFile = modelFiles["model"] ?: "model.onnx"
                val modelPath = File(modelDir, modelFile).absolutePath
                
                Log.i(TAG, "Using model: $modelPath")
                
                // Use reflection to create and configure the zipformer2Ctc model
                try {
                    // Try to get the class using reflection
                    val zipformerCtcClass = Class.forName("com.k2fsa.sherpa.onnx.OnlineZipformer2CtcModelConfig")
                    val zipformerCtcConfig = zipformerCtcClass.getDeclaredConstructor().newInstance()
                    
                    // Set model using reflection
                    val modelSetter = zipformerCtcClass.getDeclaredMethod("setModel", String::class.java)
                    modelSetter.invoke(zipformerCtcConfig, modelPath)
                    
                    // Set the zipformer2Ctc config on the model config
                    val zipformerCtcSetter = modelConfig.javaClass.getDeclaredMethod("setZipformer2Ctc", zipformerCtcClass)
                    zipformerCtcSetter.invoke(modelConfig, zipformerCtcConfig)
                    
                    Log.i(TAG, "Successfully configured zipformer2Ctc model using reflection")
                } catch (e: Exception) {
                    Log.e(TAG, "Error configuring zipformer2Ctc model: ${e.message}")
                    e.printStackTrace()
                    throw Exception("Failed to configure zipformer2Ctc model: ${e.message}")
                }
            }
            "nemo_ctc" -> {
                Log.i(TAG, "Setting up streaming Nemo CTC model")
                val modelFile = modelFiles["model"] ?: "model.onnx"
                val modelPath = File(modelDir, modelFile).absolutePath
                
                Log.i(TAG, "Using model: $modelPath")
                
                // Use reflection to create and configure the neMoCtc model
                try {
                    // Try to get the class using reflection
                    val nemoCtcClass = Class.forName("com.k2fsa.sherpa.onnx.OnlineNeMoCtcModelConfig")
                    val nemoCtcConfig = nemoCtcClass.getDeclaredConstructor().newInstance()
                    
                    // Set model using reflection
                    val modelSetter = nemoCtcClass.getDeclaredMethod("setModel", String::class.java)
                    modelSetter.invoke(nemoCtcConfig, modelPath)
                    
                    // Set the neMoCtc config on the model config
                    val nemoCtcSetter = modelConfig.javaClass.getDeclaredMethod("setNeMoCtc", nemoCtcClass)
                    nemoCtcSetter.invoke(modelConfig, nemoCtcConfig)
                    
                    Log.i(TAG, "Successfully configured neMoCtc model using reflection")
                } catch (e: Exception) {
                    Log.e(TAG, "Error configuring neMoCtc model: ${e.message}")
                    e.printStackTrace()
                    throw Exception("Failed to configure neMoCtc model: ${e.message}")
                }
            }
            else -> {
                throw Exception("Unsupported online model type: $modelType")
            }
        }
        
        // Check for required files
        val files = mutableListOf<String>()
        when (modelType) {
            "transducer", "zipformer", "zipformer2" -> {
                files.add(modelConfig.transducer.encoder)
                files.add(modelConfig.transducer.decoder)
                files.add(modelConfig.transducer.joiner)
            }
            "paraformer" -> {
                // Use reflection to get the paraformer encoder and decoder
                try {
                    val paraformerField = modelConfig.javaClass.getDeclaredField("paraformer")
                    paraformerField.isAccessible = true
                    val paraformerConfig = paraformerField.get(modelConfig)
                    
                    if (paraformerConfig != null) {
                        val encoderField = paraformerConfig.javaClass.getDeclaredField("encoder")
                        encoderField.isAccessible = true
                        files.add(encoderField.get(paraformerConfig) as String)
                        
                        val decoderField = paraformerConfig.javaClass.getDeclaredField("decoder")
                        decoderField.isAccessible = true
                        files.add(decoderField.get(paraformerConfig) as String)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to access paraformer config fields: ${e.message}")
                }
            }
            "zipformer2_ctc" -> {
                // Use reflection to get the zipformer2Ctc model
                try {
                    val zipformerCtcField = modelConfig.javaClass.getDeclaredField("zipformer2Ctc")
                    zipformerCtcField.isAccessible = true
                    val zipformerCtcConfig = zipformerCtcField.get(modelConfig)
                    
                    if (zipformerCtcConfig != null) {
                        val modelField = zipformerCtcConfig.javaClass.getDeclaredField("model")
                        modelField.isAccessible = true
                        files.add(modelField.get(zipformerCtcConfig) as String)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to access zipformer2Ctc config fields: ${e.message}")
                }
            }
            "nemo_ctc" -> {
                // Use reflection to get the neMoCtc model
                try {
                    val nemoCtcField = modelConfig.javaClass.getDeclaredField("neMoCtc")
                    nemoCtcField.isAccessible = true
                    val nemoCtcConfig = nemoCtcField.get(modelConfig)
                    
                    if (nemoCtcConfig != null) {
                        val modelField = nemoCtcConfig.javaClass.getDeclaredField("model")
                        modelField.isAccessible = true
                        files.add(modelField.get(nemoCtcConfig) as String)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to access neMoCtc config fields: ${e.message}")
                }
            }
        }
        
        // Add tokens file
        files.add(modelConfig.tokens)
        
        // Check if files exist
        for (filePath in files) {
            val file = File(filePath)
            if (!file.exists()) {
                Log.e(TAG, "File not found: $filePath")
                throw Exception("File not found: $filePath")
            } else {
                Log.i(TAG, "File verified: $filePath")
            }
        }
        
        return modelConfig
    }
    
    /**
     * Recognize speech from audio samples
     */
    fun recognizeFromSamples(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        Log.i(TAG, "Starting speech recognition with ${audioBuffer.size()} samples at $sampleRate Hz")
        executor.execute {
            try {
                val samples = audioBufferToFloatArray(audioBuffer)
                val resultMap = if (isStreaming) {
                    Log.i(TAG, "Using streaming recognition mode")
                    recognizeFromFloatSamplesStreaming(sampleRate, samples)
                } else {
                    Log.i(TAG, "Using offline recognition mode")
                    recognizeFromFloatSamplesOffline(sampleRate, samples)
                }

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error recognizing from samples: ${e.message}")
                e.printStackTrace()
                
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_ASR_RECOGNIZE", "Failed to recognize speech: ${e.message}")
                }
            }
        }
    }
    
    private fun shouldChunkOfflineWhisper(samplesLength: Int, sampleRate: Int): Boolean {
        if (isStreaming || sampleRate <= 0) {
            return false
        }

        val modelType = asrModelConfig?.getString("modelType") ?: return false
        if (modelType != "whisper") {
            return false
        }

        return samplesLength > sampleRate * OFFLINE_WHISPER_MAX_WINDOW_SECONDS
    }

    private fun isOfflineWhisperModel(): Boolean {
        if (isStreaming) {
            return false
        }
        return asrModelConfig?.getString("modelType") == "whisper"
    }

    private fun recognizeSingleOfflineWindow(sampleRate: Int, samples: FloatArray): WritableMap {
        try {
            if (offlineRecognizer == null) {
                Log.e(TAG, "Offline ASR is not initialized")
                throw Exception("Offline ASR is not initialized")
            }
            
            Log.i(TAG, "Creating offline stream")
            // Create stream
            val stream = offlineRecognizer?.createStream()
            if (stream == null) {
                Log.e(TAG, "Failed to create stream")
                throw Exception("Failed to create stream")
            }
            
            Log.i(TAG, "Accepting waveform with ${samples.size} samples")
            // Accept waveform
            stream.acceptWaveform(samples, sampleRate)
            
            // Start recognition
            isRecognizing = true
            Log.i(TAG, "Starting offline decoding")
            
            // Decode
            offlineRecognizer?.decode(stream)
            
            Log.i(TAG, "Getting recognition result")
            // Get result
            val result = offlineRecognizer?.getResult(stream)
            
            // Release stream
            stream.release()
            
            // End recognition
            isRecognizing = false
            
            Log.i(TAG, "Recognition completed successfully: ${result?.text}")
            
            // Return results
            val resultMap = Arguments.createMap()
            resultMap.putBoolean("success", true)
            resultMap.putString("text", result?.text ?: "")
            resultMap.putInt("samplesLength", samples.size)
            resultMap.putInt("sampleRate", sampleRate)
            return resultMap
        } catch (e: Exception) {
            Log.e(TAG, "Error recognizing from samples (offline): ${e.message}")
            e.printStackTrace()
            throw e
        }
    }

    /**
     * Recognize speech from audio samples using offline recognition.
     *
     * Whisper's offline recognizer only handles windows shorter than 30 seconds.
     * For longer buffers, decode sequential sub-30s windows and join the text.
     */
    private fun recognizeFromFloatSamplesOffline(sampleRate: Int, samples: FloatArray): WritableMap {
        if (!shouldChunkOfflineWhisper(samples.size, sampleRate)) {
            return recognizeSingleOfflineWindow(sampleRate, samples)
        }

        val samplesPerWindow = sampleRate * OFFLINE_WHISPER_MAX_WINDOW_SECONDS
        val totalWindows = (samples.size + samplesPerWindow - 1) / samplesPerWindow
        Log.i(
            TAG,
            "Chunking offline Whisper recognition into $totalWindows windows " +
                "(${OFFLINE_WHISPER_MAX_WINDOW_SECONDS}s each, ${samples.size} samples total)",
        )

        val transcriptParts = mutableListOf<String>()
        var offset = 0
        var windowIndex = 0

        while (offset < samples.size) {
            val end = minOf(offset + samplesPerWindow, samples.size)
            val windowSamples = samples.copyOfRange(offset, end)
            windowIndex += 1

            Log.i(
                TAG,
                "Decoding offline Whisper window $windowIndex/$totalWindows " +
                    "(samples ${offset + 1}..$end of ${samples.size})",
            )

            val windowResult = recognizeSingleOfflineWindow(sampleRate, windowSamples)
            val windowText = windowResult.getString("text")?.trim().orEmpty()
            if (windowText.isNotEmpty()) {
                transcriptParts.add(windowText)
            }

            offset = end
        }

        val fullText = transcriptParts.joinToString(" ").trim()
        Log.i(TAG, "Chunked offline Whisper recognition completed with ${fullText.length} characters")

        val resultMap = Arguments.createMap()
        resultMap.putBoolean("success", true)
        resultMap.putString("text", fullText)
        resultMap.putInt("samplesLength", samples.size)
        resultMap.putInt("sampleRate", sampleRate)
        resultMap.putInt("chunkCount", totalWindows)
        return resultMap
    }

    private fun recognizeOfflineWhisperFileInWindows(
        file: File,
        durationUs: Long,
    ): WritableMap {
        val windowDurationUs = OFFLINE_WHISPER_MAX_WINDOW_SECONDS * 1_000_000L
        val totalWindows = ((durationUs + windowDurationUs - 1) / windowDurationUs).toInt()
        Log.i(
            TAG,
            "Chunking offline Whisper file extraction into $totalWindows windows " +
                "(${OFFLINE_WHISPER_MAX_WINDOW_SECONDS}s each, durationUs=$durationUs)",
        )

        val transcriptParts = mutableListOf<String>()
        var offsetUs = 0L
        var totalSamples = 0
        var sampleRate = 0
        var windowIndex = 0

        while (offsetUs < durationUs) {
            val audioData = AudioExtractor.extractAudioWindowFromFile(
                file = file,
                startTimeUs = offsetUs,
                maxDurationUs = windowDurationUs,
            ) ?: throw Exception("Failed to extract audio window starting at ${offsetUs}us")

            if (audioData.samples.isEmpty()) {
                throw Exception("Extracted empty audio window starting at ${offsetUs}us")
            }

            sampleRate = audioData.sampleRate
            totalSamples += audioData.samples.size
            windowIndex += 1

            Log.i(
                TAG,
                "Decoding extracted offline Whisper window $windowIndex/$totalWindows " +
                    "(offsetUs=$offsetUs, samples=${audioData.samples.size})",
            )

            val windowResult = recognizeSingleOfflineWindow(audioData.sampleRate, audioData.samples)
            val windowText = windowResult.getString("text")?.trim().orEmpty()
            if (windowText.isNotEmpty()) {
                transcriptParts.add(windowText)
            }

            offsetUs += windowDurationUs
        }

        val fullText = transcriptParts.joinToString(" ").trim()
        Log.i(TAG, "Chunked offline Whisper file recognition completed with ${fullText.length} characters")

        val resultMap = Arguments.createMap()
        resultMap.putBoolean("success", true)
        resultMap.putString("text", fullText)
        resultMap.putInt("samplesLength", totalSamples)
        resultMap.putInt("sampleRate", sampleRate)
        resultMap.putInt("chunkCount", totalWindows)
        return resultMap
    }
    
    /**
     * Recognize speech from audio samples using streaming recognition
     */
    private fun recognizeFromFloatSamplesStreaming(sampleRate: Int, samples: FloatArray): WritableMap {
        try {
            if (onlineRecognizer == null) {
                Log.e(TAG, "Streaming ASR is not initialized")
                throw Exception("Streaming ASR is not initialized")
            }
            
            // Always create a fresh stream for file recognition
            onlineStream?.release()
            Log.i(TAG, "Creating new online stream")
            onlineStream = onlineRecognizer?.createStream()
            if (onlineStream == null) {
                Log.e(TAG, "Failed to create stream")
                throw Exception("Failed to create stream")
            }
            
            // Calculate samples per chunk using the default chunk size
            val samplesPerChunk = (sampleRate * DEFAULT_CHUNK_SIZE_MS / 1000).toInt()
            Log.i(TAG, "Using chunk size of ${DEFAULT_CHUNK_SIZE_MS}ms (${samplesPerChunk} samples)")
            
            // For file-based inference with a streaming model, simulate real-time streaming:
            // Feed audio in chunks, decode after each chunk. Collect text at endpoints but
            // do NOT reset — resetting loses the model's accumulated context and causes empty
            // results for subsequent segments. Accumulate the running transcript via getResult()
            // and only take the final result after all audio + tail padding is processed.
            isRecognizing = true

            var offset = 0
            var chunkCount = 0
            var endpointCount = 0

            val maxAbs = samples.maxOfOrNull { kotlin.math.abs(it) } ?: 0f
            val numZero = samples.count { it == 0f }
            Log.i(TAG, "Feeding ${samples.size} samples in ${samplesPerChunk}-sample chunks (maxAbs=$maxAbs, zeros=$numZero)")

            while (offset < samples.size) {
                val end = minOf(offset + samplesPerChunk, samples.size)
                val chunk = samples.copyOfRange(offset, end)
                onlineStream?.acceptWaveform(chunk, sampleRate)
                offset = end
                chunkCount++

                while (onlineRecognizer?.isReady(onlineStream!!) == true) {
                    onlineRecognizer?.decode(onlineStream!!)
                }

                if (onlineRecognizer?.isEndpoint(onlineStream!!) == true) {
                    endpointCount++
                    val partial = onlineRecognizer?.getResult(onlineStream!!)?.text?.trim() ?: ""
                    Log.i(TAG, "Endpoint #$endpointCount at chunk $chunkCount, partial: '$partial'")
                    // Do NOT reset — just log; resetting clears state and empties subsequent segments
                }
            }

            // Tail padding + inputFinished to flush look-ahead buffer
            val tailPadSamples = (sampleRate * 0.66).toInt()
            val tailPad = FloatArray(tailPadSamples)
            Log.i(TAG, "Tail pad after $chunkCount chunks ($endpointCount endpoints detected)")
            onlineStream?.acceptWaveform(tailPad, sampleRate)
            onlineStream?.inputFinished()

            while (onlineRecognizer?.isReady(onlineStream!!) == true) {
                onlineRecognizer?.decode(onlineStream!!)
            }

            val fullText = onlineRecognizer?.getResult(onlineStream!!)?.text?.trim() ?: ""
            Log.i(TAG, "Recognition result: '$fullText'")

            // Release stream so the next file recognition gets a fresh one
            onlineStream?.release()
            onlineStream = null
            isRecognizing = false

            // Return results
            val resultMap = Arguments.createMap()
            resultMap.putBoolean("success", true)
            resultMap.putString("text", fullText)
            resultMap.putInt("samplesLength", samples.size)
            resultMap.putInt("sampleRate", sampleRate)
            return resultMap
        } catch (e: Exception) {
            Log.e(TAG, "Error recognizing from samples (streaming): ${e.message}")
            e.printStackTrace()
            throw e
        }
    }

    private fun audioBufferToFloatArray(audioBuffer: ReadableArray): FloatArray {
        val samples = FloatArray(audioBuffer.size())
        for (i in 0 until audioBuffer.size()) {
            samples[i] = audioBuffer.getDouble(i).toFloat()
        }
        return samples
    }

    /**
     * Recognize speech from audio samples using offline recognition
     */
    private fun recognizeFromSamplesOffline(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        try {
            val samples = audioBufferToFloatArray(audioBuffer)
            val resultMap = recognizeFromFloatSamplesOffline(sampleRate, samples)
            reactContext.runOnUiQueueThread {
                promise.resolve(resultMap)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error recognizing from samples (offline): ${e.message}")
            e.printStackTrace()
            
            reactContext.runOnUiQueueThread {
                promise.reject("ERR_ASR_RECOGNIZE", "Failed to recognize speech (offline): ${e.message}")
            }
        }
    }
    
    /**
     * Recognize speech from audio samples using streaming recognition
     */
    private fun recognizeFromSamplesStreaming(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        try {
            val samples = audioBufferToFloatArray(audioBuffer)
            val resultMap = recognizeFromFloatSamplesStreaming(sampleRate, samples)
            reactContext.runOnUiQueueThread {
                promise.resolve(resultMap)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error recognizing from samples (streaming): ${e.message}")
            e.printStackTrace()
            
            reactContext.runOnUiQueueThread {
                promise.reject("ERR_ASR_RECOGNIZE", "Failed to recognize speech (streaming): ${e.message}")
            }
        }
    }
    
    /**
     * Recognize speech from an audio file
     */
    fun recognizeFromFile(filePath: String, promise: Promise) {
        Log.i(TAG, "Starting recognition from file: $filePath")
        executor.execute {
            try {
                // Create File object from path
                val fileObj = File(AssetUtils.cleanFilePath(filePath))
                Log.i(TAG, "Using file: ${fileObj.absolutePath}")

                val durationUs = if (isOfflineWhisperModel()) {
                    AudioExtractor.getAudioDurationUs(fileObj)
                } else {
                    null
                }

                val windowDurationUs = OFFLINE_WHISPER_MAX_WINDOW_SECONDS * 1_000_000L
                val resultMap = if (durationUs != null && durationUs > windowDurationUs) {
                    recognizeOfflineWhisperFileInWindows(fileObj, durationUs)
                } else {
                    Log.i(TAG, "Extracting audio from file")
                    val audioData = AudioExtractor.extractAudioFromFile(fileObj)

                    if (audioData == null) {
                        Log.e(TAG, "Failed to extract audio from file")
                        throw Exception("Failed to extract audio from file")
                    }

                    val samples = audioData.samples
                    val sampleRate = audioData.sampleRate
                    Log.i(TAG, "Extracted ${samples.size} samples at $sampleRate Hz")

                    if (isStreaming) {
                        Log.i(TAG, "Recognizing extracted samples with streaming mode")
                        recognizeFromFloatSamplesStreaming(sampleRate, samples)
                    } else {
                        Log.i(TAG, "Recognizing extracted samples with offline mode")
                        recognizeFromFloatSamplesOffline(sampleRate, samples)
                    }
                }

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error recognizing from file: ${e.message}")
                e.printStackTrace()
                
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_ASR_RECOGNIZE", "Failed to recognize speech from file: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Create a persistent online stream for live streaming ASR.
     * Matches upstream OnlineRecognizer.createStream().
     */
    fun createAsrOnlineStream(promise: Promise) {
        executor.execute {
            try {
                if (onlineRecognizer == null) {
                    throw Exception("Online ASR is not initialized. Call initAsr with streaming=true first.")
                }
                onlineStream?.release()
                onlineStream = onlineRecognizer?.createStream()
                if (onlineStream == null) {
                    throw Exception("Failed to create online stream")
                }
                Log.i(TAG, "Created online stream for live ASR")
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                reactContext.runOnUiQueueThread { promise.resolve(resultMap) }
            } catch (e: Exception) {
                Log.e(TAG, "Error creating online stream: ${e.message}")
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_ASR_STREAM", "Failed to create online stream: ${e.message}")
                }
            }
        }
    }

    /**
     * Feed audio samples to the persistent online stream and decode all ready frames.
     * Matches upstream stream.acceptWaveform() + isReady/decode loop.
     */
    fun acceptAsrOnlineWaveform(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        executor.execute {
            try {
                if (onlineRecognizer == null || onlineStream == null) {
                    throw Exception("Online stream not created. Call createAsrOnlineStream first.")
                }
                val samples = FloatArray(audioBuffer.size()) { audioBuffer.getDouble(it).toFloat() }
                onlineStream?.acceptWaveform(samples, sampleRate)
                while (onlineRecognizer?.isReady(onlineStream!!) == true) {
                    onlineRecognizer?.decode(onlineStream!!)
                }
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                reactContext.runOnUiQueueThread { promise.resolve(resultMap) }
            } catch (e: Exception) {
                Log.e(TAG, "Error accepting waveform: ${e.message}")
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_ASR_WAVEFORM", "Failed to accept waveform: ${e.message}")
                }
            }
        }
    }

    /**
     * Check if an endpoint (sentence boundary) has been detected.
     * Matches upstream OnlineRecognizer.isEndpoint(stream).
     */
    fun isAsrOnlineEndpoint(promise: Promise) {
        executor.execute {
            try {
                if (onlineRecognizer == null || onlineStream == null) {
                    throw Exception("Online stream not created. Call createAsrOnlineStream first.")
                }
                val isEndpoint = onlineRecognizer?.isEndpoint(onlineStream!!) == true
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("isEndpoint", isEndpoint)
                reactContext.runOnUiQueueThread { promise.resolve(resultMap) }
            } catch (e: Exception) {
                Log.e(TAG, "Error checking endpoint: ${e.message}")
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_ASR_ENDPOINT", "Failed to check endpoint: ${e.message}")
                }
            }
        }
    }

    /**
     * Get the current recognition result from the online stream.
     * Matches upstream OnlineRecognizer.getResult(stream).
     */
    fun getAsrOnlineResult(promise: Promise) {
        executor.execute {
            try {
                if (onlineRecognizer == null || onlineStream == null) {
                    throw Exception("Online stream not created. Call createAsrOnlineStream first.")
                }
                val result = onlineRecognizer?.getResult(onlineStream!!)
                val resultMap = Arguments.createMap()
                resultMap.putString("text", result?.text?.trim() ?: "")
                val tokensArray = Arguments.createArray()
                result?.tokens?.forEach { tokensArray.pushString(it) }
                resultMap.putArray("tokens", tokensArray)
                val timestampsArray = Arguments.createArray()
                result?.timestamps?.forEach { timestampsArray.pushDouble(it.toDouble()) }
                resultMap.putArray("timestamps", timestampsArray)
                reactContext.runOnUiQueueThread { promise.resolve(resultMap) }
            } catch (e: Exception) {
                Log.e(TAG, "Error getting result: ${e.message}")
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_ASR_RESULT", "Failed to get result: ${e.message}")
                }
            }
        }
    }

    /**
     * Reset the online stream for the next utterance (after endpoint).
     * Matches upstream OnlineRecognizer.reset(stream).
     */
    fun resetAsrOnlineStream(promise: Promise) {
        executor.execute {
            try {
                if (onlineRecognizer == null || onlineStream == null) {
                    throw Exception("Online stream not created. Call createAsrOnlineStream first.")
                }
                onlineRecognizer?.reset(onlineStream!!)
                Log.i(TAG, "Reset online stream")
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                reactContext.runOnUiQueueThread { promise.resolve(resultMap) }
            } catch (e: Exception) {
                Log.e(TAG, "Error resetting stream: ${e.message}")
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_ASR_RESET", "Failed to reset stream: ${e.message}")
                }
            }
        }
    }

    /**
     * Release all resources
     */
    fun release(promise: Promise) {
        executor.execute {
            try {
                releaseResources()
                
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("released", true)
                
                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error releasing ASR resources: ${e.message}")
                e.printStackTrace()
                
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_ASR_RELEASE", "Failed to release ASR resources: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Release resources used by the ASR engine
     */
    private fun releaseResources() {
        try {
            Log.i(TAG, "Releasing ASR resources")
            
            if (offlineStream != null) {
                Log.i(TAG, "Releasing offline stream")
                offlineStream?.release()
                offlineStream = null
            }
            
            if (offlineRecognizer != null) {
                Log.i(TAG, "Releasing offline recognizer")
                offlineRecognizer?.release()
                offlineRecognizer = null
            }
            
            if (onlineStream != null) {
                Log.i(TAG, "Releasing online stream")
                onlineStream?.release()
                onlineStream = null
            }
            
            if (onlineRecognizer != null) {
                Log.i(TAG, "Releasing online recognizer")
                onlineRecognizer?.release()
                onlineRecognizer = null
            }
            
            isRecognizing = false
            isStreaming = false
            
            Log.i(TAG, "ASR resources released successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Error in releaseResources: ${e.message}")
        }
    }
} 
