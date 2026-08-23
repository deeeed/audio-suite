package net.siteed.sherpaonnx.utils

import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import net.siteed.sherpaonnx.SherpaOnnxImpl
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Serializes promotion within this instrumentation process. */
internal class ModelExtractionCache(
    val targetDir: File,
    requiredFiles: List<File>,
) {
    private val requiredFilePaths = requiredFiles.map { requiredFile ->
        requiredFile.relativeTo(targetDir).path.also { relativePath ->
            require(relativePath != ".." && !relativePath.startsWith("../")) {
                "Required model asset must be inside ${targetDir.absolutePath}: ${requiredFile.absolutePath}"
            }
        }
    }

    fun isComplete(): Boolean =
        completionMarker(targetDir).isFile && assetsExist(targetDir)

    fun createAttemptDir(): File {
        val parentDir = checkNotNull(targetDir.parentFile) {
            "Extraction directory has no parent: ${targetDir.absolutePath}"
        }
        check(parentDir.mkdirs() || parentDir.isDirectory) {
            "Could not create extraction parent directory: ${parentDir.absolutePath}"
        }
        return File(parentDir, ".${targetDir.name}.extracting-${UUID.randomUUID()}").also { attemptDir ->
            check(attemptDir.mkdir()) {
                "Could not create extraction attempt directory: ${attemptDir.absolutePath}"
            }
        }
    }

    fun promote(attemptDir: File) {
        check(assetsExist(attemptDir)) { "Extraction completed without all required model assets" }
        completionMarker(attemptDir).writeText("complete")

        synchronized(promotionLock(targetDir)) {
            if (isComplete()) {
                discardAttempt(attemptDir)
                return
            }

            val backupDir = File(
                targetDir.parentFile,
                ".${targetDir.name}.replaced-${UUID.randomUUID()}"
            )
            if (targetDir.exists()) {
                check(targetDir.renameTo(backupDir)) {
                    "Could not move stale extraction cache: ${targetDir.absolutePath}"
                }
            }

            if (!attemptDir.renameTo(targetDir)) {
                if (backupDir.exists()) {
                    check(backupDir.renameTo(targetDir)) {
                        "Could not restore extraction cache after promotion failed: ${targetDir.absolutePath}"
                    }
                }
                error("Could not promote extraction attempt to ${targetDir.absolutePath}")
            }

            deleteRecursively(backupDir, "replaced extraction cache")
        }
    }

    fun discardAttempt(attemptDir: File) {
        deleteRecursively(attemptDir, "extraction attempt")
    }

    private fun assetsExist(rootDir: File): Boolean =
        requiredFilePaths.all { relativePath ->
            File(rootDir, relativePath).let { it.isFile && it.length() > 0 }
        }

    private fun completionMarker(rootDir: File): File = File(rootDir, ".extraction-complete")

    private fun deleteRecursively(directory: File, description: String) {
        check(!directory.exists() || directory.deleteRecursively()) {
            "Could not delete $description: ${directory.absolutePath}"
        }
    }

    companion object {
        // Tests use two fixed model targets. Retaining their locks for the process lifetime
        // avoids unsafe removal while another thread is waiting on the same monitor.
        private val promotionLocks = ConcurrentHashMap<String, Any>()

        private fun promotionLock(targetDir: File): Any =
            promotionLocks.getOrPut(targetDir.absoluteFile.normalize().path) { Any() }
    }
}

internal data class ModelExtractionResult(
    val completed: Boolean,
    val success: Boolean,
    val error: String?,
    val errorCode: String? = null,
    val cause: Throwable? = null,
)

private sealed class ExtractionState {
    data object Pending : ExtractionState()
    data object TimedOut : ExtractionState()
    data class Finished(val result: ModelExtractionResult) : ExtractionState()
}

internal typealias ArchiveExtractionStarter = (String, String, Promise) -> Unit

internal fun extractModelArchive(
    sherpaOnnxImpl: SherpaOnnxImpl,
    sourcePath: String,
    cache: ModelExtractionCache,
    timeoutSeconds: Long,
): ModelExtractionResult = extractModelArchive(
    sourcePath = sourcePath,
    cache = cache,
    timeoutSeconds = timeoutSeconds,
    startExtraction = sherpaOnnxImpl::extractTarBz2,
)

