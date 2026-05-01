package net.siteed.audiostudio

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidEventEmitterTest {
    @Test
    fun safeSendReturnsTrueWhenEventIsSent() {
        var sent = false

        val result = AndroidEventEmitter.safeSend("Test", "event") {
            sent = true
        }

        assertTrue(result)
        assertTrue(sent)
    }

    @Test
    fun safeSendCatchesEmitterExceptions() {
        val result = AndroidEventEmitter.safeSend("Test", "event") {
            throw IllegalArgumentException("module not ready")
        }

        assertFalse(result)
    }
}
