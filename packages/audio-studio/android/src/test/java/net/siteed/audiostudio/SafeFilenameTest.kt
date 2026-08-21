package net.siteed.audiostudio

import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

/**
 * Covers the shared filename validator (#452).
 *
 * Mirrors `SafeFilenameTests.swift`. The traversal is verified here against `File` rather
 * than assumed to behave like Foundation, since that is the API `AudioTrimmer` uses.
 */
class SafeFilenameTest {

    @Test
    fun `ordinary filenames are accepted`() {
        for (name in listOf("recording", "my-trim.wav", "trim 1", "réc", "a.b.c")) {
            assertTrue(SafeFilename.isValid(name), name)
        }
    }

    @Test
    fun `names containing a separator are rejected`() {
        for (name in listOf("../escaped", "../../../../tmp/pwned", "a/b", "/absolute")) {
            assertFalse(SafeFilename.isValid(name), name)
        }
    }

    @Test
    fun `dot components and the empty name are rejected`() {
        for (name in listOf(".", "..", "")) {
            assertFalse(SafeFilename.isValid(name), name)
        }
    }

    @Test
    fun `names containing NUL are rejected`() {
        assertFalse(SafeFilename.isValid("bad\u0000name"))
    }

    @Test
    fun `a rejected name would otherwise escape filesDir`() {
        // The reason this validator exists, checked against the API AudioTrimmer uses
        // rather than taken on faith from the iOS behaviour.
        val filesDir = File("/data/user/0/net.siteed.app/files")
        val escaping = File(filesDir, "../../../../tmp/pwned.wav").canonicalPath
        assertFalse(
            escaping.startsWith(filesDir.path + File.separator),
            "expected $escaping to be outside ${filesDir.path}"
        )

        val ordinary = File(filesDir, "recording.wav").canonicalPath
        assertEquals("${filesDir.path}/recording.wav", ordinary)
    }
}
