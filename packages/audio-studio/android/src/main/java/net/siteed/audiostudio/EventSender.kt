package net.siteed.audiostudio

import android.os.Bundle

interface EventSender {
    /**
     * Best-effort event delivery to JavaScript.
     *
     * Native recording/device callbacks must not crash if Expo rejects an event
     * while the module is not ready to emit.
     */
    fun sendExpoEvent(eventName: String, params: Bundle)
}
