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
import java.util.concurrent.locks.ReentrantLock

private const val EXTRACTION_LOG_TAG = "ModelExtractionCache"

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

    fun promote(attemptDir: File, deadlineNanos: Long) {
        check(assetsExist(attemptDir)) { "Extraction completed without all required model assets" }
        completionMarker(attemptDir).writeText("complete")

        val lock = promotionLock(targetDir)
        val remainingNanos = deadlineNanos - System.nanoTime()
        val acquired = if (remainingNanos > 0) {
            try {
                lock.tryLock(remainingNanos, TimeUnit.NANOSECONDS)
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
                throw error
            }
        } else {
            false
        }
        check(acquired) {
            "Timed out waiting to promote ${targetDir.absolutePath}"
        }
        var backupDir: File? = null
        try {
            check(System.nanoTime() < deadlineNanos) {
                "Timed out before promoting ${targetDir.absolutePath}"
            }
            if (isComplete()) {
                return
            }

            backupDir = File(
                targetDir.parentFile,
                ".${targetDir.name}.replaced-${UUID.randomUUID()}"
            )
            if (targetDir.exists()) {
                check(System.nanoTime() < deadlineNanos) {
                    "Timed out before replacing ${targetDir.absolutePath}"
                }
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
        } finally {
            lock.unlock()
        }
        backupDir?.let { replacedDir ->
            try {
                deleteRecursively(replacedDir, "replaced extraction cache")
            } catch (cleanupError: Exception) {
                // The new cache is already committed. Report the leftover backup without
                // turning a successful promotion into a false failure.
                Log.w(EXTRACTION_LOG_TAG, "Could not discard replaced extraction cache", cleanupError)
            }
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
        private val promotionLocks = ConcurrentHashMap<String, ReentrantLock>()

        private fun promotionLock(targetDir: File): ReentrantLock =
            promotionLocks.getOrPut(targetDir.absoluteFile.normalize().path) { ReentrantLock() }
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
    val deadlineNanos = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds)
    val latch = CountDownLatch(1)
    val state = AtomicReference<ExtractionState>(ExtractionState.Pending)

    fun discardTimedOutAttempt() {
        try {
            cache.discardAttempt(attemptDir)
        } catch (cleanupError: Exception) {
            // The caller already received a timeout. A late cleanup failure must not crash
            // the main looper long after that test returned.
            Log.w(EXTRACTION_LOG_TAG, "Could not discard timed-out extraction", cleanupError)
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
    val starterThread = Thread {
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
    }.apply {
        name = "model-extraction-starter"
        isDaemon = true
        start()
    }

    val completedInTime = try {
        val remainingNanos = deadlineNanos - System.nanoTime()
        remainingNanos > 0 && latch.await(remainingNanos, TimeUnit.NANOSECONDS)
    } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        starterThread.interrupt()
        val previous = state.getAndSet(ExtractionState.TimedOut)
        if (previous is ExtractionState.Finished) discardTimedOutAttempt()
        return ModelExtractionResult(
            completed = false,
            success = false,
            error = "Interrupted while waiting for model extraction",
        )
    }
    if (!completedInTime) {
        starterThread.interrupt()
        val previous = state.getAndSet(ExtractionState.TimedOut)
        if (previous is ExtractionState.Finished) discardTimedOutAttempt()
        return ModelExtractionResult(
            completed = false,
            success = false,
            error = "Timed out after $timeoutSeconds seconds",
        )
    }

    var result = (state.get() as ExtractionState.Finished).result
    if (result.success) {
        result = try {
            cache.promote(attemptDir, deadlineNanos)
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
