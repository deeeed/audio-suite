package net.siteed.audiostudio

import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

class AudioDeviceRoutingTest {
    @Test
    fun `communication routing reports the platform result`() {
        assertTrue(attemptCommunicationDeviceSelection { true })
        assertFalse(attemptCommunicationDeviceSelection { false })
    }

    @Test
    fun `communication routing reports platform exceptions as failure`() {
        assertFalse(attemptCommunicationDeviceSelection { error("route rejected") })
    }
}
