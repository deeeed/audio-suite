// packages/audio-studio/android/src/main/java/net/siteed/audiostudio/AudioStudioModule.kt
package net.siteed.audiostudio

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.content.pm.PackageManager
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.interfaces.permissions.Permissions
import java.util.zip.CRC32
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AudioStudioModule : Module(), EventSender {
    companion object {
        private const val CLASS_NAME = "AudioStudioModule"
    }
    
    private lateinit var audioRecorderManager: AudioRecorderManager
    private lateinit var audioProcessor: AudioProcessor
    private lateinit var audioDeviceManager: AudioDeviceManager
    private var enablePhoneStateHandling: Boolean = false // Default to false until we check manifest
    private var enableNotificationHandling: Boolean = false // Default to false until we check manifest
    private var enableBackgroundAudio: Boolean = false // Default to false until we check manifest
    private var enableDeviceDetection: Boolean = false // Default to false until we check manifest
    private val coroutineScope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val audioFileHandler by lazy { 
        AudioFileHandler(appContext.reactContext?.filesDir ?: throw IllegalStateException("React context not available")) 
    }
    
    private val audioTrimmer by lazy { 
        AudioTrimmer(
            appContext.reactContext ?: throw IllegalStateException("React context not available"), 
            audioFileHandler
        ) 
    }

    @RequiresApi(Build.VERSION_CODES.R)
    override fun definition() = ModuleDefinition {
        // The module will be accessible from `requireNativeModule('AudioStudio')` in JavaScript.
        Name("AudioStudio")

        // Check permissions declared in the manifest
        try {
            val context = appContext.reactContext ?: throw IllegalStateException("React context not available")
            val packageInfo = context.packageManager.getPackageInfo(
                context.packageName,
                PackageManager.GET_PERMISSIONS
            )
            
            // Check if READ_PHONE_STATE is in the requested permissions
            enablePhoneStateHandling = packageInfo.requestedPermissions?.contains(Manifest.permission.READ_PHONE_STATE) ?: false
            
            // Check if POST_NOTIFICATIONS is in the requested permissions
            enableNotificationHandling = packageInfo.requestedPermissions?.contains(Manifest.permission.POST_NOTIFICATIONS) ?: false
            
            // Check if background audio is enabled by looking for FOREGROUND_SERVICE_MICROPHONE permission
            enableBackgroundAudio = packageInfo.requestedPermissions?.contains(Manifest.permission.FOREGROUND_SERVICE_MICROPHONE) ?: false
            
            // Check if device detection is enabled by looking for BLUETOOTH_CONNECT permission
            enableDeviceDetection = packageInfo.requestedPermissions?.contains(Manifest.permission.BLUETOOTH_CONNECT) ?: false
            
            LogUtils.d(CLASS_NAME, "Phone state handling ${if (enablePhoneStateHandling) "enabled" else "disabled"} based on manifest permissions")
            LogUtils.d(CLASS_NAME, "Notification handling ${if (enableNotificationHandling) "enabled" else "disabled"} based on manifest permissions")
            LogUtils.d(CLASS_NAME, "Background audio handling ${if (enableBackgroundAudio) "enabled" else "disabled"} based on manifest permissions")
            LogUtils.d(CLASS_NAME, "Device detection ${if (enableDeviceDetection) "enabled" else "disabled"} based on manifest permissions")
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to check manifest permissions: ${e.message}", e)
            enablePhoneStateHandling = false
            enableNotificationHandling = false
            enableBackgroundAudio = false
            enableDeviceDetection = false
        }

        Events(
            Constants.AUDIO_EVENT_NAME,
            Constants.AUDIO_ANALYSIS_EVENT_NAME,
            Constants.RECORDING_INTERRUPTED_EVENT_NAME,
            Constants.TRIM_PROGRESS_EVENT,
            Constants.DEVICE_CHANGED_EVENT // Add device changed event name
        )

        // Initialize Managers
        initializeManager()

        // Add a convenience function to check for foreground service permission separately
        fun isForegroundServiceMicRequired(): Boolean {
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && enableBackgroundAudio
        }

        // Helper function to check if device detection is enabled
        fun isDeviceDetectionEnabled(): Boolean {
            return enableDeviceDetection
        }

        // Add device-related functions to the module
        
        // Gets available audio input devices with an optional refresh parameter
        AsyncFunction("getAvailableInputDevices") { options: Map<String, Any>?, promise: Promise ->
            try {
                LogUtils.d(CLASS_NAME, "getAvailableInputDevices called. Refresh: ${options?.get("refresh") ?: false}")
                
                // Check if refresh is requested
                if (options?.get("refresh") as? Boolean == true) {
                    audioDeviceManager.forceRefreshAudioDevices()
                }
                
                // Get the list of devices
                audioDeviceManager.getAvailableInputDevices(promise)
            } catch (e: Exception) {
                LogUtils.e(CLASS_NAME, "Error getting available input devices: ${e.message}", e)
                promise.reject("DEVICE_ERROR", "Failed to get available audio devices: ${e.message}", e)
            }
        }
        
        // Gets the currently selected audio input device
        AsyncFunction("getCurrentInputDevice") { promise: Promise ->
            try {
                LogUtils.d(CLASS_NAME, "getCurrentInputDevice called")
                audioDeviceManager.getCurrentInputDevice(promise)
            } catch (e: Exception) {
                LogUtils.e(CLASS_NAME, "Error getting current input device: ${e.message}", e)
                promise.reject("DEVICE_ERROR", "Failed to get current audio device: ${e.message}", e)
            }
        }
        
        // Selects a specific audio input device for recording
        AsyncFunction("selectInputDevice") { deviceId: String, promise: Promise ->
            try {
                LogUtils.d(CLASS_NAME, "selectInputDevice called with ID: $deviceId")
                audioDeviceManager.selectInputDevice(deviceId, promise)
                
                // Update recording if in progress
                if (audioRecorderManager.isRecording || audioRecorderManager.isPrepared) {
                    LogUtils.d(CLASS_NAME, "selectInputDevice: Notifying recorder of device change")
                    audioRecorderManager.handleDeviceChange()
                }
            } catch (e: Exception) {
                LogUtils.e(CLASS_NAME, "Error selecting input device: ${e.message}", e)
                promise.reject("DEVICE_ERROR", "Failed to select audio device: ${e.message}", e)
            }
        }
        
        // Resets to the default audio input device
        AsyncFunction("resetToDefaultDevice") { promise: Promise ->
            try {
                LogUtils.d(CLASS_NAME, "resetToDefaultDevice called")
                audioDeviceManager.resetToDefaultDevice { success, error ->
                    if (success) {
                        // Update recording if in progress
                        if (audioRecorderManager.isRecording || audioRecorderManager.isPrepared) {
                            LogUtils.d(CLASS_NAME, "resetToDefaultDevice: Notifying recorder of device change")
                            audioRecorderManager.handleDeviceChange()
                        }
                        promise.resolve(true)
                    } else {
                        LogUtils.e(CLASS_NAME, "Failed to reset to default device: ${error?.message}")
                        promise.reject("DEVICE_ERROR", "Failed to reset to default device: ${error?.message}", error)
                    }
                }
            } catch (e: Exception) {
                LogUtils.e(CLASS_NAME, "Error resetting to default device: ${e.message}", e)
                promise.reject("DEVICE_ERROR", "Failed to reset to default device: ${e.message}", e)
            }
        }
        
        // Refreshes the audio devices list
        Function("refreshAudioDevices") {
            LogUtils.d(CLASS_NAME, "refreshAudioDevices called")
            val success = audioDeviceManager.forceRefreshAudioDevices()
            return@Function mapOf("success" to success)
        }



        AsyncFunction("prepareRecording") { options: Map<String, Any?>, promise: Promise ->
            // Heavy native init (AudioRecord probe, MediaRecorder.prepare, file I/O)
            // must run off the main thread to keep the JS/UI thread responsive.
            // Module-scoped Job ensures cancellation on module destroy.
            coroutineScope.launch(Dispatchers.IO) {
                try {
                    val opts = if (options["showNotification"] as? Boolean == true && !enableNotificationHandling) {
                        LogUtils.d(CLASS_NAME, "Notification permission not in manifest, disabling showNotification")
                        options.toMutableMap().apply { this["showNotification"] = false }
                    } else {
                        options
                    }

                    if (audioRecorderManager.prepareRecording(opts)) {
                        promise.resolve(true)
                    } else {
                        promise.reject("PREPARE_ERROR", "Failed to prepare recording", null)
                    }
                } catch (e: Exception) {
                    LogUtils.e(CLASS_NAME, "Error preparing recording", e)
                    promise.reject("PREPARE_ERROR", "Failed to prepare recording: ${e.message}", e)
                }
            }
        }

        AsyncFunction("startRecording") { options: Map<String, Any?>, promise: Promise ->
            // If notifications are requested but permission not in manifest, modify options
            if (options["showNotification"] as? Boolean == true && !enableNotificationHandling) {
                val modifiedOptions = options.toMutableMap()
                modifiedOptions["showNotification"] = false
                LogUtils.d(CLASS_NAME, "Notification permission not in manifest, disabling showNotification")
                audioRecorderManager.startRecording(modifiedOptions, promise)
            } else {
                audioRecorderManager.startRecording(options, promise)
            }
        }

        Function("clearAudioFiles") {
            audioRecorderManager.clearAudioStorage()
        }

        Function("status") {
            return@Function audioRecorderManager.getStatus()
        }

        AsyncFunction("listAudioFiles") { promise: Promise ->
            audioRecorderManager.listAudioFiles(promise)
        }

        AsyncFunction("pauseRecording") { promise: Promise ->
            audioRecorderManager.pauseRecording(promise)
        }

        AsyncFunction("resumeRecording") { promise: Promise ->
            LogUtils.d(CLASS_NAME, "⏺️ resumeRecording() called from JS layer")
            try {
                audioRecorderManager.resumeRecording(object : Promise {
                    override fun resolve(value: Any?) {
                        LogUtils.d(CLASS_NAME, "⏺️ resumeRecording completed successfully")
                        promise.resolve(value)
                    }
                    override fun reject(code: String, message: String?, cause: Throwable?) {
                        LogUtils.e(CLASS_NAME, "⏺️ resumeRecording failed: $code - $message", cause)
                        promise.reject(code, message, cause)
                    }
                })
            } catch (e: Exception) {
                LogUtils.e(CLASS_NAME, "⏺️ Exception when calling resumeRecording: ${e.message}", e)
                promise.reject("RESUME_ERROR", "Failed to resume recording: ${e.message}", e)
            }
        }

        AsyncFunction("stopRecording") { promise: Promise ->
            audioRecorderManager.stopRecording(promise)
        }

        AsyncFunction("requestPermissionsAsync") { promise: Promise ->
            try {
                val permissions = mutableListOf(
                    Manifest.permission.RECORD_AUDIO
                )

                // Only add phone state permission if enabled
                if (enablePhoneStateHandling) {
                    permissions.add(Manifest.permission.READ_PHONE_STATE)
                }

                // Add foreground service permission for Android 14+ only if background audio is enabled
                if (isForegroundServiceMicRequired()) {
                    LogUtils.d(CLASS_NAME, "Adding FOREGROUND_SERVICE_MICROPHONE permission request")
                    permissions.add(Manifest.permission.FOREGROUND_SERVICE_MICROPHONE)
                }

                // Add device detection permissions if device detection is enabled
                if (isDeviceDetectionEnabled()) {
                    // BLUETOOTH_CONNECT is needed on Android 12+ to access device names/addresses
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
                        LogUtils.d(CLASS_NAME, "Adding BLUETOOTH_CONNECT permission request for device detection")
                    }
                }

                LogUtils.d(CLASS_NAME, "Requesting permissions: $permissions")
                Permissions.askForPermissionsWithPermissionsManager(
                    appContext.permissions,
                    promise,
                    *permissions.toTypedArray()
                )
            } catch (e: Exception) {
                LogUtils.e(CLASS_NAME, "Error requesting permissions", e)
                promise.reject("PERMISSION_ERROR", "Failed to request permissions: ${e.message}", e)
            }
        }

        AsyncFunction("getPermissionsAsync") { promise: Promise ->
            val permissions = mutableListOf(
                Manifest.permission.RECORD_AUDIO
            )

            // Only add phone state permission if enabled
            if (enablePhoneStateHandling) {
                permissions.add(Manifest.permission.READ_PHONE_STATE)
            }

            // Only check foreground service permission when background audio is enabled
            if (isForegroundServiceMicRequired()) {
                permissions.add(Manifest.permission.FOREGROUND_SERVICE_MICROPHONE)
            }

            // Add device detection permissions if enabled
            if (isDeviceDetectionEnabled()) {
                // BLUETOOTH_CONNECT is needed on Android 12+ to access device names/addresses
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
                }
            }

            Permissions.getPermissionsWithPermissionsManager(
                appContext.permissions,
                promise,
                *permissions.toTypedArray()
            )
        }

        AsyncFunction("requestNotificationPermissionsAsync") { promise: Promise ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && enableNotificationHandling) {
                // Only request notification permissions if enabled in manifest
                Permissions.askForPermissionsWithPermissionsManager(
                    appContext.permissions,
                    promise,
                    Manifest.permission.POST_NOTIFICATIONS
                )
            } else {
                // Either notifications not required or running on Android < 13
                promise.resolve(
                    bundleOf(
                        "status" to "granted",
                        "expires" to "never",
                        "granted" to true
                    )
                )
            }
        }

        AsyncFunction("getNotificationPermissionsAsync") { promise: Promise ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && enableNotificationHandling) {
                // Only check notification permissions if enabled in manifest
                Permissions.getPermissionsWithPermissionsManager(
                    appContext.permissions,
                    promise,
                    Manifest.permission.POST_NOTIFICATIONS
                )
            } else {
                // Either notifications not required or running on Android < 13
                promise.resolve(
                    bundleOf(
                        "status" to "granted",
                        "expires" to "never",
                        "granted" to true
                    )
                )
            }
        }

        AsyncFunction("trimAudio") { options: Map<String, Any>, promise: Promise ->
            // Trim does heavy decode/encode + file I/O — must run off the
            // shared module executor so other JS calls don't queue behind it.
            coroutineScope.launch(Dispatchers.IO) {
                try {
                    val fileUri = options["fileUri"] as? String ?: run {
                        promise.reject("INVALID_URI", "fileUri is required", null)
                        return@launch
                    }

                    LogUtils.d(CLASS_NAME, "trimAudio called with fileUri: $fileUri")
                    LogUtils.d(CLASS_NAME, "Full options: $options")

                    val mode = options["mode"] as? String ?: "single"
                    val startTimeMs = (options["startTimeMs"] as? Number)?.toLong()
                    val endTimeMs = (options["endTimeMs"] as? Number)?.toLong()

                    @Suppress("UNCHECKED_CAST")
                    val rawRanges = options["ranges"] as? List<Map<String, Any>>
                    val ranges = rawRanges?.map { range ->
                        mapOf(
                            "startTimeMs" to ((range["startTimeMs"] as? Number)?.toLong() ?: 0L),
                            "endTimeMs" to ((range["endTimeMs"] as? Number)?.toLong() ?: 0L)
                        )
                    }

                    val outputFileName = options["outputFileName"] as? String

                    @Suppress("UNCHECKED_CAST")
                    var outputFormatMap = options["outputFormat"] as? Map<String, Any>

                    if (outputFormatMap != null) {
                        val format = outputFormatMap["format"] as? String
                        if (format != null && format != "wav" && format != "aac" && format != "opus") {
                            LogUtils.w(CLASS_NAME, "Requested format '$format' is not fully supported. Using 'aac' instead.")
                            val newOutputFormat = HashMap<String, Any>(outputFormatMap)
                            newOutputFormat["format"] = "aac"
                            outputFormatMap = newOutputFormat
                        }
                    }

                    LogUtils.d(CLASS_NAME, "Output format options: $outputFormatMap")

                    val progressListener = object : AudioTrimmer.ProgressListener {
                        override fun onProgress(progress: Float, bytesProcessed: Long, totalBytes: Long) {
                            safeSendEvent(Constants.TRIM_PROGRESS_EVENT, mapOf(
                                "progress" to progress,
                                "bytesProcessed" to bytesProcessed,
                                "totalBytes" to totalBytes
                            ))
                        }
                    }

                    val startTime = System.currentTimeMillis()

                    val result = audioTrimmer.trimAudio(
                        fileUri = fileUri,
                        mode = mode,
                        startTimeMs = startTimeMs,
                        endTimeMs = endTimeMs,
                        ranges = ranges,
                        outputFileName = outputFileName,
                        outputFormat = outputFormatMap,
                        progressListener = progressListener
                    )

                    val processingTimeMs = System.currentTimeMillis() - startTime

                    val resultWithProcessingTime = result.toMutableMap()
                    resultWithProcessingTime["processingInfo"] = mapOf(
                        "durationMs" to processingTimeMs
                    )

                    LogUtils.d(CLASS_NAME, "Trim operation completed successfully in ${processingTimeMs}ms: $result")
                    promise.resolve(resultWithProcessingTime)
                } catch (e: Exception) {
                    LogUtils.e(CLASS_NAME, "Error trimming audio: ${e.message}", e)
                    promise.reject("TRIM_ERROR", "Error trimming audio: ${e.message}", e)
                }
            }
        }

        AsyncFunction("extractMelSpectrogram") { options: Map<String, Any>, promise: Promise ->
            // Heavy DSP: file decode + STFT + mel projection. Off the shared
            // module executor so other JS calls don't block.
            coroutineScope.launch(Dispatchers.IO) {
                try {
                    LogUtils.d(CLASS_NAME, "extractMelSpectrogram called with options: $options")
                
                    // Extract required parameters with detailed logging
                    val fileUri = options["fileUri"] as? String
                    LogUtils.d(CLASS_NAME, "fileUri: $fileUri")
                    if (fileUri == null) {
                        LogUtils.e(CLASS_NAME, "Missing required parameter: fileUri")
                        throw IllegalArgumentException("fileUri is required")
                    }
                
                    val windowSizeMs = options["windowSizeMs"] as? Double
                    LogUtils.d(CLASS_NAME, "windowSizeMs: $windowSizeMs")
                    if (windowSizeMs == null) {
                        LogUtils.e(CLASS_NAME, "Missing required parameter: windowSizeMs")
                        throw IllegalArgumentException("windowSizeMs is required")
                    }
                
                    val hopLengthMs = options["hopLengthMs"] as? Double
                    LogUtils.d(CLASS_NAME, "hopLengthMs: $hopLengthMs")
                    if (hopLengthMs == null) {
                        LogUtils.e(CLASS_NAME, "Missing required parameter: hopLengthMs")
                        throw IllegalArgumentException("hopLengthMs is required")
                    }
                
                    // Handle nMels which might come as Double from JavaScript
                    val nMelsValue = options["nMels"]
                    LogUtils.d(CLASS_NAME, "Raw nMels value: $nMelsValue (type: ${nMelsValue?.javaClass?.name})")
                
                    val nMels = when (nMelsValue) {
                        is Int -> nMelsValue
                        is Double -> nMelsValue.toInt()
                        is Number -> nMelsValue.toInt()
                        else -> {
                            LogUtils.e(CLASS_NAME, "Missing or invalid required parameter: nMels")
                            throw IllegalArgumentException("nMels is required and must be a number")
                        }
                    }
                
                    LogUtils.d(CLASS_NAME, "Converted nMels: $nMels (from ${nMelsValue?.javaClass?.name})")

                    // Extract optional parameters with defaults
                    val fMin = options["fMin"] as? Double ?: 0.0
                    val fMax = options["fMax"] as? Double
                    val windowType = options["windowType"] as? String ?: "hann"
                    val normalize = options["normalize"] as? Boolean ?: false
                    val logScale = options["logScale"] as? Boolean ?: true
                
                    // Fix the conversion from Number to Long to preserve decimal values
                    val startTimeMsNumber = options["startTimeMs"] as? Number
                    val endTimeMsNumber = options["endTimeMs"] as? Number
                    val startTimeMs = startTimeMsNumber?.toLong() ?: startTimeMsNumber?.toDouble()?.toLong()
                    val endTimeMs = endTimeMsNumber?.toLong() ?: endTimeMsNumber?.toDouble()?.toLong()

                    LogUtils.d(CLASS_NAME, """
                        Optional parameters:
                        - fMin: $fMin
                        - fMax: $fMax
                        - windowType: $windowType
                        - normalize: $normalize
                        - logScale: $logScale
                        - startTimeMs: $startTimeMs (original: $startTimeMsNumber)
                        - endTimeMs: $endTimeMs (original: $endTimeMsNumber)
                    """.trimIndent())

                    // Handle decoding options
                    val decodingOptions = options["decodingOptions"] as? Map<String, Any>
                    LogUtils.d(CLASS_NAME, "Decoding options: $decodingOptions")
                
                    val config = decodingOptions?.let {
                        val targetSampleRateValue = it["targetSampleRate"]
                        val targetSampleRate = when (targetSampleRateValue) {
                            is Int -> targetSampleRateValue
                            is Double -> targetSampleRateValue.toInt()
                            is Number -> targetSampleRateValue.toInt()
                            else -> null
                        }
                    
                        val targetChannelsValue = it["targetChannels"]
                        val targetChannels = when (targetChannelsValue) {
                            is Int -> targetChannelsValue
                            is Double -> targetChannelsValue.toInt()
                            is Number -> targetChannelsValue.toInt()
                            else -> 1
                        }
                    
                        val targetBitDepthValue = it["targetBitDepth"]
                        val targetBitDepth = when (targetBitDepthValue) {
                            is Int -> targetBitDepthValue
                            is Double -> targetBitDepthValue.toInt()
                            is Number -> targetBitDepthValue.toInt()
                            else -> 16
                        }
                    
                        val normalizeAudio = it["normalizeAudio"] as? Boolean ?: false
                    
                        DecodingConfig(
                            targetSampleRate = targetSampleRate,
                            targetChannels = targetChannels,
                            targetBitDepth = targetBitDepth,
                            normalizeAudio = normalizeAudio
                        ).also { config ->
                            LogUtils.d(CLASS_NAME, """
                                Using decoding config:
                                - targetSampleRate: ${config.targetSampleRate ?: "original"}
                                - targetChannels: ${config.targetChannels ?: "original"}
                                - targetBitDepth: ${config.targetBitDepth}
                                - normalizeAudio: ${config.normalizeAudio}
                            """.trimIndent())
                        }
                    } ?: DecodingConfig(targetSampleRate = null, targetChannels = 1, targetBitDepth = 16).also {
                        LogUtils.d(CLASS_NAME, "Using default decoding config")
                    }

                    // Check if the audio data is too short
                    if (startTimeMs != null && endTimeMs != null) {
                        val durationMs = endTimeMs - startTimeMs
                        LogUtils.d(CLASS_NAME, "Audio duration for spectrogram: $durationMs ms")
                        if (durationMs < 25) {  // 25ms is minimum for a single window
                            LogUtils.w(CLASS_NAME, "Audio duration is too short for spectrogram analysis: $durationMs ms")
                            throw IllegalArgumentException("Audio duration must be at least 25ms for spectrogram analysis")
                        }
                    }

                    // Load audio data with optional time range
                    LogUtils.d(CLASS_NAME, "Loading audio data...")
                    val audioData = when {
                        startTimeMs != null && endTimeMs != null -> {
                            LogUtils.d(CLASS_NAME, "Loading audio range: $startTimeMs to $endTimeMs ms")
                            audioProcessor.loadAudioRange(fileUri, startTimeMs, endTimeMs, config)
                        }
                        else -> {
                            LogUtils.d(CLASS_NAME, "Loading entire audio file")
                            audioProcessor.loadAudioFromAnyFormat(fileUri, config)
                        }
                    }
                
                    if (audioData == null) {
                        LogUtils.e(CLASS_NAME, "Failed to load audio data")
                        throw IllegalStateException("Failed to load audio data")
                    }
                
                    LogUtils.d(CLASS_NAME, """
                        Audio data loaded successfully:
                        - data size: ${audioData.data.size} bytes
                        - sampleRate: ${audioData.sampleRate}
                        - channels: ${audioData.channels}
                        - bitDepth: ${audioData.bitDepth}
                        - durationMs: ${audioData.durationMs}
                    """.trimIndent())

                    // Validate that we have enough audio data for processing
                    if (audioData.data.size == 0 || audioData.durationMs < windowSizeMs) {
                        LogUtils.e(CLASS_NAME, "Audio data is too short for spectrogram analysis: ${audioData.durationMs}ms, data size: ${audioData.data.size} bytes")
                        throw IllegalArgumentException(
                            "Audio data is too short for spectrogram analysis. " +
                            "Duration: ${audioData.durationMs}ms, minimum required: ${windowSizeMs}ms"
                        )
                    }

                    // Compute mel-spectrogram
                    LogUtils.d(CLASS_NAME, "Computing mel-spectrogram...")
                    val spectrogramData = audioProcessor.extractMelSpectrogram(
                        audioData = audioData,
                        windowSizeMs = windowSizeMs.toFloat(),
                        hopLengthMs = hopLengthMs.toFloat(),
                        nMels = nMels,
                        fMin = fMin.toFloat(),
                        fMax = fMax?.toFloat() ?: (audioData.sampleRate.toFloat() / 2),
                        normalize = normalize,
                        logScaling = logScale,
                        windowType = windowType
                    )
                
                    LogUtils.d(CLASS_NAME, "Mel-spectrogram computed successfully with ${spectrogramData.spectrogram.size} time steps")

                    // Convert to map for React Native
                    val result = mapOf(
                        "spectrogram" to spectrogramData.spectrogram.map { it.toList() },
                        "sampleRate" to audioData.sampleRate,
                        "nMels" to nMels,
                        "timeSteps" to spectrogramData.spectrogram.size,
                        "durationMs" to audioData.durationMs
                    )
                
                    LogUtils.d(CLASS_NAME, "Returning result with ${result["timeSteps"]} time steps and $nMels mel bands")
                    promise.resolve(result)
                } catch (e: Exception) {
                    LogUtils.e(CLASS_NAME, "Failed to extract mel-spectrogram: ${e.message}")
                    LogUtils.e(CLASS_NAME, "Stack trace: ${e.stackTraceToString()}")
                    promise.reject("SPECTROGRAM_ERROR", e.message ?: "Unknown error", e)
                }
            }
        }

        OnDestroy {
            // Cancel in-flight prepare/trim/extract coroutines so promises
            // and event sends do not outlive the React context. Use
            // cancelChildren rather than cancel() so the scope itself stays
            // usable: Expo can re-invoke definition() on dev-client reloads
            // while keeping the same module instance, and a fully cancelled
            // scope would silently no-op every subsequent launch.
            coroutineScope.coroutineContext.cancelChildren()
            AudioRecorderManager.destroy()
        }

        // Add a new function to check if recording is actually running
        AsyncFunction("checkRecordingStatus") { promise: Promise ->
            val isServiceRunning = AudioRecordingService.isServiceRunning()

            val status = audioRecorderManager.getStatus()
            
            // If service is running but isRecording is false, we need to cleanup
            if (isServiceRunning && !status.getBoolean("isRecording")) {
                audioRecorderManager.cleanup()
                AudioRecordingService.stopService(appContext.reactContext!!)
            }
            
            promise.resolve(status)
        }


        AsyncFunction("extractPreviewBars") { options: Map<String, Any>, promise: Promise ->
            coroutineScope.launch(Dispatchers.IO) {
                try {
                    val fileUri = requireNotNull(options["fileUri"] as? String) { "fileUri is required" }
                    val numberOfBars = (options["numberOfBars"] as? Number)?.toInt() ?: 100
                    val startTimeMs = options["startTimeMs"] as? Number
                    val endTimeMs = options["endTimeMs"] as? Number

                    val defaultConfig = DecodingConfig(
                        targetSampleRate = null,
                        targetChannels = 1,
                        targetBitDepth = 16,
                        normalizeAudio = false
                    )
                    val decodingOptionsMap = options["decodingOptions"] as? Map<String, Any>
                    val config = decodingOptionsMap?.let {
                        DecodingConfig(
                            targetSampleRate = (it["targetSampleRate"] as? Number)?.toInt(),
                            targetChannels = (it["targetChannels"] as? Number)?.toInt(),
                            targetBitDepth = (it["targetBitDepth"] as? Number)?.toInt() ?: 16,
                            normalizeAudio = (it["normalizeAudio"] as? Boolean) ?: false
                        )
                    } ?: defaultConfig
                    val silenceRmsThreshold = ((decodingOptionsMap?.get("silenceRmsThreshold") as? Number)?.toFloat()) ?: 0.01f

                    val audioData = audioProcessor.loadAudioFromAnyFormat(fileUri, config)
                        ?: throw IllegalStateException("Failed to load audio data")
                    val result = audioProcessor.generatePreviewBars(
                        audioData = audioData,
                        numberOfBars = numberOfBars,
                        startTimeMs = startTimeMs?.toLong(),
                        endTimeMs = endTimeMs?.toLong(),
                        silenceRmsThreshold = silenceRmsThreshold
                    )
                    promise.resolve(result)
                } catch (e: Exception) {
                    LogUtils.e(CLASS_NAME, "Failed to extract preview bars: ${e.message}", e)
                    promise.reject("PROCESSING_ERROR", e.message ?: "Unknown error", e)
                }
            }
        }

        AsyncFunction("extractAudioAnalysis") { options: Map<String, Any>, promise: Promise ->
            // Off the shared executor so other JS calls don't block during
            // multi-second analysis on large files.
            coroutineScope.launch(Dispatchers.IO) {
                try {
                    val fileUri = requireNotNull(options["fileUri"] as? String) { "fileUri is required" }

                    // Get time or byte range options
                    val startTimeMs = options["startTimeMs"] as? Number
                    val endTimeMs = options["endTimeMs"] as? Number
                    val position = options["position"] as? Number
                    val length = options["length"] as? Number
                    val segmentDurationMs = (options["segmentDurationMs"] as? Number)?.toInt() ?: 100
                
                    // Validate ranges - can have time range OR byte range OR no range
                    val hasTimeRange = startTimeMs != null && endTimeMs != null
                    val hasByteRange = position != null && length != null
                
                    // Only throw if both ranges are provided
                    if (hasTimeRange && hasByteRange) {
                        throw IllegalArgumentException("Cannot specify both time range and byte range")
                    }

                    // Get decoding options with default configuration
                    val defaultConfig = DecodingConfig(
                        targetSampleRate = null,
                        targetChannels = 1, // Default to mono
                        targetBitDepth = 16,
                        normalizeAudio = false
                    )
                
                    val config = (options["decodingOptions"] as? Map<String, Any>)?.let { decodingOptionsMap ->
                        DecodingConfig(
                            targetSampleRate = decodingOptionsMap["targetSampleRate"] as? Int,
                            targetChannels = decodingOptionsMap["targetChannels"] as? Int,
                            targetBitDepth = (decodingOptionsMap["targetBitDepth"] as? Int) ?: 16,
                            normalizeAudio = (decodingOptionsMap["normalizeAudio"] as? Boolean) ?: false
                        )
                    } ?: defaultConfig

                    // Load audio data based on range type (or full file if no range specified)
                    val audioData = when {
                        hasByteRange -> {
                            val format = audioProcessor.getAudioFormat(fileUri) 
                                ?: throw IllegalArgumentException("Could not determine audio format")
                        
                            // Calculate time range from byte position
                            val bytesPerSecond = format.sampleRate * format.channels * (format.bitDepth / 8)
                            val effectiveStartTimeMs = (position!!.toLong() * 1000) / bytesPerSecond
                            val effectiveEndTimeMs = effectiveStartTimeMs + (length!!.toLong() * 1000) / bytesPerSecond
                        
                            LogUtils.d(CLASS_NAME, "Loading audio with byte range: position=$position, length=$length")
                        
                            audioProcessor.loadAudioRange(
                                fileUri = fileUri,
                                startTimeMs = effectiveStartTimeMs,
                                endTimeMs = effectiveEndTimeMs,
                                config = config
                            )
                        }
                        hasTimeRange -> {
                            LogUtils.d(CLASS_NAME, "Loading audio with time range: startTimeMs=$startTimeMs, endTimeMs=$endTimeMs")
                        
                            audioProcessor.loadAudioRange(
                                fileUri = fileUri,
                                startTimeMs = startTimeMs!!.toLong(),
                                endTimeMs = endTimeMs!!.toLong(),
                                config = config
                            )
                        }
                        else -> {
                            LogUtils.d(CLASS_NAME, "Loading entire audio file")
                            audioProcessor.loadAudioFromAnyFormat(fileUri, config)
                        }
                    } ?: throw IllegalStateException("Failed to load audio data")

                    val featuresMap = options["features"] as? Map<*, *>
                    val features = Features.parseFeatureOptions(featuresMap)

                    val recordingConfig = RecordingConfig(
                        sampleRate = audioData.sampleRate,
                        channels = audioData.channels,
                        encoding = when (audioData.bitDepth) {
                            8 -> "pcm_8bit"
                            16 -> "pcm_16bit"
                            32 -> "pcm_32bit"
                            else -> throw IllegalArgumentException("Unsupported bit depth: ${audioData.bitDepth}")
                        },
                        segmentDurationMs = segmentDurationMs,
                        features = features
                    )

                    LogUtils.d(CLASS_NAME, "extractAudioAnalysis: $recordingConfig")
                    audioProcessor.resetCumulativeAmplitudeRange()

                    val analysisData = audioProcessor.processAudioData(audioData.data, recordingConfig)
                    promise.resolve(analysisData.toDictionary())
                } catch (e: Exception) {
                    LogUtils.e(CLASS_NAME, "Failed to extract audio analysis: ${e.message}", e)
                    promise.reject("PROCESSING_ERROR", e.message ?: "Unknown error", e)
                }
            }
        }

        AsyncFunction("extractAudioData") { options: Map<String, Any>, promise: Promise ->
            // Off the shared executor so concurrent JS calls don't block.
            coroutineScope.launch(Dispatchers.IO) {
                try {
                    val fileUri = requireNotNull(options["fileUri"] as? String) { "fileUri is required" }
                    val startTimeMs = options["startTimeMs"] as? Number
                    val endTimeMs = options["endTimeMs"] as? Number
                    val position = options["position"] as? Number
                    val length = options["length"] as? Number
                
                    // Validate that we have either time range or byte range, but not both and not neither
                    val hasTimeRange = startTimeMs != null && endTimeMs != null
                    val hasByteRange = position != null && length != null
                
                    if (!hasTimeRange && !hasByteRange) {
                        throw IllegalArgumentException("Must specify either time range (startTimeMs, endTimeMs) or byte range (position, length)")
                    }
                    if (hasTimeRange && hasByteRange) {
                        throw IllegalArgumentException("Cannot specify both time range and byte range")
                    }
                
                    // Get decoding options
                    val decodingOptionsMap = options["decodingOptions"] as? Map<String, Any>
                    val decodingConfig = if (decodingOptionsMap != null) {
                        DecodingConfig(
                            targetSampleRate = decodingOptionsMap["targetSampleRate"] as? Int,
                            targetChannels = decodingOptionsMap["targetChannels"] as? Int,
                            targetBitDepth = (decodingOptionsMap["targetBitDepth"] as? Int) ?: 16,
                            normalizeAudio = (decodingOptionsMap["normalizeAudio"] as? Boolean) ?: false
                        ).also {
                            LogUtils.d(CLASS_NAME, """
                                Using decoding config:
                                - targetSampleRate: ${it.targetSampleRate ?: "original"}
                                - targetChannels: ${it.targetChannels ?: "original"}
                                - targetBitDepth: ${it.targetBitDepth}
                                - normalizeAudio: ${it.normalizeAudio}
                            """.trimIndent())
                        }
                    } else null

                    val audioData = if (hasByteRange) {
                        val format = audioProcessor.getAudioFormat(fileUri) 
                            ?: throw IllegalArgumentException("Could not determine audio format")
                    
                        // Calculate time range from byte position
                        val bytesPerSecond = format.sampleRate * format.channels * (format.bitDepth / 8)
                        val effectiveStartTimeMs = (position!!.toLong() * 1000) / bytesPerSecond
                        val effectiveEndTimeMs = effectiveStartTimeMs + (length!!.toLong() * 1000) / bytesPerSecond
                    
                        LogUtils.d(CLASS_NAME, """
                            Converting byte range to time range:
                            - position: $position bytes
                            - length: $length bytes
                            - bytesPerSecond: $bytesPerSecond
                            - effectiveStartTimeMs: $effectiveStartTimeMs
                            - effectiveEndTimeMs: $effectiveEndTimeMs
                        """.trimIndent())
                    
                        audioProcessor.loadAudioRange(
                            fileUri = fileUri,
                            startTimeMs = effectiveStartTimeMs,
                            endTimeMs = effectiveEndTimeMs,
                            config = decodingConfig
                        )
                    } else {
                        // Must be time range due to earlier validation
                        LogUtils.d(CLASS_NAME, """
                            Using time range:
                            - startTimeMs: $startTimeMs
                            - endTimeMs: $endTimeMs
                        """.trimIndent())
                    
                        audioProcessor.loadAudioRange(
                            fileUri = fileUri,
                            startTimeMs = startTimeMs!!.toLong(),
                            endTimeMs = endTimeMs!!.toLong(),
                            config = decodingConfig
                        )
                    } ?: throw IllegalStateException("Failed to load audio data")

                    LogUtils.d(CLASS_NAME, """
                        Audio data loaded successfully:
                        - data size: ${audioData.data.size} bytes
                        - sampleRate: ${audioData.sampleRate}
                        - channels: ${audioData.channels}
                        - bitDepth: ${audioData.bitDepth}
                        - durationMs: ${audioData.durationMs}
                    """.trimIndent())

                    val includeNormalizedData = options["includeNormalizedData"] as? Boolean ?: false
                    val includeBase64Data = options["includeBase64Data"] as? Boolean ?: false
                    val includeWavHeader = options["includeWavHeader"] as? Boolean ?: false
                    val bytesPerSample = audioData.bitDepth / 8
                    val samples = audioData.data.size / (bytesPerSample * audioData.channels)
                
                    // Create the result map
                    val resultMap = mutableMapOf<String, Any>()
                
                    // Add WAV header if requested
                    if (includeWavHeader) {
                        // Use ByteArrayOutputStream to write the WAV header and data
                        val outputStream = java.io.ByteArrayOutputStream()
                        val audioFileHandler = AudioFileHandler(appContext.reactContext!!.filesDir)
                    
                        // Write the WAV header
                        audioFileHandler.writeWavHeader(
                            outputStream,
                            audioData.sampleRate,
                            audioData.channels,
                            audioData.bitDepth
                        )
                    
                        // Write the PCM data
                        outputStream.write(audioData.data)
                    
                        // Get the complete WAV data
                        val wavData = outputStream.toByteArray()
                    
                        resultMap["pcmData"] = wavData
                        resultMap["hasWavHeader"] = true
                    
                        LogUtils.d(CLASS_NAME, "Added WAV header to PCM data, total size: ${wavData.size} bytes")
                    } else {
                        resultMap["pcmData"] = audioData.data
                        resultMap["hasWavHeader"] = false
                    }
                
                    // Add the rest of the data
                    resultMap.putAll(mapOf(
                        "sampleRate" to audioData.sampleRate,
                        "channels" to audioData.channels,
                        "bitDepth" to audioData.bitDepth,
                        "durationMs" to audioData.durationMs,
                        "format" to "pcm_${audioData.bitDepth}bit",
                        "samples" to samples
                    ))
                
                    // Add checksum if requested
                    if (options["computeChecksum"] == true) {
                        val crc32 = CRC32()
                        crc32.update(audioData.data)
                        resultMap["checksum"] = crc32.value.toInt()
                    
                        LogUtils.d(CLASS_NAME, "Computed CRC32 checksum: ${crc32.value}")
                    }
                
                    if (includeNormalizedData) {
                        val float32Data = AudioFormatUtils.convertByteArrayToFloatArray(
                            audioData.data,
                            "pcm_${audioData.bitDepth}bit"
                        )
                        resultMap["normalizedData"] = float32Data
                    }
                
                    if (includeBase64Data) {
                        // Convert the PCM data to a base64 string
                        val base64Data = android.util.Base64.encodeToString(
                            audioData.data, 
                            android.util.Base64.NO_WRAP
                        )
                        resultMap["base64Data"] = base64Data
                    }
                
                    promise.resolve(resultMap)
                } catch (e: Exception) {
                    LogUtils.e(CLASS_NAME, "Failed to extract audio data: ${e.message}")
                    LogUtils.e(CLASS_NAME, "Stack trace: ${e.stackTraceToString()}")
                    promise.reject("PROCESSING_ERROR", e.message ?: "Unknown error", e)
                }
            }
        }
    }

    private fun initializeManager() {
        val context = appContext.reactContext ?: throw IllegalStateException("React context not available")
        val filesDir = context.filesDir
        val permissionUtils = PermissionUtils(context)
        val audioDataEncoder = AudioDataEncoder()
        
        // Initialize AudioDeviceManager
        LogUtils.d(CLASS_NAME, "🔧 Initializing AudioDeviceManager...")
        LogUtils.d(CLASS_NAME, "🔧 Device detection enabled: $enableDeviceDetection")
        audioDeviceManager = AudioDeviceManager(context, enableDeviceDetection)
        LogUtils.d(CLASS_NAME, "🔧 AudioDeviceManager initialized")
        
        // Initialize AudioRecorderManager with AudioDeviceManager integration
        audioRecorderManager = AudioRecorderManager.initialize(
            context,
            filesDir,
            permissionUtils,
            audioDataEncoder,
            this,
            enablePhoneStateHandling,
            enableBackgroundAudio
        )
        
        // Set up the delegate for the AudioDeviceManager
        audioDeviceManager.delegate = object : AudioDeviceManagerDelegate {
            override fun onDeviceDisconnected(deviceId: String) {
                LogUtils.d(CLASS_NAME, "📱 Device disconnected: $deviceId")
                // Handle device disconnection
                coroutineScope.launch {
                    try {
                        // If recording is active, handle the disconnection based on the recording config
                        if (audioRecorderManager.isRecording) {
                            handleDeviceDisconnection(deviceId)
                        }
                        
                        // Notify JS about the disconnection
                        safeSendEvent(Constants.DEVICE_CHANGED_EVENT, bundleOf(
                            "type" to "deviceDisconnected",
                            "deviceId" to deviceId
                        ))
                    } catch (e: Exception) {
                        LogUtils.e(CLASS_NAME, "📱 Error handling device disconnection: ${e.message}", e)
                    }
                }
            }
        }
        
        // Set up connection callback
        audioDeviceManager.onDeviceConnected = { deviceId ->
            LogUtils.d(CLASS_NAME, "📱 Device connected: $deviceId")
            // Notify JS about the connection
            safeSendEvent(Constants.DEVICE_CHANGED_EVENT, bundleOf(
                "type" to "deviceConnected",
                "deviceId" to deviceId
            ))
        }
        
        // Set up disconnection callback
        audioDeviceManager.onDeviceDisconnected = { deviceId ->
            LogUtils.d(CLASS_NAME, "📱 Device disconnected: $deviceId")
            // Notify JS about the disconnection
            safeSendEvent(Constants.DEVICE_CHANGED_EVENT, bundleOf(
                "type" to "deviceDisconnected",
                "deviceId" to deviceId
            ))
        }
        
        audioProcessor = AudioProcessor(filesDir)
    }
    
    private fun safeSendEvent(eventName: String, params: Bundle) {
        AndroidEventEmitter.safeSend(CLASS_NAME, eventName) {
            sendEvent(eventName, params)
        }
    }

    private fun safeSendEvent(eventName: String, params: Map<String, Any?>) {
        AndroidEventEmitter.safeSend(CLASS_NAME, eventName) {
            sendEvent(eventName, params)
        }
    }

    /**
     * Handles audio device disconnection based on the recording configuration
     */
    private suspend fun handleDeviceDisconnection(deviceId: String) {
        LogUtils.d(CLASS_NAME, "📱 handleDeviceDisconnection called for device: $deviceId")
        // Get disconnection behavior from recorder config
        val behavior = audioRecorderManager.getDeviceDisconnectionBehavior()
        LogUtils.d(CLASS_NAME, "📱 Device disconnection behavior configured as: $behavior")
        
        when (behavior) {
            "fallback" -> {
                LogUtils.d(CLASS_NAME, "📱 Using fallback behavior, getting default device")
                // Get default device
                val defaultDevice = withContext(Dispatchers.IO) {
                    audioDeviceManager.getDefaultInputDevice()
                }
                
                if (defaultDevice != null) {
                    LogUtils.d(CLASS_NAME, "📱 Falling back to default device: ${defaultDevice["name"]}")
                    
                    // Select default device
                    val deviceId = defaultDevice["id"] as String
                    LogUtils.d(CLASS_NAME, "📱 Attempting to select default device: $deviceId")
                    val success = audioDeviceManager.selectDevice(deviceId)
                    
                    if (success) {
                        LogUtils.d(CLASS_NAME, "📱 Successfully selected default device, notifying AudioRecorderManager")
                        // Notify AudioRecorderManager to update its recording source
                        audioRecorderManager.handleDeviceChange()
                        
                        // Notify JS about fallback
                        LogUtils.d(CLASS_NAME, "📱 Sending deviceFallback event to JS")
                        safeSendEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                            "reason" to "deviceFallback",
                            "isPaused" to false,
                            "deviceId" to deviceId
                        ))
                    } else {
                        LogUtils.e(CLASS_NAME, "📱 Failed to select default device, pausing recording")
                        
                        // Fall back to pause if we can't select the default device
                        audioRecorderManager.pauseRecording(object : Promise {
                            override fun resolve(value: Any?) {
                                LogUtils.d(CLASS_NAME, "📱 Recording successfully paused, notifying AudioRecorderManager")
                                // Notify AudioRecorderManager to handle device change while paused
                                audioRecorderManager.handleDeviceChange()
                                
                                safeSendEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                                    "reason" to "deviceSwitchFailed",
                                    "isPaused" to true
                                ))
                            }
                            override fun reject(code: String, message: String?, cause: Throwable?) {
                                LogUtils.e(CLASS_NAME, "📱 Failed to pause recording after device disconnection: $message")
                            }
                        })
                    }
                } else {
                    LogUtils.e(CLASS_NAME, "📱 No default device found, pausing recording")
                    
                    // Fall back to pause if we can't find a default device
                    audioRecorderManager.pauseRecording(object : Promise {
                        override fun resolve(value: Any?) {
                            LogUtils.d(CLASS_NAME, "📱 Recording successfully paused when no default device found")
                            // Notify AudioRecorderManager to handle device change while paused
                            audioRecorderManager.handleDeviceChange()
                            
                            safeSendEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                                "reason" to "deviceDisconnected",
                                "isPaused" to true
                            ))
                        }
                        override fun reject(code: String, message: String?, cause: Throwable?) {
                            LogUtils.e(CLASS_NAME, "📱 Failed to pause recording after device disconnection: $message")
                        }
                    })
                }
            }
            
            else -> { // Default to pause behavior
                LogUtils.d(CLASS_NAME, "📱 Using pause behavior for device disconnection")
                
                // Pause recording
                audioRecorderManager.pauseRecording(object : Promise {
                    override fun resolve(value: Any?) {
                        LogUtils.d(CLASS_NAME, "📱 Recording successfully paused after device disconnection")
                        // Notify AudioRecorderManager to handle device change while paused
                        audioRecorderManager.handleDeviceChange()
                        
                        safeSendEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                            "reason" to "deviceDisconnected",
                            "isPaused" to true
                        ))
                    }
                    override fun reject(code: String, message: String?, cause: Throwable?) {
                        LogUtils.e(CLASS_NAME, "📱 Failed to pause recording after device disconnection: $message")
                    }
                })
            }
        }
        LogUtils.d(CLASS_NAME, "📱 handleDeviceDisconnection completed")
    }

    override fun sendExpoEvent(eventName: String, params: Bundle) {
        LogUtils.d(CLASS_NAME, "Sending event: $eventName")
        safeSendEvent(eventName, params)
    }
}

internal object AndroidEventEmitter {
    fun safeSend(className: String, eventName: String, send: () -> Unit): Boolean {
        return try {
            send()
            true
        } catch (e: Exception) {
            LogUtils.e(className, "Failed to send event $eventName: ${e.message}", e)
            false
        }
    }
}
