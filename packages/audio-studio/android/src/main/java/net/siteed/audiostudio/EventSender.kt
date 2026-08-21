package net.siteed.audiostudio

import android.os.Bundle

interface EventSender {
    /**
     * Best-effort event delivery to JavaScript.
     *
     * Native recording/device callbacks must not crash if Expo rejects an event
     * while the module is not ready to emit, so this never throws.
     */
    fun sendExpoEvent(eventName: String, params: Bundle)

    /**
     * Deliver an event and report whether it reached the emitter.
     *
     * Defaults to [sendExpoEvent] and an optimistic `true`, so existing implementors
     * keep working — changing [sendExpoEvent]'s own signature from `(...Bundle)V` to
     * `(...Bundle)Z` would be a JVM ABI break for any precompiled implementor of this
     * published interface (#447).
     *
     * Exists because a caller that de-duplicates its own events needs to know a send
     * failed, or it latches a report that never arrived and suppresses every later one.
     */
    fun sendExpoEventChecked(eventName: String, params: Bundle): Boolean {
        sendExpoEvent(eventName, params)
        return true
    }
}
