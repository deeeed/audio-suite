package net.siteed.audiostudio

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import android.app.NotificationChannel
import android.app.NotificationManager
import androidx.core.app.NotificationCompat

class AudioRecordingService : Service() {
    private val notificationManager by lazy {
        AudioNotificationManager.getInstance(applicationContext)
    }
    private val mainHandler = Handler(Looper.getMainLooper())
    private var isRunning = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(Constants.TAG, "AudioRecordingService onCreate")
        isRunning = true
        setServiceRunning(true)
        
        // Start foreground immediately in onCreate to prevent timing issues
        startForegroundWithNotification()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(Constants.TAG, "AudioRecordingService onStartCommand")
        return START_STICKY
    }

    private fun startForegroundWithNotification() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                // Create a minimal notification channel if needed
                val channel = NotificationChannel(
                    "recording_service",
                    "Recording Service",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    setSound(null, null)
                    enableLights(false)
                    enableVibration(false)
                }
                val notificationManager = getSystemService(NotificationManager::class.java)
                notificationManager.createNotificationChannel(channel)
                
                // Create minimal silent notification with minimal text
                val notification = NotificationCompat.Builder(this, "recording_service")
                    .setContentTitle(" ")  // Space character instead of empty string
                    .setContentText(" ")   // Space character instead of empty string
                    .setSmallIcon(R.drawable.ic_microphone)
                    .setOngoing(true)
                    .setSound(null)
                    .setVibrate(null)
                    .setDefaults(0)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .build()
                
                startForeground(1, notification)
                Log.d(Constants.TAG, "Started foreground service with minimal notification")
            }
        } catch (e: Exception) {
            Log.e(Constants.TAG, "Failed to start foreground service: ${e.message}", e)
            stopSelf()  // Don't leave service in broken state (#288)
        }
    }

    override fun onDestroy() {
        Log.d(Constants.TAG, "AudioRecordingService onDestroy")

        try {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } catch (e: Exception) {
            Log.e(Constants.TAG, "Error stopping foreground service: ${e.message}", e)
        }

        isRunning = false
        setServiceRunning(false)
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Log.d(Constants.TAG, "AudioRecordingService onTaskRemoved")
        
        // Stop recording when app is killed
        AudioRecorderManager.getInstance()?.let { manager ->
            mainHandler.post {
                // Create a simple promise object for internal use
                val promise = object : Promise {
                    override fun resolve(value: Any?) {
                        Log.d(Constants.TAG, "Successfully stopped recording on task removed")
                        cleanup()
                    }
                    override fun reject(code: String?, message: String?, cause: Throwable?) {
                        Log.e(Constants.TAG, "Failed to stop recording on task removed: $message")
                        cleanup()
                    }
                }

                try {
                    manager.stopRecording(promise)
                } catch (e: Exception) {
                    promise.reject("ERROR", e.message, e)
                }
            }
        }
    }

    
    private fun cleanup() {
        try {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } catch (e: Exception) {
            Log.e(Constants.TAG, "Error stopping foreground in cleanup: ${e.message}", e)
        }
        stopSelf()
    }

    companion object {
        // Static flag to track if service is running
        private var isServiceRunningStatic = false

        fun isServiceRunning(): Boolean {
            return isServiceRunningStatic
        }

        fun setServiceRunning(running: Boolean) {
            isServiceRunningStatic = running
        }

        fun startService(context: Context) {
            try {
                val serviceIntent = Intent(context, AudioRecordingService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                    Log.d(Constants.TAG, "Started foreground service")
                } else {
                    context.startService(serviceIntent)
                    Log.d(Constants.TAG, "Started regular service")
                }
                setServiceRunning(true)
            } catch (e: Exception) {
                Log.e(Constants.TAG, "Failed to start service: ${e.message}", e)
            }
        }

        fun stopService(context: Context) {
            try {
                context.stopService(Intent(context, AudioRecordingService::class.java))
                setServiceRunning(false)
                Log.d(Constants.TAG, "Stopped service")
            } catch (e: Exception) {
                Log.e(Constants.TAG, "Failed to stop service: ${e.message}", e)
            }
        }
    }
}