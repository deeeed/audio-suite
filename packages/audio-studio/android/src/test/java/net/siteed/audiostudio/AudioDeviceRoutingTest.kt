package net.siteed.audiostudio

import android.media.AudioDeviceInfo
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

class AudioDeviceRoutingTest {
    @Test
    fun `communication routing reports the platform result`() {
        assertTrue(attemptCommunicationDeviceSelection(selection = { true }))
        assertFalse(attemptCommunicationDeviceSelection(selection = { false }))
    }

    @Test
    fun `communication routing reports platform exceptions as failure`() {
        assertFalse(attemptCommunicationDeviceSelection(selection = { error("route rejected") }))
    }

    @Test
    fun `rejected communication routing preserves route state`() {
        var selected = "original"
        var scoEnabled = true
        assertFalse(attemptCommunicationDeviceSelection(
            selection = { false },
            onAccepted = {
                selected = "replacement"
                scoEnabled = false
            }
        ))
        assertEquals("original", selected)
        assertTrue(scoEnabled)

        assertFalse(attemptCommunicationDeviceSelection(
            selection = { error("route rejected") },
            onAccepted = {
                selected = "replacement"
                scoEnabled = false
            }
        ))
        assertEquals("original", selected)
        assertTrue(scoEnabled)

        assertTrue(attemptCommunicationDeviceSelection(
            selection = { true },
            onAccepted = {
                selected = "replacement"
                scoEnabled = false
            }
        ))
        assertEquals("replacement", selected)
        assertFalse(scoEnabled)
    }

    @Test
    fun `input route maps to matching communication sink`() {
        val requested = descriptor(
            id = 10,
            type = AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            address = "headset-b",
            name = "Headset B"
        )
        val sinks = listOf(
            descriptor(20, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "headset-a", "Headset A"),
            descriptor(21, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "headset-b", "Headset B")
        )

        assertEquals(21, selectCommunicationSink(requested, sinks))
    }

    @Test
    fun `ambiguous external route does not select another device`() {
        val requested = descriptor(
            id = 10,
            type = AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            address = "missing",
            name = "Missing headset"
        )
        val sinks = listOf(
            descriptor(20, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "headset-a", "Headset A"),
            descriptor(21, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "headset-b", "Headset B")
        )

        assertNull(selectCommunicationSink(requested, sinks))
    }

    @Test
    fun `addressed route does not fall back to a duplicate product name`() {
        val requested = descriptor(
            id = 10,
            type = AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            address = "missing",
            name = "Same headset"
        )
        val sinks = listOf(
            descriptor(20, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "headset-a", "Same headset"),
            descriptor(21, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "headset-b", "Same headset")
        )

        assertNull(selectCommunicationSink(requested, sinks))
    }

    @Test
    fun `built in microphone prefers communication earpiece`() {
        val requested = descriptor(10, AudioDeviceInfo.TYPE_BUILTIN_MIC, "", "Built-in Mic")
        val sinks = listOf(
            descriptor(20, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, "", "Speaker"),
            descriptor(21, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE, "", "Earpiece")
        )

        assertEquals(21, selectCommunicationSink(requested, sinks))
    }

    private fun descriptor(
        id: Int,
        type: Int,
        address: String,
        name: String
    ) = CommunicationDeviceDescriptor(id, type, address, name)
}
