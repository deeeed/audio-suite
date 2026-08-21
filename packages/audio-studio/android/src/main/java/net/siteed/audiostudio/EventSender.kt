package net.siteed.audiostudio

import android.os.Bundle

interface EventSender {
    /**
     * Best-effort event delivery to JavaScript.
     *
     * Native recording/device callbacks must not crash if Expo rejects an event
     * while the module is not ready to emit, so this never throws.
     *
     * @return true if the event was handed to the emitter, false if delivery failed.
     * Most callers ignore this. It exists because a caller that de-duplicates its own
     * events needs to know a send failed, or it latches a report that never arrived
     * and suppresses every later one (#447).
     */
    fun sendExpoEvent(eventName: String, params: Bundle): Boolean
}