internal fun extractModelArchive(
    sourcePath: String,
    cache: ModelExtractionCache,
    timeoutSeconds: Long,
    startExtraction: ArchiveExtractionStarter,
): ModelExtractionResult {
    val attemptDir = cache.createAttemptDir()
    val latch = CountDownLatch(1)
    val state = AtomicReference<ExtractionState>(ExtractionState.Pending)

    fun discardTimedOutAttempt() {
        try {
            cache.discardAttempt(attemptDir)
        } catch (cleanupError: Exception) {
            // The caller already received a timeout. A late cleanup failure must not crash
            // the main looper long after that test returned.
            Log.w("ModelExtractionCache", "Could not discard timed-out extraction", cleanupError)
        }
    }

    fun finish(createResult: () -> ModelExtractionResult) {
        // React Native promises should invoke one terminal callback. The state transition
        // enforces that contract. Promotion stays on the waiting thread, so a timed-out
        // callback can never promote after the timeout result has returned.
        val result = try {
            createResult()
        } catch (error: Exception) {
            ModelExtractionResult(
                completed = true,
                success = false,
                error = error.message ?: error.toString(),
                cause = error,
            )
        }
        if (!state.compareAndSet(ExtractionState.Pending, ExtractionState.Finished(result))) {
            if (state.get() == ExtractionState.TimedOut) {
                discardTimedOutAttempt()
            }
            return
        }
        latch.countDown()
    }

    val promise = createPromise(
        onResolve = { resolvedValue ->
            finish {
                val resolvedMap = resolvedValue as? ReadableMap
                    ?: return@finish ModelExtractionResult(
                        completed = true,
                        success = false,
                        error = "Archive extraction returned no result map",
                    )
                val success = resolvedMap.getBoolean("success")
                if (!success) {
                    val message = if (
                        resolvedMap.hasKey("message") && !resolvedMap.isNull("message")
                    ) {
                        resolvedMap.getString("message")
                    } else {
                        null
                    }
                    return@finish ModelExtractionResult(
                        completed = true,
                        success = false,
                        error = message ?: "Archive extraction reported failure",
                    )
                }

                ModelExtractionResult(completed = true, success = true, error = null)
            }
        },
        onReject = { code, message, cause ->
            finish {
                val diagnostic = listOfNotNull(
                    code,
                    message,
                    cause?.message?.takeUnless { it == message },
                ).joinToString(": ").ifEmpty { "Archive extraction was rejected" }
                ModelExtractionResult(
                    completed = true,
                    success = false,
                    error = diagnostic,
                    errorCode = code,
                    cause = cause,
                )
            }
        },
    )
    try {
        startExtraction(sourcePath, attemptDir.absolutePath, promise)
    } catch (error: Exception) {
        finish {
            ModelExtractionResult(
                completed = true,
                success = false,
                error = error.message ?: error.toString(),
                cause = error,
            )
        }
    }

    if (!latch.await(timeoutSeconds, TimeUnit.SECONDS) &&
        state.compareAndSet(ExtractionState.Pending, ExtractionState.TimedOut)
    ) {
        return ModelExtractionResult(
            completed = false,
            success = false,
            error = "Timed out after $timeoutSeconds seconds",
        )
    }

    // If the timeout CAS lost, the callback already published Finished. No unbounded
    // boundary wait is needed, and only this waiting thread may promote the attempt.
    var result = (state.get() as ExtractionState.Finished).result
    if (result.success) {
        result = try {
            cache.promote(attemptDir)
            result
        } catch (promotionError: Exception) {
            ModelExtractionResult(
                completed = true,
                success = false,
                error = promotionError.message ?: promotionError.toString(),
                cause = promotionError,
            )
        }
    }
    try {
        cache.discardAttempt(attemptDir)
    } catch (cleanupError: Exception) {
        result = ModelExtractionResult(
            completed = true,
            success = false,
            error = listOfNotNull(result.error, cleanupError.message).joinToString("; "),
            errorCode = result.errorCode,
            cause = result.cause ?: cleanupError,
        )
    }
    return result
}
