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
        // Same vectors as SafeFilenameTests.swift, plus the backslash: Android is Unix,
        // so "\\" is an ordinary filename character rather than a separator, and
        // rejecting it would refuse a legal name.
        for (name in listOf("recording", "my-trim.wav", "trim 1", "réc", "a.b.c", "..leading", "a\\b")) {
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
    fun `RecordingConfig rejects a traversing filename`() {
        // The guard is in fromMap rather than at the bridge, so startRecording and
        // prepareRecording are both covered. Without a test here, removing it still
        // compiles and nothing fails (#452).
        val result = RecordingConfig.fromMap(
            mapOf("filename" to "../../../../tmp/pwned")
        )
        assertTrue(result.isFailure, "a traversing filename must be rejected")
        assertTrue(
            result.exceptionOrNull()?.message?.contains("single filename") == true,
            "expected the reason, got: ${result.exceptionOrNull()?.message}"
        )
    }

    @Test
    fun `RecordingConfig accepts an ordinary filename`() {
        val result = RecordingConfig.fromMap(mapOf("filename" to "my-recording"))
        assertTrue(result.isSuccess, "an ordinary filename must be accepted")
        assertEquals("my-recording", result.getOrNull()?.first?.filename)
    }

    @Test
    fun `the config parser rejects a traversing filename`() {
        // Parser coverage only. Both prepared paths now route through fromMap, so this is
        // the check they share — but the manager's own transitions are not exercised here,
        // since faking its hardware state is what the harness gap in #449 is about.
        for (name in listOf("../escaped", "a/b", "", ".")) {
            val result = RecordingConfig.fromMap(mapOf("filename" to name))
            assertTrue(result.isFailure, "expected \"$name\" to be rejected")
        }
    }

    @Test
    fun `both prepared paths honour a config failure`() {
        // Source assertions, in the style of AudioSourceWiringTest: the manager needs real
        // AudioRecord state to exercise these transitions, so this guards the wiring rather
        // than the behaviour. Both bypasses were live until #452 — prepared startRecording
        // wrapped the parse in `if (configResult.isSuccess)` and dropped failures, and
        // prepareRecording returned true before parsing.
        val source = File("src/main/java/net/siteed/audiostudio/AudioRecorderManager.kt")
            .takeIf { it.exists() }
            ?: File("packages/audio-studio/android/src/main/java/net/siteed/audiostudio/AudioRecorderManager.kt")
        val text = source.readText()

        assertFalse(
            text.contains("if (configResult.isSuccess) {"),
            "prepared startRecording must not silently ignore a config failure"
        )
        assertTrue(
            text.contains("val recheck = RecordingConfig.fromMap(options)"),
            "prepareRecording must re-validate when already prepared"
        )
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
