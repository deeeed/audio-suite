// net/siteed/audiostream/AudioRecorderManager.kt
package net.siteed.audiostudio

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.os.bundleOf
import expo.modules.kotlin.Promise
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import java.nio.ByteBuffer
import java.nio.ByteOrder
import android.media.AudioManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import android.app.ActivityManager
import java.util.UUID
import net.siteed.audiostudio.LogUtils

class AudioRecorderManager(
    private val context: Context,
    private val filesDir: File,
    private val permissionUtils: PermissionUtils,
    private val audioDataEncoder: AudioDataEncoder,
    private val eventSender: EventSender,
    private val enablePhoneStateHandling: Boolean = true,
    private val enableBackgroundAudio: Boolean = true
) {
    companion object {
        private const val CLASS_NAME = "AudioRecorderManager"
        
        @SuppressLint("StaticFieldLeak")
        @Volatile
        private var instance: AudioRecorderManager? = null

        fun getInstance(): AudioRecorderManager? = instance

        fun initialize(
            context: Context,
            filesDir: File,
            permissionUtils: PermissionUtils,
            audioDataEncoder: AudioDataEncoder,
            eventSender: EventSender,
            enablePhoneStateHandling: Boolean = true,
            enableBackgroundAudio: Boolean = true
        ): AudioRecorderManager {
            return instance ?: synchronized(this) {
                instance ?: AudioRecorderManager(
                    context, filesDir, permissionUtils, audioDataEncoder, eventSender,
                    enablePhoneStateHandling, enableBackgroundAudio
                ).also { instance = it }
            }
        }

        fun destroy() {
            instance?.cleanup()
            instance = null
        }
    }
    
    // Maximum size for analysis buffer to prevent OOM on low-RAM devices with extreme configs
    private val MAX_ANALYSIS_BUFFER_SIZE = 20 * 1024 * 1024 // 20MB
    
    private var audioRecord: AudioRecord? = null
    private var bufferSizeInBytes = 0
    private val _isRecording = AtomicBoolean(false)
    private val isPaused = AtomicBoolean(false)
    private var streamUuid: String? = null
    private var audioFile: File? = null
    private var recordingThread: Thread? = null
    private var recordingStartTime: Long = 0
    private var totalRecordedTime: Long = 0
    private var totalDataSize = 0
    private var lastEmitTime = SystemClock.elapsedRealtime()
    private var lastPauseTime = 0L
    private var pausedDuration = 0L
    private var lastEmittedSize = 0L
    private var lastEmittedCompressedSize = 0L
    private var streamPosition = 0L  // Track total bytes processed in the stream
    private var accumulatedAudioData: ByteArrayOutputStream? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val audioRecordLock = Any()
    private var audioFileHandler: AudioFileHandler = AudioFileHandler(filesDir)

    private lateinit var recordingConfig: RecordingConfig
    private var mimeType = "audio/wav"
    private var audioFormat: Int = AudioFormat.ENCODING_PCM_16BIT
    private var audioProcessor: AudioProcessor = AudioProcessor(filesDir)
    private var isFirstChunk = true

    private var wakeLock: PowerManager.WakeLock? = null
    private var wasWakeLockEnabled = false
    private val notificationManager = AudioNotificationManager.getInstance(context)

    private var compressedRecorder: MediaRecorder? = null
    private var compressedFile: File? = null

    private var audioManager: AudioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var audioFocusChangeListener: AudioManager.OnAudioFocusChangeListener? = null
    private var audioFocusRequest: Any? = null  // Type Any to handle both old and new APIs
    private var phoneStateListener: PhoneStateListener? = null
    private var telephonyCallback: Any? = null  // TelephonyCallback for API 31+, typed as Any to avoid class verification issues on older APIs
    private var telephonyManager: TelephonyManager? = null
        get() {
            if (field == null) {
                try {
                    field = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
                    if (field == null) {
                        LogUtils.w(CLASS_NAME, "TelephonyManager is null - device may not have telephony service (tablet/emulator)")
                    } else {
                        LogUtils.d(CLASS_NAME, "TelephonyManager initialization: successful")
                    }
                } catch (e: Exception) {
                    LogUtils.w(CLASS_NAME, "Failed to initialize TelephonyManager: ${e.message}")
                    field = null
                }
            }
            return field
        }

    private var lastEmissionTimeAnalysis = 0L
    private val analysisBuffer = ByteArrayOutputStream()
    private var isFirstAnalysis = true

    // Properties for device disconnection handling
    var isPrepared = false
    private var selectedDeviceId: String? = null
    private var deviceDisconnectionBehavior: String? = null
    
    // Cache file sizes to avoid file system calls during stop
    private var cachedPrimaryFileSize: Long = 44L  // Start with WAV header size
    private var cachedCompressedFileSize: Long = 0L

    // Add a method to handle device changes
    fun handleDeviceChange() {
        LogUtils.d(CLASS_NAME, "🔄 handleDeviceChange called - isRecording=${_isRecording.get()}, isPaused=${isPaused.get()}")
        if (!_isRecording.get()) {
            LogUtils.d(CLASS_NAME, "🔄 handleDeviceChange: Not recording, no action needed")
            return
        }

        if (isPaused.get()) {
            LogUtils.d(CLASS_NAME, "🔄 handleDeviceChange: Recording is paused, marking for restart with new device when resumed")
            
            // When paused after device disconnection, we need to release the existing AudioRecord
            // so that it can be properly reinitialized when resumed
            synchronized(audioRecordLock) {
                if (audioRecord != null) {
                    LogUtils.d(CLASS_NAME, "🔄 Releasing current AudioRecord while paused to allow proper reinitialization")
                    audioRecord?.release()
                    audioRecord = null
                    LogUtils.d(CLASS_NAME, "🔄 AudioRecord released successfully")
                }
            }
            
            return
        }

        LogUtils.d(CLASS_NAME, "🔄 handleDeviceChange: Restarting recording with new device")
        
        try {
            // Log current device configuration for debugging
            val deviceInfo = getAudioDeviceInfo()
            LogUtils.d(CLASS_NAME, "🔄 Current device info: ${deviceInfo["id"] ?: "unknown"} (${deviceInfo["type"] ?: "unknown"})")
            
            // Make a copy of current recording settings
            if (!::recordingConfig.isInitialized) {
                LogUtils.w(CLASS_NAME, "recordingConfig not initialized in handleDeviceChange")
                return
            }
            val currentSettings = recordingConfig
            
            // Pause the current recording
            synchronized(audioRecordLock) {
                if (audioRecord != null && audioRecord!!.state == AudioRecord.STATE_INITIALIZED) {
                    LogUtils.d(CLASS_NAME, "🔄 Stopping current AudioRecord")
                    audioRecord!!.stop()
                    LogUtils.d(CLASS_NAME, "🔄 AudioRecord stopped")
                }
                
                if (compressedRecorder != null) {
                    LogUtils.d(CLASS_NAME, "🔄 Pausing compressed recorder")
                    compressedRecorder!!.pause()
                    LogUtils.d(CLASS_NAME, "🔄 Compressed recorder paused")
                }
            }
            
            // Release the current audio record resources
            synchronized(audioRecordLock) {
                LogUtils.d(CLASS_NAME, "🔄 Releasing current AudioRecord")
                audioRecord?.release()
                audioRecord = null
                LogUtils.d(CLASS_NAME, "🔄 AudioRecord resources released")
            }
            
            // Log available devices
            logAvailableDevices()
            
            // Give a small delay for the system to fully complete device transition
            LogUtils.d(CLASS_NAME, "🔄 Waiting for device transition to complete")
            Thread.sleep(200)
            
            // Initialize a new audio record with the same settings
            LogUtils.d(CLASS_NAME, "🔄 Reinitializing AudioRecord with new device")
            if (!initializeAudioRecord(object : Promise {
                override fun resolve(value: Any?) {
                    LogUtils.d(CLASS_NAME, "🔄 Successfully reinitialized AudioRecord with new device")
                }
                override fun reject(code: String, message: String?, cause: Throwable?) {
                    LogUtils.e(CLASS_NAME, "🔄 Failed to reinitialize AudioRecord: $message")
                }
            })) {
                LogUtils.e(CLASS_NAME, "🔄 Failed to reinitialize audio record, stopping recording")
                stopRecording(object : Promise {
                    override fun resolve(value: Any?) {
                        eventSender.sendExpoEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                            "reason" to "deviceSwitchFailed",
                            "isPaused" to true
                        ))
                    }
                    override fun reject(code: String, message: String?, cause: Throwable?) {}
                })
                return
            }
            
            // Re-verify recording state
            synchronized(audioRecordLock) {
                if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                    LogUtils.e(CLASS_NAME, "🔄 AudioRecord not properly initialized after device change")
                    stopRecording(object : Promise {
                        override fun resolve(value: Any?) {
                            eventSender.sendExpoEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                                "reason" to "deviceSwitchFailed",
                                "isPaused" to true
                            ))
                        }
                        override fun reject(code: String, message: String?, cause: Throwable?) {}
                    })
                    return
                }
            }
            
            // Restart the audio record
            synchronized(audioRecordLock) {
                LogUtils.d(CLASS_NAME, "🔄 Starting recording with new device")
                audioRecord?.startRecording()
                LogUtils.d(CLASS_NAME, "🔄 AudioRecord started recording")
                
                // Resume compressed recorder if it was active
                if (compressedRecorder != null) {
                    LogUtils.d(CLASS_NAME, "🔄 Resuming compressed recorder")
                    compressedRecorder!!.resume()
                    LogUtils.d(CLASS_NAME, "🔄 Compressed recorder resumed")
                }
            }
            
            // Get new device info
            val newDeviceInfo = getAudioDeviceInfo()
            LogUtils.d(CLASS_NAME, "🔄 New device info: ${newDeviceInfo["id"] ?: "unknown"} (${newDeviceInfo["type"] ?: "unknown"})")
            
            // Notify JavaScript
            LogUtils.d(CLASS_NAME, "🔄 Sending device changed event to JavaScript")
            eventSender.sendExpoEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                "reason" to "deviceChanged",
                "isPaused" to false,
                "deviceInfo" to newDeviceInfo
            ))
            LogUtils.d(CLASS_NAME, "🔄 Device change handling completed successfully")
            
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "🔄 Error handling device change: ${e.message}", e)
            // If something went wrong, try to pause recording
            pauseRecording(object : Promise {
                override fun resolve(value: Any?) {
                    eventSender.sendExpoEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                        "reason" to "deviceSwitchFailed", 
                        "isPaused" to true,
                        "error" to e.message
                    ))
                }
                override fun reject(code: String, message: String?, cause: Throwable?) {}
            })
        }
    }
    
    // Helper to get info about current audio device
    private fun getAudioDeviceInfo(): Map<String, Any> {
        return try {
            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            
            // Check if using Bluetooth SCO
            if (audioManager.isBluetoothScoOn) {
                mapOf(
                    "id" to (selectedDeviceId ?: "unknown"),
                    "type" to "bluetooth",
                    "name" to "Bluetooth Headset",
                    "isDefault" to false
                )
            } 
            // Check if using wired headset
            else if (audioManager.isWiredHeadsetOn) {
                mapOf(
                    "id" to (selectedDeviceId ?: "unknown"),
                    "type" to "wired",
                    "name" to "Wired Headset",
                    "isDefault" to false
                )
            } 
            // Default to built-in mic
            else {
                mapOf(
                    "id" to (selectedDeviceId ?: "unknown"),
                    "type" to "builtin_mic",
                    "name" to "Built-in Microphone",
                    "isDefault" to true
                )
            }
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Error getting audio device info: ${e.message}", e)
            mapOf(
                "id" to "unknown",
                "type" to "unknown",
                "name" to "Unknown Device",
                "isDefault" to false
            )
        }
    }
    
    // Log available audio devices for debugging
    private fun logAvailableDevices() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                val devices = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                
                LogUtils.d(CLASS_NAME, "Available audio devices (${devices.size}):")
                devices.forEachIndexed { index, device ->
                    val name = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        device.productName?.toString() ?: "Unknown"
                    } else {
                        when (device.type) {
                            AudioDeviceInfo.TYPE_BUILTIN_MIC -> "Built-in Microphone"
                            AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "Bluetooth Headset"
                            AudioDeviceInfo.TYPE_WIRED_HEADSET -> "Wired Headset"
                            AudioDeviceInfo.TYPE_USB_DEVICE -> "USB Audio Device"
                            AudioDeviceInfo.TYPE_USB_HEADSET -> "USB Headset"
                            else -> "Unknown Device Type (${device.type})"
                        }
                    }
                    
                    LogUtils.d(CLASS_NAME, "Device $index: $name (ID: ${device.id})")
                }
            } else {
                val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                LogUtils.d(CLASS_NAME, "Device info on pre-M Android:")
                LogUtils.d(CLASS_NAME, "- Bluetooth SCO: ${audioManager.isBluetoothScoOn}")
                LogUtils.d(CLASS_NAME, "- Wired Headset: ${audioManager.isWiredHeadsetOn}")
                LogUtils.d(CLASS_NAME, "- Selected Device ID: $selectedDeviceId")
            }
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Error logging available devices: ${e.message}", e)
        }
    }

    // Get the device disconnection behavior
    fun getDeviceDisconnectionBehavior(): String {
        return deviceDisconnectionBehavior ?: "pause" // Default to pause if not specified
    }

    // Public property to check if recording is active
    val isRecording: Boolean
        get() = _isRecording.get()

    /**
     * Shared handler for call state changes, used by both the modern TelephonyCallback (API 31+)
     * and the legacy PhoneStateListener (API < 31).
     */
    private fun handleCallStateChanged(state: Int) {
        val stateStr = when (state) {
            TelephonyManager.CALL_STATE_RINGING -> "RINGING"
            TelephonyManager.CALL_STATE_OFFHOOK -> "OFFHOOK"
            TelephonyManager.CALL_STATE_IDLE -> "IDLE"
            else -> "UNKNOWN"
        }
        LogUtils.d(CLASS_NAME, "Phone state changed to: $stateStr")

        when (state) {
            TelephonyManager.CALL_STATE_RINGING,
            TelephonyManager.CALL_STATE_OFFHOOK -> {
                if (_isRecording.get() && !isPaused.get()) {
                    LogUtils.d(CLASS_NAME, "Pausing recording due to incoming/ongoing call")
                    mainHandler.post {
                        pauseRecording(object : Promise {
                            override fun resolve(value: Any?) {
                                LogUtils.d(CLASS_NAME, "Successfully paused recording due to call")
                                eventSender.sendExpoEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                                    "reason" to "phoneCall",
                                    "isPaused" to true
                                ))
                            }
                            override fun reject(code: String, message: String?, cause: Throwable?) {
                                LogUtils.e(CLASS_NAME, "Failed to pause recording on phone call", cause)
                            }
                        })
                    }
                }
            }
            TelephonyManager.CALL_STATE_IDLE -> {
                if (_isRecording.get() && isPaused.get()) {
                    val autoResume = if (::recordingConfig.isInitialized) recordingConfig.autoResumeAfterInterruption else false
                    LogUtils.d(CLASS_NAME, "Call ended, handling auto-resume (enabled: $autoResume)")
                    if (autoResume) {
                        mainHandler.post {
                            resumeRecording(object : Promise {
                                override fun resolve(value: Any?) {
                                    LogUtils.d(CLASS_NAME, "Successfully resumed recording after call")
                                    eventSender.sendExpoEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                                        "reason" to "phoneCallEnded",
                                        "isPaused" to false
                                    ))
                                }
                                override fun reject(code: String, message: String?, cause: Throwable?) {
                                    LogUtils.e(CLASS_NAME, "Failed to resume recording after phone call", cause)
                                }
                            })
                        }
                    } else {
                        LogUtils.d(CLASS_NAME, "Auto-resume disabled, staying paused")
                        eventSender.sendExpoEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                            "reason" to "phoneCallEnded",
                            "isPaused" to true
                        ))
                    }
                }
            }
        }
    }

    private fun initializePhoneStateListener() {
        // The legacy PhoneStateListener (API < 31) requires a Looper on the
        // thread that constructs it; calling listen() also expects the same.
        // prepareRecording now runs on Dispatchers.IO (no Looper), so we
        // marshal the whole registration to the main thread's Looper. The
        // API 31+ path uses context.mainExecutor and is thread-safe, but we
        // route everything through main for consistency.
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            try {
                LogUtils.d(CLASS_NAME, "Initializing phone state listener...")

                if (permissionUtils.checkPhoneStatePermission()) {
                    LogUtils.d(CLASS_NAME, "Phone state permission granted")

                    val localTelephonyManager = telephonyManager
                    if (localTelephonyManager != null) {
                        try {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                                val callback = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                                    override fun onCallStateChanged(state: Int) {
                                        handleCallStateChanged(state)
                                    }
                                }
                                telephonyCallback = callback
                                localTelephonyManager.registerTelephonyCallback(context.mainExecutor, callback)
                                LogUtils.d(CLASS_NAME, "Successfully registered TelephonyCallback (API 31+)")
                            } else {
                                phoneStateListener = object : PhoneStateListener() {
                                    @Deprecated("Deprecated in API 31")
                                    override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                                        handleCallStateChanged(state)
                                    }
                                }
                                localTelephonyManager.listen(phoneStateListener, PhoneStateListener.LISTEN_CALL_STATE)
                                LogUtils.d(CLASS_NAME, "Successfully registered PhoneStateListener (legacy)")
                            }
                        } catch (e: SecurityException) {
                            LogUtils.w(CLASS_NAME, "Missing permission for phone state listener: ${e.message}")
                        } catch (e: Exception) {
                            LogUtils.e(CLASS_NAME, "Failed to register phone state listener", e)
                        }
                    } else {
                        LogUtils.w(CLASS_NAME, "TelephonyManager is null, phone call interruption handling disabled (device may not have telephony service)")
                    }
                } else {
                    LogUtils.w(CLASS_NAME, "READ_PHONE_STATE permission not granted, phone call interruption handling disabled")
                }
            } catch (e: Exception) {
                LogUtils.e(CLASS_NAME, "Failed to initialize phone state listener", e)
            }
        }
    }

    /**
     * Unregisters the phone state listener/callback, using the appropriate API for the device.
     */
    private fun unregisterPhoneStateListener() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val callback = telephonyCallback
                if (callback != null) {
                    telephonyManager?.unregisterTelephonyCallback(callback as TelephonyCallback)
                    telephonyCallback = null
                    LogUtils.d(CLASS_NAME, "Unregistered TelephonyCallback (API 31+)")
                }
            } else {
                if (phoneStateListener != null) {
                    telephonyManager?.listen(phoneStateListener, PhoneStateListener.LISTEN_NONE)
                    phoneStateListener = null
                    LogUtils.d(CLASS_NAME, "Unregistered PhoneStateListener (legacy)")
                }
            }
        } catch (e: Exception) {
            LogUtils.w(CLASS_NAME, "Failed to unregister phone state listener: ${e.message}")
        }
    }


    @RequiresApi(Build.VERSION_CODES.R)
    fun startRecording(options: Map<String, Any?>, promise: Promise) {
        try {
            // Check if already recording
            if (_isRecording.get() && !isPaused.get()) {
                promise.reject("ALREADY_RECORDING", "Recording is already in progress", null)
                return
            }
            
            // If already prepared, we can skip initialization
            if (!isPrepared) {
                LogUtils.d(CLASS_NAME, "Not prepared, preparing recording first")
                
                // Initialize phone state listener only if enabled
                if (enablePhoneStateHandling) {
                    initializePhoneStateListener()
                }

                LogUtils.d(CLASS_NAME, "Starting recording with options: $options")

                // Check permissions
                if (!checkPermissions(options, promise)) return

                // Parse recording configuration FIRST
                val configResult = RecordingConfig.fromMap(options)
                if (configResult.isFailure) {
                    promise.reject(
                        "INVALID_CONFIG",
                        configResult.exceptionOrNull()?.message ?: "Invalid configuration",
                        configResult.exceptionOrNull()
                    )
                    return
                }

                val (tempRecordingConfig, audioFormatInfo) = configResult.getOrNull()!!
                
                recordingConfig = tempRecordingConfig
                
                // Request audio focus AFTER config is parsed so strategy is correct
                if (!requestAudioFocus()) {
                    promise.reject("AUDIO_FOCUS_ERROR", "Failed to obtain audio focus", null)
                    return
                }
                
                // Store device-related settings
                selectedDeviceId = recordingConfig.deviceId
                deviceDisconnectionBehavior = recordingConfig.deviceDisconnectionBehavior ?: "pause"
                
                audioFormat = audioFormatInfo.format
                mimeType = audioFormatInfo.mimeType

                if (!initializeAudioFormat(promise)) return

                if (!initializeBufferSize(promise)) return

                if (!initializeAudioRecord(promise)) return

                if (recordingConfig.output.compressed.enabled && !initializeCompressedRecorder(
                    if (recordingConfig.output.compressed.format == "aac") "aac" else "opus",
                    promise
                )) return

                if (!initializeRecordingResources(audioFormatInfo.fileExtension, promise)) return
            } else {
                LogUtils.d(CLASS_NAME, "Using prepared recording state")
                
                // Even when prepared, update device settings from the new options
                val configResult = RecordingConfig.fromMap(options)
                if (configResult.isSuccess) {
                    val (tempRecordingConfig, _) = configResult.getOrNull()!!
                    // Update device-related settings
                    selectedDeviceId = tempRecordingConfig.deviceId ?: selectedDeviceId
                    deviceDisconnectionBehavior = tempRecordingConfig.deviceDisconnectionBehavior 
                        ?: deviceDisconnectionBehavior
                        ?: "pause"
                }
                
                // Request audio focus with current config
                if (!requestAudioFocus()) {
                    promise.reject("AUDIO_FOCUS_ERROR", "Failed to obtain audio focus", null)
                    return
                }
            }

            if (!startRecordingProcess(promise)) return

            // Start compressed recording if enabled
            try {
                compressedRecorder?.start()
            } catch (e: Exception) {
                LogUtils.e(CLASS_NAME, "Failed to start compressed recording", e)
                cleanup()
                promise.reject("COMPRESSED_START_FAILED", "Failed to start compressed recording", e)
                return
            }

            // Return success result with both file URIs
            val result = bundleOf(
                "fileUri" to audioFile?.toURI().toString(),
                "channels" to recordingConfig.channels,
                "bitDepth" to AudioFormatUtils.getBitDepth(recordingConfig.encoding),
                "sampleRate" to recordingConfig.sampleRate,
                "mimeType" to mimeType,
                "compression" to if (compressedFile != null) bundleOf(
                    "mimeType" to if (recordingConfig.output.compressed.format == "aac") "audio/aac" else "audio/opus",
                    "bitrate" to recordingConfig.output.compressed.bitrate,
                    "format" to recordingConfig.output.compressed.format,
                    "size" to 0,
                    "compressedFileUri" to compressedFile?.toURI().toString()
                ) else null
            )
            promise.resolve(result)

        } catch (e: Exception) {
            releaseAudioFocus()
            unregisterPhoneStateListener()
            promise.reject("UNEXPECTED_ERROR", "Unexpected error: ${e.message}", e)
        }
    }

    private fun isAudioFormatSupported(sampleRate: Int, channels: Int, format: Int): Boolean {
        if (!permissionUtils.checkRecordingPermission(enableBackgroundAudio)) {
            throw SecurityException("Recording permission has not been granted")
        }

        val channelConfig =
            if (channels == 1) AudioFormat.CHANNEL_IN_MONO else AudioFormat.CHANNEL_IN_STEREO
        val bufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, format)

        if (bufferSize <= 0) {
            return false
        }

        val audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            channelConfig,
            format,
            bufferSize
        )

        val isSupported = audioRecord.state == AudioRecord.STATE_INITIALIZED
        if (isSupported) {
            val testBuffer = ByteArray(bufferSize)
            audioRecord.startRecording()
            val testRead = audioRecord.read(testBuffer, 0, bufferSize)
            audioRecord.stop()
            if (testRead < 0) {
                return false
            }
        }

        audioRecord.release()
        return isSupported
    }

    private fun checkPermissions(options: Map<String, Any?>, promise: Promise): Boolean {
        if (!permissionUtils.checkRecordingPermission(enableBackgroundAudio)) {
            promise.reject(
                "PERMISSION_DENIED",
                "Recording permission has not been granted",
                null
            )
            return false
        }

        // Only check phone state permission if enabled
        if (enablePhoneStateHandling && !permissionUtils.checkPhoneStatePermission()) {
            LogUtils.w(CLASS_NAME, "READ_PHONE_STATE permission not granted, phone call interruption handling will be disabled")
            // Don't reject here, just log warning as this is optional
        }

        // Only check notification permission if enabled
        if (options["showNotification"] as? Boolean == true && 
            !permissionUtils.checkNotificationPermission()) {
            promise.reject(
                "NOTIFICATION_PERMISSION_DENIED",
                "Notification permission has not been granted",
                null
            )
            return false
        }
        return true
    }


    private fun initializeAudioFormat(promise: Promise): Boolean {
        if (!isAudioFormatSupported(
                recordingConfig.sampleRate,
                recordingConfig.channels,
                audioFormat
            )
        ) {
            LogUtils.e(CLASS_NAME, "Selected audio format not supported, falling back to 16-bit PCM")
            audioFormat = AudioFormat.ENCODING_PCM_16BIT

            if (!isAudioFormatSupported(
                    recordingConfig.sampleRate,
                    recordingConfig.channels,
                    audioFormat
                )
            ) {
                promise.reject(
                    "INITIALIZATION_FAILED",
                    "Failed to initialize audio recorder with any supported format",
                    null
                )
                return false
            }
            recordingConfig = recordingConfig.copy(encoding = "pcm_16bit")
            mimeType = "audio/wav"
        }
        return true
    }

    private fun initializeBufferSize(promise: Promise): Boolean {
        try {
            val channelConfig = if (recordingConfig.channels == 1) {
                AudioFormat.CHANNEL_IN_MONO
            } else {
                AudioFormat.CHANNEL_IN_STEREO
            }

            val minBufferSize = AudioRecord.getMinBufferSize(
                recordingConfig.sampleRate,
                channelConfig,
                audioFormat
            )
            
            // Calculate buffer size based on bufferDurationSeconds if provided
            var requestedBufferSize = recordingConfig.bufferDurationSeconds?.let { bufferDuration ->
                val bytesPerSample = when (recordingConfig.encoding) {
                    "pcm_8bit" -> 1
                    "pcm_16bit" -> 2
                    "pcm_32bit" -> 4
                    else -> 2
                }
                (bufferDuration * recordingConfig.sampleRate * bytesPerSample * recordingConfig.channels).toInt()
            } ?: minBufferSize

            LogUtils.d(CLASS_NAME, "Calculated minBufferSize: $minBufferSize bytes")
            LogUtils.d(CLASS_NAME, "Requested buffer size: $requestedBufferSize bytes")

            // Cap the buffer size to prevent OOM
            val MAX_BUFFER_SIZE = 10485760 // 10MB
            if (requestedBufferSize > MAX_BUFFER_SIZE) {
                LogUtils.w(CLASS_NAME, "Requested buffer size $requestedBufferSize exceeds max limit of $MAX_BUFFER_SIZE, capping to max")
                requestedBufferSize = MAX_BUFFER_SIZE
            }

            bufferSizeInBytes = maxOf(requestedBufferSize, minBufferSize)
            LogUtils.d(CLASS_NAME, "Final bufferSizeInBytes: $bufferSizeInBytes (after capping and min check)")

            when {
                bufferSizeInBytes == AudioRecord.ERROR -> {
                    LogUtils.e(CLASS_NAME, "Error getting minimum buffer size: ERROR")
                    promise.reject(
                        "BUFFER_SIZE_ERROR",
                        "Failed to get minimum buffer size: generic error",
                        null
                    )
                    return false
                }
                bufferSizeInBytes == AudioRecord.ERROR_BAD_VALUE -> {
                    LogUtils.e(CLASS_NAME, "Error getting minimum buffer size: BAD_VALUE")
                    promise.reject(
                        "BUFFER_SIZE_ERROR",
                        "Failed to get minimum buffer size: invalid parameters",
                        null
                    )
                    return false
                }
                bufferSizeInBytes <= 0 -> {
                    LogUtils.e(CLASS_NAME, "Invalid buffer size: $bufferSizeInBytes")
                    promise.reject(
                        "BUFFER_SIZE_ERROR",
                        "Failed to get valid buffer size",
                        null
                    )
                    return false
                }
                else -> {
                    LogUtils.d(CLASS_NAME, "AudioFormat: $audioFormat, BufferSize: $bufferSizeInBytes")
                    return true
                }
            }
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to initialize buffer size", e)
            promise.reject(
                "BUFFER_SIZE_ERROR",
                "Failed to initialize buffer size: ${e.message}",
                e
            )
            return false
        }
    }


    private fun initializeAudioRecord(promise: Promise): Boolean {
        if (!permissionUtils.checkRecordingPermission(enableBackgroundAudio)) {
            promise.reject(
                "PERMISSION_DENIED",
                "Recording permission has not been granted",
                null
            )
            return false
        }

        try {
            if (audioRecord == null || !isPaused.get()) {
                LogUtils.d(CLASS_NAME, "Initializing AudioRecord with format: $audioFormat, BufferSize: $bufferSizeInBytes")

                audioRecord = AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    recordingConfig.sampleRate,
                    if (recordingConfig.channels == 1) AudioFormat.CHANNEL_IN_MONO else AudioFormat.CHANNEL_IN_STEREO,
                    audioFormat,
                    bufferSizeInBytes
                )

                if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                    promise.reject(
                        "INITIALIZATION_FAILED",
                        "Failed to initialize the audio recorder",
                        null
                    )
                    return false
                }
            }
            return true

        } catch (e: SecurityException) {
            LogUtils.e(CLASS_NAME, "Security exception while initializing AudioRecord", e)
            promise.reject(
                "PERMISSION_DENIED",
                "Recording permission denied: ${e.message}",
                e
            )
            return false
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to initialize AudioRecord", e)
            promise.reject(
                "INITIALIZATION_FAILED",
                "Failed to initialize the audio recorder: ${e.message}",
                e
            )
            return false
        }
    }

    private fun initializeRecordingResources(fileExtension: String, promise: Promise): Boolean {
        try {
            streamUuid = java.util.UUID.randomUUID().toString()
            totalDataSize = 0
            
            // Reset cached file sizes
            cachedPrimaryFileSize = 44L  // WAV header size
            cachedCompressedFileSize = 0L
            
            // Only create file if primary output is enabled
            if (recordingConfig.output.primary.enabled) {
                audioFile = createRecordingFile(recordingConfig)
                
                FileOutputStream(audioFile, true).use { fos ->
                    audioFileHandler.writeWavHeader(
                        fos,
                        recordingConfig.sampleRate,
                        recordingConfig.channels,
                        AudioFormatUtils.getBitDepth(recordingConfig.encoding)
                    )
                }
            } else {
                // Set audioFile to null when primary output is disabled
                audioFile = null
                LogUtils.d(CLASS_NAME, "Skipping primary file creation - primary output is disabled")
            }

            if (recordingConfig.showNotification && enableBackgroundAudio) {
                notificationManager.initialize(recordingConfig)
                notificationManager.startUpdates(System.currentTimeMillis())
                AudioRecordingService.startService(context)
            }

            acquireWakeLock()
            audioProcessor.resetCumulativeAmplitudeRange()
            return true

        } catch (e: IOException) {
            releaseWakeLock()
            promise.reject("FILE_CREATION_FAILED", "Failed to create the audio file", e)
            return false
        } catch (e: Exception) {
            releaseWakeLock()
            LogUtils.e(CLASS_NAME, "Unexpected error in startRecording", e)
            promise.reject("UNEXPECTED_ERROR", "Unexpected error: ${e.message}", e)
            return false
        }
    }

    private fun startRecordingProcess(promise: Promise): Boolean {
        try {
            // Add detailed logging of recording configuration
            LogUtils.d(CLASS_NAME, """
                Starting audio recording with configuration:
                - Sample Rate: ${recordingConfig.sampleRate} Hz
                - Channels: ${recordingConfig.channels}
                - Encoding: ${recordingConfig.encoding}
                - Buffer Duration: ${recordingConfig.bufferDurationSeconds?.let { "${it}s" } ?: "default"}
                - Primary Output: ${recordingConfig.output.primary.enabled}
                - Data Emission Interval: ${recordingConfig.interval}ms
                - Analysis Interval: ${recordingConfig.intervalAnalysis}ms
                - Processing Enabled: ${recordingConfig.enableProcessing}
                - Keep Awake: ${recordingConfig.keepAwake}
                - Show Notification: ${recordingConfig.showNotification}
                - Show Waveform: ${recordingConfig.showWaveformInNotification}
                - Compressed Output: ${recordingConfig.output.compressed.enabled}
                ${if (recordingConfig.output.compressed.enabled) """
                    - Compressed Format: ${recordingConfig.output.compressed.format}
                    - Compressed Bitrate: ${recordingConfig.output.compressed.bitrate}
                """.trimIndent() else ""}
                - Auto Resume: ${recordingConfig.autoResumeAfterInterruption}
                - Output Directory: ${recordingConfig.outputDirectory ?: "default"}
                - Filename: ${recordingConfig.filename ?: "auto-generated"}
                - Features: ${recordingConfig.features.entries.joinToString { "${it.key}=${it.value}" }}
            """.trimIndent())

            audioRecord?.startRecording()
            isPaused.set(false)
            _isRecording.set(true)
            isFirstChunk = true

            if (!isPaused.get()) {
                recordingStartTime = System.currentTimeMillis()
            }

            recordingThread = Thread { recordingProcess() }.apply { start() }
            
            // Start service if keepAwake is true, but only if background audio is enabled (#288)
            if (recordingConfig.keepAwake && enableBackgroundAudio) {
                AudioRecordingService.startService(context)
            }
            
            return true

        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to start recording", e)
            cleanup()
            promise.reject("START_FAILED", "Failed to start recording: ${e.message}", e)
            return false
        }
    }

    fun stopRecording(promise: Promise) {
        val stopStartTime = System.currentTimeMillis()
        
        synchronized(audioRecordLock) {
            if (!_isRecording.get()) {
                LogUtils.e(CLASS_NAME, "Recording is not active")
                promise.reject("NOT_RECORDING", "Recording is not active", null)
                return
            }

            // Declare variables at the synchronized block level to ensure they're accessible in both try blocks
            var duration: Long = 0
            var fileSize: Long = 0

            try {
                
                if (isPaused.get()) {
                    val readStartTime = System.currentTimeMillis()
                    val remainingData = ByteArray(bufferSizeInBytes)
                    val bytesRead = audioRecord?.read(remainingData, 0, bufferSizeInBytes) ?: -1
                    if (bytesRead > 0) {
                        emitAudioData(remainingData.copyOfRange(0, bytesRead), bytesRead)
                        streamPosition += bytesRead  // Update stream position for final data
                    }
                }

                if (recordingConfig.showNotification) {
                    val notificationStartTime = System.currentTimeMillis()
                    notificationManager.stopUpdates()
                    AudioRecordingService.stopService(context)
                }

                _isRecording.set(false)
                isPrepared = false  // Reset preparation state
                
                // Use a reasonable fixed timeout for all cases
                // The recording thread should exit quickly with non-blocking read
                val timeoutMs = 2000L // 2 seconds should be more than enough
                val threadJoinStartTime = System.currentTimeMillis()
                recordingThread?.join(timeoutMs)

                // This ensures complete audio data is captured even when stopped before interval threshold
                accumulatedAudioData?.let { audioData ->
                    if (audioData.size() > 0) {
                        LogUtils.d(CLASS_NAME, "Emitting final accumulated audio chunk of ${audioData.size()} bytes before stopping")
                        emitAudioData(audioData.toByteArray(), audioData.size())
                        streamPosition += audioData.size()  // Update stream position for final data
                    }
                }

                LogUtils.d(CLASS_NAME, "Stopping recording state = ${audioRecord?.state}")
                if (audioRecord != null && audioRecord!!.state == AudioRecord.STATE_INITIALIZED) {
                    val audioStopStartTime = System.currentTimeMillis()
                    LogUtils.d(CLASS_NAME, "Stopping AudioRecord")
                    audioRecord!!.stop()
                }

                // Calculate duration BEFORE cleanup (which resets recordingStartTime)
                fileSize = if (recordingConfig.output.primary.enabled) cachedPrimaryFileSize else 0L
                LogUtils.d(CLASS_NAME, "WAV File validation - Size: $fileSize bytes (cached), Path: ${audioFile?.absolutePath}")
                
                duration = if (!recordingConfig.output.primary.enabled) {
                    // For streaming-only mode, calculate duration from actual recording time
                    val actualRecordingTime = if (recordingStartTime > 0) {
                        System.currentTimeMillis() - recordingStartTime - pausedDuration
                    } else {
                        0L
                    }
                    LogUtils.d(CLASS_NAME, "Streaming-only mode: Using actual recording time: ${actualRecordingTime}ms")
                    actualRecordingTime
                } else {
                    // For file-based recording, calculate duration from file size
                    val dataFileSize = fileSize - 44  // Subtract header size
                    val byteRate =
                        recordingConfig.sampleRate * recordingConfig.channels * when (recordingConfig.encoding) {
                            "pcm_8bit" -> 1
                            "pcm_16bit" -> 2
                            "pcm_32bit" -> 4
                            else -> 2 // Default to 2 bytes per sample if the encoding is not recognized
                        }
                    val fileDuration = if (byteRate > 0) (dataFileSize * 1000 / byteRate) else 0
                    LogUtils.d(CLASS_NAME, "File-based mode: Using file size duration: ${fileDuration}ms")
                    fileDuration
                }

                val cleanupStartTime = System.currentTimeMillis()
                cleanup()
            } catch (e: IllegalStateException) {
                LogUtils.e(CLASS_NAME, "Error reading from AudioRecord", e)
            } finally {
                releaseWakeLock()
                audioRecord?.release()
            }

            try {
                AudioProcessor.resetUniqueIdCounter()
                audioProcessor.resetCumulativeAmplitudeRange()

                if (compressedRecorder != null) {
                    val compressedStopStartTime = System.currentTimeMillis()
                    try {
                        compressedRecorder?.stop()
                        
                        val compressedReleaseStartTime = System.currentTimeMillis()
                        compressedRecorder?.release()
                    } catch (e: Exception) {
                        LogUtils.e(CLASS_NAME, "Error stopping MediaRecorder: ${e.message}")
                    }
                    compressedRecorder = null
                }

                // Log compressed file status if enabled - use actual file size for validation
                if (recordingConfig.output.compressed.enabled) {
                    val fileSizeStartTime = System.currentTimeMillis()
                    // Note: For compressed files, we need to get actual size as MediaRecorder handles the writing
                    // Use actual file size here for validation purposes only
                    val compressedSizeStartTime = System.currentTimeMillis()
                    val compressedSize = compressedFile?.length() ?: 0
                    cachedCompressedFileSize = compressedSize // Update cache with final size
                    LogUtils.d(CLASS_NAME, "Compressed File validation - Size: $compressedSize bytes, Path: ${compressedFile?.absolutePath}")
                }

                // Log bit depth information for debugging
                val configBitDepth = AudioFormatUtils.getBitDepth(recordingConfig.encoding)
                LogUtils.d(CLASS_NAME, """
                    Bit Depth Debug Info:
                    - Config encoding: ${recordingConfig.encoding}
                    - Config bit depth: $configBitDepth
                    - Audio format: $audioFormat
                """.trimIndent())
                
                val result = if (!recordingConfig.output.primary.enabled) {
                    // When primary output is disabled, still include compression info if available
                    val localCompressedFile = compressedFile // Create local copy to avoid smart cast issues
                    val compressionBundle = if (recordingConfig.output.compressed.enabled && localCompressedFile != null) {
                        bundleOf(
                            "size" to cachedCompressedFileSize,  // Use cached size
                            "mimeType" to if (recordingConfig.output.compressed.format == "aac") "audio/aac" else "audio/opus",
                            "bitrate" to recordingConfig.output.compressed.bitrate,
                            "format" to recordingConfig.output.compressed.format,
                            "compressedFileUri" to localCompressedFile.toURI().toString()
                        )
                    } else null
                    
                    bundleOf(
                        "fileUri" to (compressionBundle?.getString("compressedFileUri") ?: ""),
                        "filename" to (localCompressedFile?.name ?: "stream-only"),
                        "durationMs" to duration,
                        "channels" to recordingConfig.channels,
                        "bitDepth" to AudioFormatUtils.getBitDepth(recordingConfig.encoding),
                        "sampleRate" to recordingConfig.sampleRate,
                        "size" to (compressionBundle?.getLong("size") ?: totalDataSize),
                        "mimeType" to (compressionBundle?.getString("mimeType") ?: mimeType),
                        "createdAt" to System.currentTimeMillis(),
                        "compression" to compressionBundle
                    )
                } else {
                    bundleOf(
                        "fileUri" to audioFile?.toURI().toString(),
                        "filename" to audioFile?.name,
                        "durationMs" to duration,
                        "channels" to recordingConfig.channels,
                        "bitDepth" to AudioFormatUtils.getBitDepth(recordingConfig.encoding),
                        "sampleRate" to recordingConfig.sampleRate,
                        "size" to fileSize,
                        "mimeType" to mimeType,
                        "createdAt" to System.currentTimeMillis(),
                        "compression" to if (compressedFile != null) bundleOf(
                            "size" to cachedCompressedFileSize,  // Use cached size
                            "mimeType" to if (recordingConfig.output.compressed.format == "aac") "audio/aac" else "audio/opus",
                            "bitrate" to recordingConfig.output.compressed.bitrate,
                            "format" to recordingConfig.output.compressed.format,
                            "compressedFileUri" to compressedFile?.toURI().toString()
                        ) else null
                    )
                }
                
                // Log total stop duration if it's slow
                val stopDuration = System.currentTimeMillis() - stopStartTime
                if (stopDuration > 200) {
                    LogUtils.w(CLASS_NAME, "Stop recording took ${stopDuration}ms - consider investigating")
                }
                
                promise.resolve(result)

                // Reset the timing variables
                _isRecording.set(false)
                isPaused.set(false)
                totalRecordedTime = 0
                pausedDuration = 0
            } catch (e: Exception) {
                LogUtils.e(CLASS_NAME, "Failed to stop recording: ${e.message}")
                promise.reject("STOP_FAILED", "Failed to stop recording", e)
            } finally {
                audioRecord = null
            }
        }
    }

    fun resumeRecording(promise: Promise) {
        LogUtils.d(CLASS_NAME, "⏺️ resumeRecording method entered - isPaused=${isPaused.get()}, isRecording=${_isRecording.get()}")
        if (!isPaused.get()) {
            LogUtils.e(CLASS_NAME, "⏺️ Cannot resume recording: not paused")
            promise.reject("NOT_PAUSED", "Recording is not paused", null)
            return
        }

        if (isOngoingCall()) {
            LogUtils.e(CLASS_NAME, "⏺️ Cannot resume recording: ongoing call detected")
            promise.reject("ONGOING_CALL", "Cannot resume recording during an ongoing call", null)
            return
        }

        try {
            // Check if audioRecord needs reinitializing
            var needsReinitialize = false
            synchronized(audioRecordLock) {
                LogUtils.d(CLASS_NAME, "⏺️ Checking audioRecord state: ${audioRecord?.state ?: "null"}")
                if (audioRecord == null || audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                    LogUtils.d(CLASS_NAME, "⏺️ AudioRecord is null or not properly initialized, will reinitialize")
                    needsReinitialize = true
                }
            }

            // Reinitialize audioRecord if needed (like after device disconnection)
            if (needsReinitialize) {
                LogUtils.d(CLASS_NAME, "⏺️ Starting reinitialization of AudioRecord for resumption after disconnection")
                if (!initializeAudioRecord(object : Promise {
                    override fun resolve(value: Any?) {
                        LogUtils.d(CLASS_NAME, "⏺️ Successfully reinitialized AudioRecord for resumption")
                    }
                    override fun reject(code: String, message: String?, cause: Throwable?) {
                        LogUtils.e(CLASS_NAME, "⏺️ Failed to reinitialize AudioRecord: $message")
                        // We'll let the main try-catch handle this error
                        throw IllegalStateException("Failed to reinitialize AudioRecord: $message")
                    }
                })) {
                    LogUtils.e(CLASS_NAME, "⏺️ Failed to reinitialize AudioRecord")
                    throw IllegalStateException("Failed to reinitialize AudioRecord for resumption")
                }
                LogUtils.d(CLASS_NAME, "⏺️ Reinitialization completed successfully")
            }

            if (recordingConfig.showNotification) {
                LogUtils.d(CLASS_NAME, "⏺️ Resuming notification updates")
                notificationManager.resumeUpdates()
            }

            acquireWakeLock()
            pausedDuration += System.currentTimeMillis() - lastPauseTime
            isPaused.set(false)
            
            synchronized(audioRecordLock) {
                // Double-check audioRecord is valid after potential reinitialization
                LogUtils.d(CLASS_NAME, "⏺️ Final check of audioRecord state: ${audioRecord?.state ?: "null"}")
                if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                    LogUtils.e(CLASS_NAME, "⏺️ AudioRecord is not properly initialized")
                    throw IllegalStateException("AudioRecord is not properly initialized")
                }
                
                LogUtils.d(CLASS_NAME, "⏺️ Starting AudioRecord recording")
                audioRecord?.startRecording()
                LogUtils.d(CLASS_NAME, "⏺️ AudioRecord.startRecording called")
                
                if (compressedRecorder != null) {
                    LogUtils.d(CLASS_NAME, "⏺️ Resuming compressed recorder")
                    compressedRecorder?.resume()
                    LogUtils.d(CLASS_NAME, "⏺️ Compressed recorder resumed")
                }
            }
            
            LogUtils.d(CLASS_NAME, "⏺️ Recording resumed successfully")
            promise.resolve("Recording resumed")
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "⏺️ Failed to resume recording: ${e.message}", e)
            releaseWakeLock()
            promise.reject("RESUME_FAILED", "Failed to resume recording: ${e.message}", e)
        }
    }

    fun pauseRecording(promise: Promise) {
        if (_isRecording.get() && !isPaused.get()) {
            audioRecord?.stop()
            compressedRecorder?.pause()
            
            lastPauseTime = System.currentTimeMillis()
            isPaused.set(true)

            if (recordingConfig.showNotification) {
                notificationManager.pauseUpdates()
            }

            releaseWakeLock()
            promise.resolve("Recording paused")
        } else {
            promise.reject(
                "NOT_RECORDING_OR_ALREADY_PAUSED",
                "Recording is either not active or already paused",
                null
            )
        }
    }

    fun getStatus(): Bundle {
        synchronized(audioRecordLock) {
            // Check if service is actually running
            val isServiceRunning = context.let { ctx ->
                val manager = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                manager?.getRunningServices(Integer.MAX_VALUE)
                    ?.any { it.service.className == AudioRecordingService::class.java.name }
            } ?: false

            // If service is running but we think we're not recording, clean up
            if (isServiceRunning && !_isRecording.get()) {
                LogUtils.d(CLASS_NAME, "Detected orphaned recording service, cleaning up...")
                cleanup()
                AudioRecordingService.stopService(context)
            }

            if (!_isRecording.get()) {
                LogUtils.d(CLASS_NAME, "Not recording --- skip status with default values")
                return bundleOf(
                    "isRecording" to false,
                    "isPaused" to false,
                    "mime" to mimeType,
                    "size" to 0,
                    "interval" to if (::recordingConfig.isInitialized) recordingConfig.interval else 0
                )
            }

            // Use cached file size instead of file system call
            val fileSize = if (recordingConfig.output.primary.enabled) cachedPrimaryFileSize else 0L
            val duration = if (isPaused.get()) {
                // Return frozen duration when paused using lastPauseTime
                if (lastPauseTime > 0) {
                    lastPauseTime - recordingStartTime - pausedDuration
                } else {
                    0L
                }
            } else if (!recordingConfig.output.primary.enabled) {
                // For streaming-only mode, calculate duration from actual recording time
                val actualRecordingTime = if (recordingStartTime > 0) {
                    System.currentTimeMillis() - recordingStartTime - pausedDuration
                } else {
                    0L
                }
                actualRecordingTime
            } else {
                // For file-based recording, calculate duration from file size
                when (mimeType) {
                    "audio/wav" -> {
                        val dataFileSize = fileSize - Constants.WAV_HEADER_SIZE
                        val byteRate = recordingConfig.sampleRate * recordingConfig.channels * 
                            (if (recordingConfig.encoding == "pcm_8bit") 8 else 16) / 8
                        if (byteRate > 0) dataFileSize * 1000 / byteRate else 0
                    }
                    else -> totalRecordedTime
                }
            }

            val compressionBundle = if (recordingConfig.output.compressed.enabled) {
                bundleOf(
                    "size" to cachedCompressedFileSize,  // Use cached size
                    "mimeType" to if (recordingConfig.output.compressed.format == "aac") "audio/aac" else "audio/opus",
                    "bitrate" to recordingConfig.output.compressed.bitrate,
                    "format" to recordingConfig.output.compressed.format
                )
            } else null

            return bundleOf(
                "durationMs" to duration,
                "isRecording" to _isRecording.get(),
                "isPaused" to isPaused.get(),
                "mimeType" to mimeType,
                "size" to totalDataSize,
                "interval" to recordingConfig.interval,
                "compression" to compressionBundle
            )
        }
    }

    private fun acquireWakeLock() {
        if (recordingConfig.keepAwake && wakeLock == null) {
            try {
                val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "AudioRecorderManager::RecordingWakeLock"
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
                wasWakeLockEnabled = true
                LogUtils.d(CLASS_NAME, "Wake lock acquired")
            } catch (e: Exception) {
                LogUtils.e(CLASS_NAME, "Failed to acquire wake lock", e)
            }
        }
    }


    private fun releaseWakeLock() {
        try {
            wakeLock?.let {
                if (it.isHeld) {
                    it.release()
                    LogUtils.d(CLASS_NAME, "Wake lock released")
                }
                wakeLock = null
                wasWakeLockEnabled = false
            }
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to release wake lock", e)
        }
    }

    /**
     * Checks if there is an ongoing call that would interfere with recording
     */
    private fun isOngoingCall(): Boolean {
        try {
            if (telephonyManager == null) return false
            
            // Get phone call state directly from telephonyManager instead of 
            // relying on audio manager state which could be misleading after device disconnection
            val callState = telephonyManager?.callState
            
            LogUtils.d(CLASS_NAME, "Call state check: callState=${callState}, " +
                       "audioManager.mode=${audioManager.mode}, " +
                       "audioManager.isBluetoothScoOn=${audioManager.isBluetoothScoOn}")
            
            // Trust phone state more than audio manager state
            if (callState == TelephonyManager.CALL_STATE_RINGING || 
                callState == TelephonyManager.CALL_STATE_OFFHOOK) {
                return true
            }
            
            // Only check audio manager mode as secondary indicator
            return audioManager.mode == AudioManager.MODE_IN_CALL || 
                   audioManager.mode == AudioManager.MODE_IN_COMMUNICATION
            
            // Remove audioManager.isBluetoothScoOn check as it can be erroneously true after disconnection
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Error checking call state: ${e.message}")
            return false
        }
    }

    fun listAudioFiles(promise: Promise) {
        val fileList =
            filesDir.list()?.filter { it.endsWith(".wav") }?.map { File(filesDir, it).absolutePath }
                ?: listOf()
        promise.resolve(fileList)
    }

    fun clearAudioStorage() {
        audioFileHandler.clearAudioStorage()
    }

    private fun recordingProcess() {
        try {
            LogUtils.i(CLASS_NAME, "Starting recording process...")
            
            // Only use FileOutputStream if primary output is enabled
            val fos = if (recordingConfig.output.primary.enabled && audioFile != null) {
                FileOutputStream(audioFile, true)
            } else {
                null
            }
            
            try {
                // Write audio data directly to the file (if not skipping)
                val audioData = ByteArray(bufferSizeInBytes)
                LogUtils.d(CLASS_NAME, "Entering recording loop")
                
                // Buffer to accumulate data
                accumulatedAudioData = ByteArrayOutputStream()
                val accumulatedAnalysisData = ByteArrayOutputStream()  // Separate buffer for analysis
                audioFileHandler.writeWavHeader(
                    accumulatedAudioData!!,
                    recordingConfig.sampleRate,
                    recordingConfig.channels,
                    when (recordingConfig.encoding) {
                        "pcm_8bit" -> 8
                        "pcm_16bit" -> 16
                        "pcm_32bit" -> 32
                        else -> 16 // Default to 16 if the encoding is not recognized
                    }
                )
                
                // Initialize timing variables
                var lastEmitTime = System.currentTimeMillis()
                lastEmissionTimeAnalysis = System.currentTimeMillis()  // Use the class-level variable
                isFirstAnalysis = true  // Use the class-level variable
                var shouldProcessAnalysis = false
                
                // Debug log for intervals
                LogUtils.d(CLASS_NAME, """
                    Recording process started with intervals:
                    - Data emission interval: ${recordingConfig.interval}ms
                    - Analysis interval: ${recordingConfig.intervalAnalysis}ms
                    - Buffer size: $bufferSizeInBytes bytes
                """.trimIndent())

                // Recording loop
                var loopCount = 0
                while (_isRecording.get() && !Thread.currentThread().isInterrupted) {
                    loopCount++
                    if (loopCount % 100 == 0) {
                        LogUtils.d(CLASS_NAME, "Recording loop iteration $loopCount, isRecording: ${_isRecording.get()}, accumulatedAudioSize: ${accumulatedAudioData?.size() ?: 0}, accumulatedAnalysisSize: ${accumulatedAnalysisData.size()}")
                    }
                    if (isPaused.get()) {
                        Thread.sleep(100) // Add small delay when paused
                        continue
                    }

                    val currentTime = System.currentTimeMillis()
                    val timeSinceLastAnalysis = currentTime - lastEmissionTimeAnalysis
                    shouldProcessAnalysis = recordingConfig.enableProcessing && 
                        (isFirstAnalysis || timeSinceLastAnalysis >= recordingConfig.intervalAnalysis)

                    val bytesRead = synchronized(audioRecordLock) {
                        audioRecord?.let {
                            if (it.state != AudioRecord.STATE_INITIALIZED) {
                                LogUtils.e(CLASS_NAME, "AudioRecord not initialized")
                                return@let -1
                            }
                            // Use non-blocking read mode to allow quick thread exit
                            it.read(audioData, 0, bufferSizeInBytes, AudioRecord.READ_NON_BLOCKING).also { bytes ->
                                if (bytes < 0) {
                                    LogUtils.e(CLASS_NAME, "AudioRecord read error: $bytes")
                                }
                            }
                        } ?: -1 // Handle null case
                    }

                    if (bytesRead > 0) {
                        // Only write to file if primary output is enabled
                        if (fos != null) {
                            fos.write(audioData, 0, bytesRead)
                            cachedPrimaryFileSize += bytesRead  // Update cached file size
                        }
                        totalDataSize += bytesRead
                        
                        accumulatedAudioData?.write(audioData, 0, bytesRead)
                        
                        // Always accumulate data for analysis if enabled (moved outside shouldProcessAnalysis check)
                        if (recordingConfig.enableProcessing) {
                            // Check buffer size to prevent OOM on low-RAM devices with extreme configs
                            if (accumulatedAnalysisData.size() + bytesRead <= MAX_ANALYSIS_BUFFER_SIZE) {
                                accumulatedAnalysisData.write(audioData, 0, bytesRead)
                            } else {
                                LogUtils.w(CLASS_NAME, "Analysis buffer size limit reached (${accumulatedAnalysisData.size()} bytes). Skipping data to prevent OOM.")
                            }
                        }

                        // Handle regular audio data emission
                        if (currentTime - lastEmitTime >= recordingConfig.interval) {
                            accumulatedAudioData?.let { audioData ->
                                emitAudioData(
                                    audioData.toByteArray(),
                                    audioData.size()
                                )
                                streamPosition += audioData.size()  // Update stream position
                                lastEmitTime = currentTime
                                audioData.reset() // Clear the accumulator
                            }
                        }
                        
                        // Handle analysis emission separately
                        if (shouldProcessAnalysis) {
                            val analysisDataSize = accumulatedAnalysisData.size()
                            LogUtils.d(CLASS_NAME, """
                                Processing analysis data:
                                - Time since last: ${currentTime - lastEmissionTimeAnalysis}ms
                                - Configured interval: ${recordingConfig.intervalAnalysis}ms
                                - Accumulated size: $analysisDataSize bytes
                                - Is first analysis: $isFirstAnalysis
                            """.trimIndent())
                            
                            if (analysisDataSize > 0) {
                                // Add this check to enforce minimum interval
                                if (isFirstAnalysis || (currentTime - lastEmissionTimeAnalysis) >= recordingConfig.intervalAnalysis) {
                                    try {
                                        // Process and emit analysis data
                                        val analysisData = audioProcessor.processAudioData(
                                            accumulatedAnalysisData.toByteArray(),
                                            recordingConfig
                                        )
                                        
                                        LogUtils.d(CLASS_NAME, """
                                            Analysis data details:
                                            - Raw data size: ${accumulatedAnalysisData.size()} bytes
                                        """.trimIndent())
                                        
                                        mainHandler.post {
                                            try {
                                                eventSender.sendExpoEvent(
                                                    Constants.AUDIO_ANALYSIS_EVENT_NAME,
                                                    analysisData.toBundle()
                                                )
                                            } catch (e: Exception) {
                                                LogUtils.e(CLASS_NAME, "Failed to send audio analysis event", e)
                                            }
                                        }
                                        
                                        lastEmissionTimeAnalysis = currentTime
                                        isFirstAnalysis = false
                                    } catch (e: Exception) {
                                        LogUtils.e(CLASS_NAME, "Failed to process audio analysis data", e)
                                    } finally {
                                        // Always reset the buffer to prevent unbounded growth
                                        accumulatedAnalysisData.reset()
                                    }
                                }
                            }
                        }
                    } else if (bytesRead == 0) {
                        // No data available yet, sleep briefly to avoid busy-waiting
                        Thread.sleep(10)
                    }
                }
            } finally {
                // Flush and close the file output stream if it was opened
                try {
                    fos?.flush()
                    LogUtils.d(CLASS_NAME, "FileOutputStream flushed successfully")
                } catch (e: Exception) {
                    LogUtils.e(CLASS_NAME, "Error flushing FileOutputStream", e)
                }
                fos?.close()
            }
            
            // WAV header update is already handled in cleanup(), no need to duplicate here

        } catch (e: Exception) {
            // Ensure wake lock is released if the thread is interrupted
            if (!isPaused.get()) {
                releaseWakeLock()
            }
            LogUtils.e(CLASS_NAME, "Error in recording process", e)
        }
    }

    private fun emitAudioData(audioData: ByteArray, length: Int) {
        val isFloat32Stream = recordingConfig.streamFormat == "float32"

        // Use cached file size instead of file system call
        val fileSize = if (recordingConfig.output.primary.enabled) cachedPrimaryFileSize else 0L
        val from = lastEmittedSize
        lastEmittedSize = fileSize

        // Calculate position in milliseconds using stream position
        val bytesPerSample = when (recordingConfig.encoding) {
            "pcm_8bit" -> 1
            "pcm_16bit" -> 2
            "pcm_32bit" -> 4
            else -> 2
        }
        val byteRate = recordingConfig.sampleRate * recordingConfig.channels * bytesPerSample
        val positionInMs = (streamPosition * 1000) / byteRate

        val compressionBundle = if (recordingConfig.output.compressed.enabled) {
            // For compressed files, we need to get actual size as MediaRecorder handles the writing
            // Only update cache periodically to avoid frequent file system calls
            val currentTime = System.currentTimeMillis()
            if (cachedCompressedFileSize == 0L || (currentTime - lastEmittedCompressedSize) > 5000) {
                cachedCompressedFileSize = compressedFile?.length() ?: 0
            }
            
            val compressedSize = cachedCompressedFileSize
            val eventDataSize = compressedSize - lastEmittedCompressedSize
            
            // Read the new compressed data
            val compressedData = if (eventDataSize > 0) {
                try {
                    compressedFile?.inputStream()?.use { input ->
                        input.skip(lastEmittedCompressedSize)
                        val buffer = ByteArray(eventDataSize.toInt())
                        input.read(buffer)
                        audioDataEncoder.encodeToBase64(buffer)
                    }
                } catch (e: Exception) {
                    LogUtils.e(CLASS_NAME, "Failed to read compressed data", e)
                    null
                }
            } else null

            lastEmittedCompressedSize = compressedSize
            
            bundleOf(
                "position" to positionInMs,
                "fileUri" to compressedFile?.toURI().toString(),
                "eventDataSize" to eventDataSize,
                "totalSize" to compressedSize,
                "data" to compressedData
            )
        } else null
        
        val baseBundle = if (isFloat32Stream) {
            val sampleCount = length / 2
            val float32 = FloatArray(sampleCount)
            for (i in 0 until sampleCount) {
                val lo = audioData[i * 2].toInt() and 0xFF
                val hi = audioData[i * 2 + 1].toInt() and 0xFF
                float32[i] = ((hi shl 8) or lo).toShort() / 32768f
            }
            bundleOf(
                "fileUri" to audioFile?.toURI().toString(),
                "lastEmittedSize" to from,
                "pcmFloat32" to float32,
                "deltaSize" to length,
                "position" to positionInMs,
                "mimeType" to mimeType,
                "totalSize" to fileSize,
                "streamUuid" to streamUuid,
                "compression" to compressionBundle
            )
        } else {
            val encodedBuffer = audioDataEncoder.encodeToBase64(audioData)
            bundleOf(
                "fileUri" to audioFile?.toURI().toString(),
                "lastEmittedSize" to from,
                "encoded" to encodedBuffer,
                "deltaSize" to length,
                "position" to positionInMs,
                "mimeType" to mimeType,
                "totalSize" to fileSize,
                "streamUuid" to streamUuid,
                "compression" to compressionBundle
            )
        }

        mainHandler.post {
            try {
                eventSender.sendExpoEvent(Constants.AUDIO_EVENT_NAME, baseBundle)
            } catch (e: Exception) {
                LogUtils.e(CLASS_NAME, "Failed to send event", e)
            }
        }

        // Analysis is already handled in recordingProcess method to avoid duplicate processing
        // and prevent memory issues from accumulating data in multiple buffers
        
        // Update notification waveform if needed (moved from processAudioData)
        if (recordingConfig.showNotification && recordingConfig.showWaveformInNotification) {
            val floatArray = convertByteArrayToFloatArray(audioData)
            notificationManager.updateNotification(floatArray)
        }
    }

    private fun convertByteArrayToFloatArray(audioData: ByteArray): FloatArray {
        val floatArray = FloatArray(audioData.size / 2) // Assuming 16-bit PCM
        val buffer = ByteBuffer.wrap(audioData).order(ByteOrder.LITTLE_ENDIAN)
        for (i in floatArray.indices) {
            floatArray[i] = buffer.short.toFloat()
        }
        return floatArray
    }

    fun cleanup() {
        synchronized(audioRecordLock) {
            try {
                if (_isRecording.get()) {
                    audioRecord?.stop()
                    compressedRecorder?.stop()
                    compressedRecorder?.release()
                }
                
                _isRecording.set(false)
                isPaused.set(false)
                isPrepared = false  // Reset prepared state
                
                if (::recordingConfig.isInitialized && recordingConfig.showNotification) {
                    notificationManager.stopUpdates()
                    AudioRecordingService.stopService(context)
                }

                releaseWakeLock()
                releaseAudioFocus()
                unregisterPhoneStateListener()
                audioRecord?.release()
                audioRecord = null
                
                // Reset all state
                totalRecordedTime = 0
                pausedDuration = 0
                lastEmittedSize = 0
                streamPosition = 0
                recordingStartTime = 0
                
                // Clean up accumulated audio data
                accumulatedAudioData?.close()
                accumulatedAudioData = null
                
                // Update the WAV header if needed
                audioFile?.let { file ->
                    // Skip WAV header update if we're only doing compressed output
                    if (::recordingConfig.isInitialized && 
                        !recordingConfig.output.primary.enabled && 
                        recordingConfig.output.compressed.enabled) {
                        // Skip WAV header update for compressed-only recording
                    } else {
                        audioFileHandler.updateWavHeader(file)
                    }
                }

                // Send event to notify that recording was stopped
                eventSender.sendExpoEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                    "reason" to "recordingStopped",
                    "isPaused" to false
                ))
            } catch (e: Exception) {
                LogUtils.e(CLASS_NAME, "Error during cleanup", e)
            }
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun initializeCompressedRecorder(fileExtension: String, promise: Promise): Boolean {
        // Skip compressed recording if compressed output is not enabled
        if (!recordingConfig.output.compressed.enabled) {
            LogUtils.d(CLASS_NAME, "Skipping compressed recorder initialization - compressed output is disabled")
            return true
        }
        
        try {
            // Pass true to indicate this is a compressed file
            compressedFile = createRecordingFile(recordingConfig, isCompressed = true)
            
            compressedRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }

            compressedRecorder?.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                
                // Choose output format based on codec and preferRawStream flag
                val outputFormat = when (recordingConfig.output.compressed.format) {
                    "aac" -> {
                        if (recordingConfig.output.compressed.preferRawStream) {
                            MediaRecorder.OutputFormat.AAC_ADTS  // Raw AAC stream
                        } else {
                            MediaRecorder.OutputFormat.MPEG_4    // M4A container (new default)
                        }
                    }
                    else -> MediaRecorder.OutputFormat.OGG       // Opus uses OGG container
                }
                setOutputFormat(outputFormat)
                
                setAudioEncoder(if (recordingConfig.output.compressed.format == "aac") 
                    MediaRecorder.AudioEncoder.AAC 
                    else MediaRecorder.AudioEncoder.OPUS)
                setAudioChannels(recordingConfig.channels)
                setAudioSamplingRate(recordingConfig.sampleRate)
                setAudioEncodingBitRate(recordingConfig.output.compressed.bitrate)
                setOutputFile(compressedFile?.absolutePath)
                prepare()
            }
            return true
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to initialize compressed recorder", e)
            promise.reject("COMPRESSED_INIT_FAILED", "Failed to initialize compressed recorder", e)
            return false
        }
    }

    @SuppressLint("NewApi")
    private fun requestAudioFocus(): Boolean {
        val strategy = getAudioFocusStrategy()
        
        when (strategy) {
            "none" -> {
                LogUtils.d(CLASS_NAME, "Skipping audio focus request (strategy: none)")
                return true
            }
            
            "background" -> {
                LogUtils.d(CLASS_NAME, "Background recording - minimal audio focus")
                // For true background recording, we don't request audio focus
                // This allows recording to continue uninterrupted when users switch apps
                return true
            }
            
            "communication" -> {
                return requestCommunicationAudioFocus()
            }
            
            "interactive" -> {
                return requestInteractiveAudioFocus()
            }
            
            else -> {
                LogUtils.w(CLASS_NAME, "Unknown audio focus strategy: $strategy, using interactive")
                return requestInteractiveAudioFocus()
            }
        }
    }

    private fun getAudioFocusStrategy(): String {
        // Use explicit strategy if provided
        if (::recordingConfig.isInitialized) {
            recordingConfig.audioFocusStrategy?.let { 
                LogUtils.d(CLASS_NAME, "Using explicit audio focus strategy: $it")
                return it 
            }
            
            // Smart defaults based on other config
            val defaultStrategy = if (recordingConfig.keepAwake && enableBackgroundAudio) {
                "background"
            } else {
                "interactive"
            }
            LogUtils.d(CLASS_NAME, "Using default audio focus strategy: $defaultStrategy (keepAwake=${recordingConfig.keepAwake}, enableBackgroundAudio=$enableBackgroundAudio)")
            return defaultStrategy
        }
        
        // Default strategy if recordingConfig is not initialized
        LogUtils.d(CLASS_NAME, "Using fallback audio focus strategy: interactive")
        return "interactive"
    }

    @SuppressLint("NewApi")
    private fun requestInteractiveAudioFocus(): Boolean {
        audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
            when (focusChange) {
                AudioManager.AUDIOFOCUS_LOSS,
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                    if (_isRecording.get() && !isPaused.get()) {
                        mainHandler.post {
                            pauseRecording(object : Promise {
                                override fun resolve(value: Any?) {
                                    isPaused.set(true)
                                    eventSender.sendExpoEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                                        "reason" to "audioFocusLoss",
                                        "isPaused" to true
                                    ))
                                }
                                override fun reject(code: String, message: String?, cause: Throwable?) {
                                    LogUtils.e(CLASS_NAME, "Failed to pause recording on audio focus loss")
                                }
                            })
                        }
                    }
                }
                AudioManager.AUDIOFOCUS_GAIN -> {
                    val autoResume = if (::recordingConfig.isInitialized) recordingConfig.autoResumeAfterInterruption else false
                    if (_isRecording.get() && isPaused.get() && autoResume) {
                        mainHandler.post {
                            resumeRecording(object : Promise {
                                override fun resolve(value: Any?) {
                                    eventSender.sendExpoEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                                        "reason" to "audioFocusGain",
                                        "isPaused" to false
                                    ))
                                }
                                override fun reject(code: String, message: String?, cause: Throwable?) {
                                    LogUtils.e(CLASS_NAME, "Failed to resume recording on audio focus gain")
                                }
                            })
                        }
                    }
                }
            }
        }

        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build())
                .setOnAudioFocusChangeListener(audioFocusChangeListener!!)
                .build()
            audioFocusRequest = focusRequest
            audioManager.requestAudioFocus(focusRequest)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                audioFocusChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
            )
        }
        
        return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    @SuppressLint("NewApi")
    private fun requestCommunicationAudioFocus(): Boolean {
        audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
            when (focusChange) {
                AudioManager.AUDIOFOCUS_LOSS -> {
                    // Only pause for permanent focus loss (like phone calls)
                    if (_isRecording.get() && !isPaused.get()) {
                        mainHandler.post {
                            pauseRecording(object : Promise {
                                override fun resolve(value: Any?) {
                                    isPaused.set(true)
                                    eventSender.sendExpoEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                                        "reason" to "audioFocusLoss",
                                        "isPaused" to true
                                    ))
                                }
                                override fun reject(code: String, message: String?, cause: Throwable?) {
                                    LogUtils.e(CLASS_NAME, "Failed to pause recording on audio focus loss")
                                }
                            })
                        }
                    }
                }
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                    // Don't pause for temporary loss in communication mode
                    LogUtils.d(CLASS_NAME, "Ignoring transient audio focus loss in communication mode")
                }
                AudioManager.AUDIOFOCUS_GAIN -> {
                    val autoResume = if (::recordingConfig.isInitialized) recordingConfig.autoResumeAfterInterruption else false
                    if (_isRecording.get() && isPaused.get() && autoResume) {
                        mainHandler.post {
                            resumeRecording(object : Promise {
                                override fun resolve(value: Any?) {
                                    eventSender.sendExpoEvent(Constants.RECORDING_INTERRUPTED_EVENT_NAME, bundleOf(
                                        "reason" to "audioFocusGain",
                                        "isPaused" to false
                                    ))
                                }
                                override fun reject(code: String, message: String?, cause: Throwable?) {
                                    LogUtils.e(CLASS_NAME, "Failed to resume recording on audio focus gain")
                                }
                            })
                        }
                    }
                }
            }
        }

        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build())
                .setAcceptsDelayedFocusGain(false)
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener(audioFocusChangeListener!!)
                .build()
            audioFocusRequest = focusRequest
            audioManager.requestAudioFocus(focusRequest)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                audioFocusChangeListener,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN
            )
        }
        
        return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun releaseAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            (audioFocusRequest as? AudioFocusRequest)?.let { request ->
                audioManager.abandonAudioFocusRequest(request)
            }
        } else {
            @Suppress("DEPRECATION")
            audioFocusChangeListener?.let { listener ->
                audioManager.abandonAudioFocus(listener)
            }
        }
        audioFocusRequest = null
        audioFocusChangeListener = null
    }

    private fun createRecordingFile(config: RecordingConfig, isCompressed: Boolean = false): File {
        // Use custom directory or default to existing behavior
        val baseDir = config.outputDirectory?.let { File(it) } ?: filesDir
        
        // Get base filename and remove any existing extension
        val baseFilename = config.filename?.let {
            it.substringBeforeLast('.', it)  // Remove extension if present
        } ?: UUID.randomUUID().toString()
        
        // Choose extension based on whether this is a compressed file
        val extension = if (isCompressed) {
            when (config.output.compressed.format.lowercase()) {
                "aac" -> {
                    if (config.output.compressed.preferRawStream) {
                        "aac"  // Raw AAC stream
                    } else {
                        "m4a"  // M4A container (new default)
                    }
                }
                "opus" -> "opus"  // Opus in OGG container
                else -> config.output.compressed.format.lowercase()
            }
        } else {
            "wav"
        }
        
        return File(baseDir, "$baseFilename.$extension")
    }

    fun getKeepAwakeStatus(): Boolean {
        return recordingConfig?.keepAwake ?: true
    }

    /**
     * Prepares audio recording with all initial setup but without starting.
     * This reuses the existing validation and setup functions for compatibility.
     */
    fun prepareRecording(options: Map<String, Any?>): Boolean {
        if (_isRecording.get()) {
            LogUtils.d(CLASS_NAME, "Cannot prepare recording - already recording")
            return false
        }
        
        if (isPrepared) {
            LogUtils.d(CLASS_NAME, "Already prepared")
            return true
        }
        
        try {
            // Initialize phone state listener only if enabled
            if (enablePhoneStateHandling) {
                initializePhoneStateListener()
            }

            // Check permissions - create a dummy promise to avoid rejections
            val dummyPromise = object : Promise {
                override fun resolve(value: Any?) {}
                override fun reject(code: String, message: String?, cause: Throwable?) { 
                    LogUtils.e(CLASS_NAME, "Preparation error: $code - $message", cause)
                }
            }
            
            if (!checkPermissions(options, dummyPromise)) return false

            // Parse recording configuration - reuse existing code
            val configResult = RecordingConfig.fromMap(options)
            if (configResult.isFailure) {
                LogUtils.e(CLASS_NAME, "Invalid configuration: ${configResult.exceptionOrNull()?.message}")
                return false
            }

            val (tempRecordingConfig, audioFormatInfo) = configResult.getOrNull()!!
            recordingConfig = tempRecordingConfig
            
            // Store device-related settings
            selectedDeviceId = recordingConfig.deviceId
            deviceDisconnectionBehavior = recordingConfig.deviceDisconnectionBehavior ?: "pause"
            
            audioFormat = audioFormatInfo.format
            mimeType = audioFormatInfo.mimeType

            // Use all the existing validation functions with our dummy promise
            if (!initializeAudioFormat(dummyPromise)) return false
            if (!initializeBufferSize(dummyPromise)) return false
            if (!initializeAudioRecord(dummyPromise)) return false
            
            if (recordingConfig.output.compressed.enabled && !initializeCompressedRecorder(
                if (recordingConfig.output.compressed.format == "aac") "aac" else "opus",
                dummyPromise
            )) return false

            if (!initializeRecordingResources(audioFormatInfo.fileExtension, dummyPromise)) return false
            
            // Everything is ready, mark as prepared
            isPrepared = true
            LogUtils.d(CLASS_NAME, "Recording prepared successfully")
            return true
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Error during preparation: ${e.message}", e)
            cleanup()
            isPrepared = false
            return false
        }
    }
}