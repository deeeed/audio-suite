package net.siteed.sherpaonnx

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.ReactApplicationContext
import junit.framework.TestCase.*
import kotlinx.coroutines.runBlocking
import net.siteed.sherpaonnx.utils.LightweightModelDownloader
import org.junit.AfterClass
import org.junit.BeforeClass
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.*
import kotlin.system.measureTimeMillis
import net.siteed.sherpaonnx.utils.createTestReactContext

@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class ComprehensiveIntegrationTestSuite {

    companion object {
        private lateinit var context: android.content.Context
        private lateinit var reactContext: ReactApplicationContext
        private lateinit var sherpaOnnxImpl: SherpaOnnxImpl
        private lateinit var testReportFile: File
        private val testResults = mutableMapOf<String, TestResult>()
        
        @BeforeClass
        @JvmStatic
        fun setUpClass() {
            context = InstrumentationRegistry.getInstrumentation().targetContext
            
            reactContext = createTestReactContext(context)
            sherpaOnnxImpl = SherpaOnnxImpl(reactContext)
            
            // Create comprehensive test report
            val timestamp = SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US).format(Date())
            testReportFile = File(context.cacheDir, "sherpa_integration_test_report_$timestamp.html")
            
            println("\n" + "=".repeat(80))
            println("SHERPA-ONNX COMPREHENSIVE INTEGRATION TEST SUITE")
            println("=".repeat(80))
            println("Test Report: ${testReportFile.absolutePath}")
            println("Start Time: ${SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())}")
            
            // Pre-download models for all tests
            runBlocking {
                preDownloadModels()
            }
        }
        
        @AfterClass
        @JvmStatic
        fun tearDownClass() {
            generateComprehensiveReport()
            
            println("\n" + "=".repeat(80))
            println("TEST SUITE COMPLETED")
            println("=".repeat(80))
            println("Report generated: ${testReportFile.absolutePath}")
            println("End Time: ${SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())}")
            
            // Optionally clean up models (comment out to keep for faster subsequent runs)
            // cleanupAllModels()
        }
        
        private suspend fun preDownloadModels() {
            println("\nPre-downloading test models...")
            
            val modelsToDownload = listOf(
                LightweightModelDownloader.TestModel.VITS_EN_LOW,
                LightweightModelDownloader.TestModel.SILERO_VAD,
                LightweightModelDownloader.TestModel.WHISPER_TINY
            )
            
            val totalSize = LightweightModelDownloader.getTotalDownloadSize(modelsToDownload)
            println("Total download size: ${totalSize / 1024 / 1024}MB")
            
            if (LightweightModelDownloader.areModelsCached(context, modelsToDownload)) {
                println("All models already cached!")
                return
            }
            
            val downloadTime = measureTimeMillis {
                val results = LightweightModelDownloader.downloadModels(
                    context = context,
                    models = modelsToDownload,
                    progressListener = object : LightweightModelDownloader.DownloadProgressListener {
                        override fun onProgress(bytesDownloaded: Long, totalBytes: Long, percentComplete: Int) {
                            if (percentComplete % 25 == 0) {
                                println("  Download progress: $percentComplete%")
                            }
                        }
                        
                        override fun onComplete(modelFile: File) {
                            println("  Downloaded: ${modelFile.name}")
                        }
                        
                        override fun onError(error: Exception) {
                            println("  Download error: ${error.message}")
                        }
                    }
                )
                
                println("Successfully downloaded ${results.size}/${modelsToDownload.size} models")
            }
            
            println("Model download completed in ${downloadTime / 1000}s")
        }
        
        private fun cleanupAllModels() {
            LightweightModelDownloader.cleanupModels(
                context,
                LightweightModelDownloader.TestModel.values().toList()
            )
        }
        
        private fun generateComprehensiveReport() {
            FileWriter(testReportFile).use { writer ->
                writer.write("""
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Sherpa-ONNX Integration Test Report</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; }
                            .header { background-color: #f0f0f0; padding: 20px; border-radius: 5px; }
                            .test-category { margin: 20px 0; }
                            .test-result { margin: 10px 0; padding: 10px; border-left: 4px solid; }
                            .passed { border-color: #4CAF50; background-color: #f8fff8; }
                            .failed { border-color: #f44336; background-color: #fff8f8; }
                            .details { margin-top: 10px; font-size: 0.9em; color: #666; }
                            .metrics { background-color: #f9f9f9; padding: 10px; margin: 10px 0; }
                            table { border-collapse: collapse; width: 100%; margin: 10px 0; }
                            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                            th { background-color: #f2f2f2; }
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <h1>Sherpa-ONNX Comprehensive Integration Test Report</h1>
                            <p><strong>Generated:</strong> ${SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())}</p>
                            <p><strong>Device:</strong> ${android.os.Build.MODEL} (${android.os.Build.MANUFACTURER})</p>
                            <p><strong>Android Version:</strong> ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})</p>
                        </div>
                """.trimIndent())
                
                // Test summary
                val totalTests = testResults.size
                val passedTests = testResults.values.count { it.passed }
                val failedTests = totalTests - passedTests
                
                writer.write("""
                    <div class="test-category">
                        <h2>Test Summary</h2>
                        <div class="metrics">
                            <table>
                                <tr><th>Total Tests</th><td>$totalTests</td></tr>
                                <tr><th>Passed</th><td style="color: green;">$passedTests</td></tr>
                                <tr><th>Failed</th><td style="color: red;">$failedTests</td></tr>
                                <tr><th>Success Rate</th><td>${if (totalTests > 0) (passedTests * 100 / totalTests) else 0}%</td></tr>
                            </table>
                        </div>
                    </div>
                """.trimIndent())
                
                // Group tests by category
                val categories = mapOf(
                    "System Information" to testResults.filterKeys { it.contains("system") || it.contains("architecture") },
                    "Memory & Performance" to testResults.filterKeys { it.contains("memory") || it.contains("performance") || it.contains("profil") },
                    "TTS Functionality" to testResults.filterKeys { it.contains("tts") },
                    "ASR Functionality" to testResults.filterKeys { it.contains("asr") },
                    "Integration & Stability" to testResults.filterKeys { it.contains("integration") || it.contains("stability") }
                )
                
                categories.forEach { (categoryName, categoryTests) ->
                    if (categoryTests.isNotEmpty()) {
                        writer.write("""
                            <div class="test-category">
                                <h2>$categoryName</h2>
                        """.trimIndent())
                        
                        categoryTests.forEach { (testName, result) ->
                            val cssClass = if (result.passed) "passed" else "failed"
                            writer.write("""
                                <div class="test-result $cssClass">
                                    <h3>${result.passed.let { if (it) "✅" else "❌" }} $testName</h3>
                                    <div class="details">
                                        <p><strong>Duration:</strong> ${result.durationMs}ms</p>
                                        ${if (result.errorMessage != null) "<p><strong>Error:</strong> ${result.errorMessage}</p>" else ""}
                                        ${if (result.details.isNotEmpty()) "<p><strong>Details:</strong> ${result.details}</p>" else ""}
                                    </div>
                                </div>
                            """.trimIndent())
                        }
                        
                        writer.write("</div>")
                    }
                }
                
                writer.write("""
                    </body>
                    </html>
                """.trimIndent())
            }
            
            println("Comprehensive test report generated: ${testReportFile.absolutePath}")
        }
    }

    // Test execution with result tracking

    @Test
    fun test01_SystemInfoBaseline() {
        runTestWithTracking("system_info_baseline") {
            val systemInfoTest = SystemInfoTest()
            systemInfoTest.setUp()
            systemInfoTest.testGetSystemInfo()
        }
    }





    @Test
    fun test06_SystemInfoPerformanceProfile() {
        runTestWithTracking("system_info_performance_profile") {
            val profilerTest = MemoryAndPerformanceProfilerTest()
            profilerTest.setUp()
            profilerTest.testSystemInfoPerformanceProfile()
        }
    }

    @Test
    fun test07_DeviceCapabilityOptimization() {
        runTestWithTracking("device_capability_optimization") {
            val profilerTest = MemoryAndPerformanceProfilerTest()
            profilerTest.setUp()
            profilerTest.testDeviceCapabilityBasedOptimization()
        }
    }

    @Test
    fun test08_MemoryProfileAcrossOperations() {
        runTestWithTracking("memory_profile_operations") {
            val profilerTest = MemoryAndPerformanceProfilerTest()
            profilerTest.setUp()
            profilerTest.testMemoryProfileAcrossOperations()
        }
    }

    @Test
    fun test09_TtsInitialization() {
        runTestWithTracking("tts_initialization") {
            val ttsTest = RealTtsFunctionalityTest()
            runBlocking {
                ttsTest.setUp()
                ttsTest.testRealTtsInitialization()
                ttsTest.tearDown()
            }
        }
    }

    @Test
    fun test10_TtsGeneration() {
        runTestWithTracking("tts_generation") {
            val ttsTest = RealTtsFunctionalityTest()
            runBlocking {
                ttsTest.setUp()
                ttsTest.testRealTtsGeneration()
                ttsTest.tearDown()
            }
        }
    }

    @Test
    fun test11_TtsMemoryManagement() {
        runTestWithTracking("tts_memory_management") {
            val ttsTest = RealTtsFunctionalityTest()
            runBlocking {
                ttsTest.setUp()
                ttsTest.testTtsMemoryManagement()
                ttsTest.tearDown()
            }
        }
    }

    @Test
    fun test12_AsrInitialization() {
        runTestWithTracking("asr_initialization") {
            val asrTest = RealAsrFunctionalityTest()
            runBlocking {
                asrTest.setUp()
                asrTest.testAsrInitialization()
                asrTest.tearDown()
            }
        }
    }

    @Test
    fun test13_AsrWithGeneratedAudio() {
        runTestWithTracking("asr_generated_audio") {
            val asrTest = RealAsrFunctionalityTest()
            runBlocking {
                asrTest.setUp()
                asrTest.testAsrWithGeneratedAudio()
                asrTest.tearDown()
            }
        }
    }

    @Test
    fun test14_AsrPerformance() {
        runTestWithTracking("asr_performance") {
            val asrTest = RealAsrFunctionalityTest()
            runBlocking {
                asrTest.setUp()
                asrTest.testAsrPerformance()
                asrTest.tearDown()
            }
        }
    }

    @Test
    fun test15_LongRunningStability() {
        runTestWithTracking("long_running_stability") {
            val profilerTest = MemoryAndPerformanceProfilerTest()
            profilerTest.setUp()
            profilerTest.testLongRunningStabilityProfile()
        }
    }

    // Helper function to run tests with result tracking
    private fun runTestWithTracking(testName: String, testBlock: () -> Unit) {
        println("\n" + "-".repeat(60))
        println("Running: $testName")
        println("-".repeat(60))
        
        val startTime = System.currentTimeMillis()
        var passed = false
        var errorMessage: String? = null
        var details = ""
        
        try {
            testBlock()
            passed = true
            details = "Test completed successfully"
        } catch (e: Exception) {
            passed = false
            errorMessage = e.message
            details = e.stackTrace.take(3).joinToString("; ") { "${it.className}.${it.methodName}:${it.lineNumber}" }
            
            // Re-throw to maintain JUnit behavior
            throw e
        } finally {
            val duration = System.currentTimeMillis() - startTime
            
            testResults[testName] = TestResult(
                name = testName,
                passed = passed,
                durationMs = duration,
                errorMessage = errorMessage,
                details = details
            )
            
            val status = if (passed) "PASSED" else "FAILED"
            println("$testName: $status (${duration}ms)")
            
            if (errorMessage != null) {
                println("Error: $errorMessage")
            }
        }
    }

    data class TestResult(
        val name: String,
        val passed: Boolean,
        val durationMs: Long,
        val errorMessage: String?,
        val details: String
    )
}
