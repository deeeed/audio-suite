package net.siteed.audiostudio

import android.media.AudioManager
import android.telephony.TelephonyManager
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidCallStateTest {
    @Test
    fun idleCallStateWinsOverStaleInCallAudioMode() {
        val result = AndroidCallState.isOngoingCall(
            TelephonyManager.CALL_STATE_IDLE,
            AudioManager.MODE_IN_CALL
        )

        assertFalse(result)
    }

    @Test
    fun ringingAndOffhookAreOngoingCalls() {
        assertTrue(AndroidCallState.isOngoingCall(
            TelephonyManager.CALL_STATE_RINGING,
            AudioManager.MODE_NORMAL
        ))
        assertTrue(AndroidCallState.isOngoingCall(
            TelephonyManager.CALL_STATE_OFFHOOK,
            AudioManager.MODE_NORMAL
        ))
    }

    @Test
    fun unknownCallStateFallsBackToAudioMode() {
        assertTrue(AndroidCallState.isOngoingCall(null, AudioManager.MODE_IN_COMMUNICATION))
        assertFalse(AndroidCallState.isOngoingCall(null, AudioManager.MODE_NORMAL))
    }
}
