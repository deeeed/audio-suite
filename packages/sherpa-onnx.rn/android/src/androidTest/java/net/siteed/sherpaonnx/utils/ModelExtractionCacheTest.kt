package net.siteed.sherpaonnx.utils

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class ModelExtractionCacheTest {

    @Test
    fun timedOutAttemptCannotReplaceLaterCache() {
        val fixture = createFixture()
        try {
            val latePromise = AtomicReference<Promise>()
            val lateTarget = AtomicReference<String>()
            val timedOut = extractModelArchive(
                sourcePath = "first.tar.bz2",
                cache = fixture.cache,
                timeoutSeconds = 0,
            ) { _, targetDir, promise ->
                lateTarget.set(targetDir)
                latePromise.set(promise)
            }

            assertFalse(timedOut.completed)
            assertFalse(fixture.cache.isComplete())

            val current = extractModelArchive(
                sourcePath = "second.tar.bz2",
                cache = fixture.cache,
                timeoutSeconds = 1,
            ) { _, targetDir, promise ->
                writeRequiredModel(File(targetDir), "current")
                promise.resolve(successResult())
            }

            assertTrue(current.success)
            assertTrue(fixture.cache.isComplete())
            assertEquals("current", fixture.requiredModel.readText())

            writeRequiredModel(File(lateTarget.get()), "late")
            latePromise.get().resolve(successResult())

            assertTrue(fixture.cache.isComplete())
            assertEquals("current", fixture.requiredModel.readText())
            assertFalse(File(lateTarget.get()).exists())
        } finally {
            fixture.delete()
        }
    }

    @Test
    fun successfulCallbackRequiresEveryConcreteAsset() {
        val fixture = createFixture(requireVoiceAsset = true)
        try {
            val result = extractModelArchive(
                sourcePath = "partial.tar.bz2",
                cache = fixture.cache,
                timeoutSeconds = 1,
            ) { _, targetDir, promise ->
                writeRequiredModel(File(targetDir), "partial")
                promise.resolve(successResult())
            }

            assertTrue(result.completed)
            assertFalse(result.success)
            assertTrue(result.error.orEmpty().contains("without all required model assets"))
            assertFalse(fixture.cache.isComplete())
        } finally {
            fixture.delete()
        }
    }

    @Test
    fun extractionFailureKeepsResolvedMessage() {
        val fixture = createFixture()
        try {
            val result = extractModelArchive(
                sourcePath = "failed.tar.bz2",
                cache = fixture.cache,
                timeoutSeconds = 1,
            ) { _, _, promise ->
                promise.resolve(Arguments.createMap().apply {
                    putBoolean("success", false)
                    putString("message", "archive reported a corrupt entry")
                })
            }

            assertTrue(result.completed)
            assertFalse(result.success)
            assertEquals("archive reported a corrupt entry", result.error)
        } finally {
            fixture.delete()
        }
    }

    @Test
    fun extractionRejectionKeepsCodeAndCause() {
        val fixture = createFixture()
        try {
            val rejectionCause = IOException("disk write failed")
            val result = extractModelArchive(
                sourcePath = "rejected.tar.bz2",
                cache = fixture.cache,
                timeoutSeconds = 1,
            ) { _, _, promise ->
                promise.reject("ERR_TEST_EXTRACTION", "archive rejected", rejectionCause)
            }

            assertTrue(result.completed)
            assertFalse(result.success)
            assertEquals("ERR_TEST_EXTRACTION", result.errorCode)
            assertSame(rejectionCause, result.cause)
            assertEquals("ERR_TEST_EXTRACTION: archive rejected: disk write failed", result.error)
        } finally {
            fixture.delete()
        }
    }

    private fun createFixture(requireVoiceAsset: Boolean = false): Fixture {
        val rootDir = File(
            InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,
            "model-extraction-cache-tests/${UUID.randomUUID()}"
        )
        val targetDir = File(rootDir, "shared")
        val requiredModel = File(targetDir, "model/model.onnx")
        val requiredFiles = buildList {
            add(requiredModel)
            if (requireVoiceAsset) add(File(targetDir, "model/espeak-ng-data/phontab"))
        }
        return Fixture(
            rootDir = rootDir,
            requiredModel = requiredModel,
            cache = ModelExtractionCache(targetDir, requiredFiles),
        )
    }

    private fun writeRequiredModel(attemptDir: File, content: String) {
        File(attemptDir, "model/model.onnx").also { modelFile ->
            assertTrue(modelFile.parentFile?.mkdirs() == true || modelFile.parentFile?.isDirectory == true)
            modelFile.writeText(content)
        }
    }

    private fun successResult() = Arguments.createMap().apply {
        putBoolean("success", true)
        putString("message", "extracted")
    }

    private data class Fixture(
        val rootDir: File,
        val requiredModel: File,
        val cache: ModelExtractionCache,
    ) {
        fun delete() {
            check(!rootDir.exists() || rootDir.deleteRecursively()) {
                "Could not delete test fixture: ${rootDir.absolutePath}"
            }
        }
    }
}
