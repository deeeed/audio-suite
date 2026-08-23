package net.siteed.sherpaonnx.utils

import android.content.Context
import android.util.Log
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.*

/**
 * Utility class for handling archive files like tar.bz2
 */
object ArchiveUtils {
    private const val TAG = "ArchiveUtils"

    /**
     * Result class for extraction operations
     */
    data class ExtractionResult(
        val success: Boolean,
        val message: String,
        val extractedFiles: List<String> = emptyList()
    )

    internal fun resolveArchiveEntry(targetDir: File, entryName: String): File {
        if (File(entryName).isAbsolute) {
            throw IOException("Archive entry uses an absolute path: $entryName")
        }
        val canonicalTarget = targetDir.canonicalFile
        val outputFile = File(canonicalTarget, entryName).canonicalFile
        val targetPrefix = canonicalTarget.path + File.separator
        if (outputFile != canonicalTarget && !outputFile.path.startsWith(targetPrefix)) {
            throw IOException("Archive entry escapes target directory: $entryName")
        }
        return outputFile
    }

    /**
     * Extract a tar.bz2 file to a target directory
     *
     * @param context Android context
     * @param sourcePath The full path to the tar.bz2 file
     * @param targetDir The directory where files should be extracted
     * @return ExtractionResult containing the result status and list of extracted files
     */
    fun extractTarBz2(context: Context, sourcePath: String, targetDir: String): ExtractionResult {
        val startTime = System.currentTimeMillis()
        Log.i(TAG, "Extracting tar.bz2 from $sourcePath to $targetDir")
        
        // Check if source file exists
        val sourceFile = File(sourcePath)
        if (!sourceFile.exists() || !sourceFile.canRead()) {
            Log.e(TAG, "Source file doesn't exist or can't be read: $sourcePath")
            return ExtractionResult(false, "Source file doesn't exist or can't be read: $sourcePath")
        }
        
        // Ensure target directory exists
        val targetDirFile = File(targetDir)
        if (!targetDirFile.exists()) {
            if (!targetDirFile.mkdirs()) {
                Log.e(TAG, "Failed to create target directory: $targetDir")
                return ExtractionResult(false, "Failed to create target directory: $targetDir")
            }
        }
        
        val extractedFiles = mutableListOf<String>()
        
        try {
            FileInputStream(sourceFile).buffered().use { sourceStream ->
                BZip2CompressorInputStream(sourceStream).use { bzip2Stream ->
                    TarArchiveInputStream(bzip2Stream).use { tarInputStream ->
                        var entry = tarInputStream.nextTarEntry
                        while (entry != null) {
                            val entryName = entry.name
                            val outputFile = resolveArchiveEntry(targetDirFile, entryName)

                            Log.d(TAG, "Extracting entry: $entryName")

                            if (entry.isDirectory) {
                                if (!outputFile.exists() && !outputFile.mkdirs()) {
                                    Log.w(TAG, "Failed to create directory: ${outputFile.absolutePath}")
                                }
                            } else {
                                val parent = outputFile.parentFile
                                if (parent != null && !parent.exists() && !parent.mkdirs()) {
                                    Log.w(TAG, "Failed to create parent directory: ${parent.absolutePath}")
                                }

                                FileOutputStream(outputFile).use { outputStream ->
                                    val buffer = ByteArray(8192)
                                    var bytesRead: Int
                                    while (tarInputStream.read(buffer).also { bytesRead = it } != -1) {
                                        outputStream.write(buffer, 0, bytesRead)
                                    }
                                }
                                extractedFiles.add(entryName)
                            }

                            entry = tarInputStream.nextTarEntry
                        }
                    }
                }
            }

            val elapsedTime = System.currentTimeMillis() - startTime
            Log.i(TAG, "Extraction completed in ${elapsedTime}ms. Extracted ${extractedFiles.size} files.")
            
            return ExtractionResult(
                success = true,
                message = "Successfully extracted ${extractedFiles.size} files",
                extractedFiles = extractedFiles
            )
            
        } catch (e: Exception) {
            Log.e(TAG, "Error extracting tar.bz2 file: ${e.message}", e)
            return ExtractionResult(false, "Error extracting archive: ${e.message}")
        }
    }
    
    /**
     * Fallback method to create mock model files when extraction fails
     *
     * @param targetDir The directory where mock files should be created
     * @param modelId The ID of the model (for logging purposes)
     * @return ExtractionResult containing the result status and list of created files
     */
    fun createMockModelFiles(targetDir: String, modelId: String): ExtractionResult {
        Log.i(TAG, "Creating mock model files in $targetDir for model $modelId")
        
        val targetDirFile = File(targetDir)
        if (!targetDirFile.exists()) {
            if (!targetDirFile.mkdirs()) {
                Log.e(TAG, "Failed to create target directory: $targetDir")
                return ExtractionResult(false, "Failed to create target directory: $targetDir")
            }
        }
        
        val mockFiles = listOf("model.onnx", "voices.bin", "tokens.txt")
        val createdFiles = mutableListOf<String>()
        
        try {
            for (file in mockFiles) {
                val outputFile = File(targetDirFile, file)
                val content = "This is a mock $file file created for model $modelId.\n" +
                              "Please replace this with the actual model file content."
                
                val outputStream = FileOutputStream(outputFile)
                outputStream.write(content.toByteArray())
                outputStream.close()
                
                createdFiles.add(file)
                Log.d(TAG, "Created mock file: ${outputFile.absolutePath}")
            }
            
            return ExtractionResult(
                success = true,
                message = "Created ${createdFiles.size} mock model files",
                extractedFiles = createdFiles
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error creating mock files: ${e.message}", e)
            return ExtractionResult(false, "Error creating mock files: ${e.message}")
        }
    }
}
