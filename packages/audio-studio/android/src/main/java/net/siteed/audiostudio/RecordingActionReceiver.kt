package net.siteed.audiostudio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import expo.modules.kotlin.Promise
import java.util.concurrent.atomic.AtomicBoolean

class RecordingActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_PAUSE_RECORDING = "net.siteed.audiostudio.PAUSE_RECORDING"
        const val ACTION_RESUME_RECORDING = "net.siteed.audiostudio.RESUME_RECORDING"
        private val isProcessingAction = AtomicBoolean(false)
    }

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_PAUSE_RECORDING, ACTION_RESUME_RECORDING -> handleRecordingAction(intent.action)
            else -> Log.w("RecordingActionReceiver", "Unknown action: ${intent.action}")
        }
    }

    private fun handleRecordingAction(action: String?) {
        if (!isProcessingAction.compareAndSet(false, true)) {
            Log.d("RecordingActionReceiver", "Action already in progress, skipping")
            return
        }

        try {
            val audioRecorderManager = AudioRecorderManager.getInstance()
            if (audioRecorderManager == null) {
                Log.e("RecordingActionReceiver", "AudioRecorderManager instance is null")
                isProcessingAction.set(false)
                return
            }

            val notificationPromise = object : Promise {
                override fun resolve(value: Any?) {
                    Log.d("RecordingActionReceiver", "$action completed successfully")
                    isProcessingAction.set(false)
                }

                override fun reject(code: String?, message: String?, cause: Throwable?) {
                    Log.e("RecordingActionReceiver", "$action failed: $message", cause)
                    isProcessingAction.set(false)
                }
            }

            when (action) {
                ACTION_PAUSE_RECORDING -> audioRecorderManager.pauseRecording(notificationPromise)
                ACTION_RESUME_RECORDING -> audioRecorderManager.resumeRecording(notificationPromise)
            }
        } catch (e: Exception) {
            Log.e("RecordingActionReceiver", "Error processing $action", e)
            isProcessingAction.set(false)
        }
    }
}