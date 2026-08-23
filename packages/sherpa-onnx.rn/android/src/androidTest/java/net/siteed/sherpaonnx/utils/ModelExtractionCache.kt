package net.siteed.sherpaonnx.utils

import com.facebook.react.bridge.ReadableMap
import net.siteed.sherpaonnx.SherpaOnnxImpl
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

internal class ModelExtractionCache(
    val targetDir: File,
    private val requiredFiles: List<File>,
    private val requiredDirectories: List<File> = emptyList()
) {
    private val completionMarker = File(targetDir, ".extraction-complete")

    fun isComplete(): Boolean =
        completionMarker.isFile && assetsExist()

    fun reset() {
        targetDir.deleteRecursively()
        check(targetDir.mkdirs() || targetDir.isDirectory) {
            "Could not create extraction directory: ${targetDir.absolutePath}"
        }
    }

    fun markComplete() {
        check(assetsExist()) { "Extraction completed without all required model assets" }
        completionMarker.writeText("complete")
    }

    private fun assetsExist(): Boolean =
        requiredFiles.all { it.isFile && it.length() > 0 } &&
            requiredDirectories.all { it.isDirectory && !it.list().isNullOrEmpty() }
}

internal data class ModelExtractionResult(
    val completed: Boolean,
    val success: Boolean,
    val error: String?
)

internal fun extractModelArchive(
    sherpaOnnxImpl: SherpaOnnxImpl,
    sourcePath: String,
    cache: ModelExtractionCache,
    timeoutSeconds: Long
): ModelExtractionResult {
    val latch = CountDownLatch(1)
    var success = false
    var error: String? = null

    sherpaOnnxImpl.extractTarBz2(
        sourcePath,
        cache.targetDir.absolutePath,
        createPromise(
            onResolve = { result ->
                try {
                    success = (result as? ReadableMap)?.getBoolean("success") ?: false
                    if (success) cache.markComplete()
                } catch (failure: Throwable) {
                    success = false
                    error = failure.message ?: failure.toString()
                } finally {
                    latch.countDown()
                }
            },
            onReject = { _, message, _ ->
                error = message
                latch.countDown()
            }
        )
    )

    val completed = latch.await(timeoutSeconds, TimeUnit.SECONDS)
    return ModelExtractionResult(
        completed = completed,
        success = success,
        error = error ?: if (completed) null else "Timed out after $timeoutSeconds seconds"
    )
}
