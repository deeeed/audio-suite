package net.siteed.sherpaonnx

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import junit.framework.TestCase.*
import kotlinx.coroutines.runBlocking
import net.siteed.sherpaonnx.utils.LightweightModelDownloader
import net.siteed.sherpaonnx.utils.createPromise
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.system.measureTimeMillis
import net.siteed.sherpaonnx.utils.createTestReactContext

@RunWith(AndroidJUnit4::class)
class MemoryAndPerformanceProfilerTest {

    private lateinit var sherpaOnnxImpl: SherpaOnnxImpl
    private lateinit var reactContext: ReactApplicationContext
    private lateinit var context: android.content.Context
    private lateinit var profileDataFile: File
    private var baselineSystemInfo: SystemInfoSnapshot? = null

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        reactContext = createTestReactContext(context)
        sherpaOnnxImpl = SherpaOnnxImpl(reactContext)
        
        // Create profile data file
        val timestamp = SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US).format(Date())
        profileDataFile = File(context.cacheDir, "sherpa_performance_profile_$timestamp.csv")
        
        // Initialize CSV with headers
        FileWriter(profileDataFile, true).use { writer ->
            writer.append("timestamp,test_name,operation,architecture_type,duration_ms,memory_before_mb,memory_after_mb,memory_delta_mb,cpu_cores,device_model,success\n")
        }
        
        // Capture baseline system info
        baselineSystemInfo = captureSystemInfo("baseline")
        println("Baseline system info captured: $baselineSystemInfo")
    }

    @Test
    fun testSystemInfoPerformanceProfile() {
        println("\n=== System Info Performance Profile ===")
        
        // Rapid successive calls to test caching behavior
        val numCalls = 50
        val durations = mutableListOf<Long>()
        val memorySnapshots = mutableListOf<SystemInfoSnapshot>()
        
        repeat(numCalls) { iteration ->
            val startMemory = getMemoryUsage()
            
            val duration = measureTimeMillis {
                val systemInfo = getSystemInfoSync()
                assertNotNull("System info should not be null", systemInfo)
            }
            
            val endMemory = getMemoryUsage()
            durations.add(duration)
            
            if (iteration % 10 == 0) {
                val snapshot = captureSystemInfo("rapid_calls_$iteration")
                memorySnapshots.add(snapshot)
                logToProfile("rapid_system_info_calls", "getSystemInfo", duration, startMemory, endMemory, true)
            }
        }
        
        // Analyze performance characteristics
        val avgDuration = durations.average()
        val maxDuration = durations.maxOrNull() ?: 0L
        val minDuration = durations.minOrNull() ?: 0L
        
        println("System Info Performance Analysis:")
        println("  Average duration: ${String.format("%.2f", avgDuration)}ms")
        println("  Min duration: ${minDuration}ms")
        println("  Max duration: ${maxDuration}ms")
        println("  Standard deviation: ${String.format("%.2f", calculateStandardDeviation(durations))}")
        
        // Performance should be consistent and fast
        assertTrue("Average call time should be under 50ms", avgDuration < 50)
        assertTrue("Max call time should be under 100ms", maxDuration < 100)
        
        // Memory usage should be stable
        val memoryDeltas = memorySnapshots.windowed(2).map { (first, second) ->
            second.memoryInfo.usedMemoryMB - first.memoryInfo.usedMemoryMB
        }
        val avgMemoryDelta = memoryDeltas.average()
        println("  Average memory delta per 10 calls: ${String.format("%.2f", avgMemoryDelta)}MB")
        assertTrue("Memory usage should be stable", avgMemoryDelta < 1.0)
    }

    @Test
    fun testArchitectureDetectionImpact() {
        println("\n=== Architecture Detection Impact ===")
        
        val startMemory = getMemoryUsage()
        val architectureInfo = getSystemInfoSync()?.getMap("architecture")
        val endMemory = getMemoryUsage()
        
        assertNotNull("Architecture info should be available", architectureInfo)
        
        val archType = architectureInfo?.getString("type")
        val moduleType = architectureInfo?.getString("moduleType")
        val jsiAvailable = architectureInfo?.getBoolean("jsiAvailable") ?: false
        val turboModulesEnabled = architectureInfo?.getBoolean("turboModulesEnabled") ?: false
        
        println("Architecture Details:")
        println("  Type: $archType")
        println("  Module Type: $moduleType")
        println("  JSI Available: $jsiAvailable")
        println("  TurboModules Enabled: $turboModulesEnabled")
        
        logToProfile("architecture_detection", "detect_and_analyze", 0, startMemory, endMemory, true)
        
        // Verify architecture consistency
        if (archType == "new") {
            assertTrue("New architecture should have TurboModules enabled", turboModulesEnabled)
            assertEquals("New architecture should use TurboModule", "TurboModule", moduleType)
        } else {
            assertFalse("Old architecture should not have TurboModules enabled", turboModulesEnabled)
            assertEquals("Old architecture should use Bridge Module", "Bridge Module", moduleType)
        }
    }

    @Test
    fun testMemoryProfileAcrossOperations() {
        println("\n=== Memory Profile Across Operations ===")
        
        val operations = listOf(
            "validateLibraryLoaded" to { promise: com.facebook.react.bridge.Promise ->
                sherpaOnnxImpl.validateLibraryLoaded(promise)
            },
            "testOnnxIntegration" to { promise: com.facebook.react.bridge.Promise ->
                sherpaOnnxImpl.testOnnxIntegration(promise)
            },
            "getSystemInfo" to { promise: com.facebook.react.bridge.Promise ->
                sherpaOnnxImpl.getSystemInfo(promise)
            },
            "getArchitectureInfo" to { promise: com.facebook.react.bridge.Promise ->
                sherpaOnnxImpl.getArchitectureInfo(promise)
            }
        )
        
        val memoryProfile = mutableMapOf<String, MemoryDelta>()
        
        operations.forEach { (operationName, operation) ->
            println("\nProfiling operation: $operationName")
            
            // Force garbage collection before measurement
            System.gc()
            Thread.sleep(100)
            
            val startMemory = getMemoryUsage()
            val startSystemInfo = captureSystemInfo("before_$operationName")
            
            val latch = CountDownLatch(1)
            var success = false
            
            val duration = measureTimeMillis {
                operation(createPromise(
                    onResolve = { _ ->
                        success = true
                        latch.countDown()
                    },
                    onReject = { _, _, _ ->
                        latch.countDown()
                    }
                ))
                
                latch.await(10, TimeUnit.SECONDS)
            }
            
            // Measure memory after operation
            val endMemory = getMemoryUsage()
            val endSystemInfo = captureSystemInfo("after_$operationName")
            
            val memoryDelta = endMemory - startMemory
            memoryProfile[operationName] = MemoryDelta(startMemory, endMemory, memoryDelta)
            
            logToProfile("memory_profile", operationName, duration, startMemory, endMemory, success)
            
            println("  Duration: ${duration}ms")
            println("  Memory before: ${startMemory}MB")
            println("  Memory after: ${endMemory}MB")
            println("  Memory delta: ${memoryDelta}MB")
            println("  Success: $success")
            
            assertTrue("Operation should succeed", success)
            assertTrue("Memory delta should be reasonable", memoryDelta < 5.0)
        }
        
        // Analyze overall memory trend
        val totalMemoryIncrease = memoryProfile.values.sumOf { it.delta }
        println("\nOverall Memory Analysis:")
        println("  Total memory increase: ${String.format("%.2f", totalMemoryIncrease)}MB")
        assertTrue("Total memory increase should be under 10MB", totalMemoryIncrease < 10.0)
    }

    @Test
    fun testDeviceCapabilityBasedOptimization() {
        println("\n=== Device Capability Based Optimization ===")
        
        val systemInfo = getSystemInfoSync()
        assertNotNull("System info should be available", systemInfo)
        
        val cpuInfo = systemInfo!!.getMap("cpu")
        val memoryInfo = systemInfo.getMap("memory")
        val deviceInfo = systemInfo.getMap("device")
        val gpuInfo = systemInfo.getMap("gpu")
        
        val availableProcessors = cpuInfo?.getInt("availableProcessors") ?: 1
        val totalMemoryMB = memoryInfo?.getDouble("totalMemoryMB") ?: 0.0
        val freeMemoryMB = memoryInfo?.getDouble("freeMemoryMB") ?: 0.0
        val deviceModel = deviceInfo?.getString("model") ?: "Unknown"
        val supportsVulkan = gpuInfo?.getBoolean("supportsVulkan") ?: false
        
        println("Device Capabilities:")
        println("  CPU Cores: $availableProcessors")
        println("  Total Memory: ${String.format("%.0f", totalMemoryMB)}MB")
        println("  Free Memory: ${String.format("%.0f", freeMemoryMB)}MB")
        println("  Device Model: $deviceModel")
        println("  Vulkan Support: $supportsVulkan")
        
        // Provide optimization recommendations based on device capabilities
        val recommendations = generateOptimizationRecommendations(
            cpuCores = availableProcessors,
            totalMemoryMB = totalMemoryMB,
            freeMemoryMB = freeMemoryMB,
            supportsVulkan = supportsVulkan
        )
        
        println("\nOptimization Recommendations:")
        recommendations.forEach { println("  - $it") }
        
        logToProfile("device_optimization", "analyze_capabilities", 0, 0.0, 0.0, true)
        
        // Verify recommendations are sensible
        assertTrue("Should have optimization recommendations", recommendations.isNotEmpty())
        assertTrue("Should have CPU thread recommendation", 
            recommendations.any { it.contains("thread") || it.contains("CPU") })
    }

    @Test
    fun testLongRunningStabilityProfile() {
        println("\n=== Long Running Stability Profile ===")
        
        val duration = 30_000L // 30 seconds
        val interval = 2_000L // 2 seconds
        val iterations = (duration / interval).toInt()
        
        val memorySnapshots = mutableListOf<Pair<Long, Double>>()
        val performanceSnapshots = mutableListOf<Pair<Long, Long>>()
        
        val startTime = System.currentTimeMillis()
        
        repeat(iterations) { iteration ->
            val currentTime = System.currentTimeMillis() - startTime
            
            // Capture memory snapshot
            val currentMemory = getMemoryUsage()
            memorySnapshots.add(Pair(currentTime, currentMemory))
            
            // Perform operation and measure performance
            val operationDuration = measureTimeMillis {
                val systemInfo = getSystemInfoSync()
                assertNotNull("System info should be available", systemInfo)
            }
            performanceSnapshots.add(Pair(currentTime, operationDuration))
            
            if (iteration % 5 == 0) {
                println("  Iteration $iteration: memory=${String.format("%.1f", currentMemory)}MB, duration=${operationDuration}ms")
                logToProfile("stability_test", "iteration_$iteration", operationDuration, currentMemory, currentMemory, true)
            }
            
            Thread.sleep(interval)
        }
        
        // Analyze stability
        val memoryTrend = calculateTrend(memorySnapshots)
        val performanceTrend = calculateTrend(performanceSnapshots.map { Pair(it.first, it.second.toDouble()) })
        
        println("Stability Analysis:")
        println("  Memory trend: ${String.format("%.4f", memoryTrend)} MB/sec")
        println("  Performance trend: ${String.format("%.4f", performanceTrend)} ms/sec")
        
        // Memory should be stable (slight increase acceptable)
        assertTrue("Memory should not increase dramatically", memoryTrend < 0.1) // Less than 0.1 MB/sec
        
        // Performance should be stable
        assertTrue("Performance should not degrade", performanceTrend < 0.01) // Less than 0.01 ms/sec
    }

    // Helper functions
    
    private fun captureSystemInfo(tag: String): SystemInfoSnapshot {
        val systemInfo = getSystemInfoSync()
        assertNotNull("System info should be available for $tag", systemInfo)
        
        val memoryInfo = systemInfo!!.getMap("memory")!!
        val cpuInfo = systemInfo.getMap("cpu")!!
        val deviceInfo = systemInfo.getMap("device")!!
        val architectureInfo = systemInfo.getMap("architecture")!!
        
        return SystemInfoSnapshot(
            tag = tag,
            timestamp = System.currentTimeMillis(),
            memoryInfo = MemoryInfoSnapshot(
                usedMemoryMB = memoryInfo.getDouble("usedMemoryMB"),
                freeMemoryMB = memoryInfo.getDouble("freeMemoryMB"),
                totalMemoryMB = memoryInfo.getDouble("totalMemoryMB"),
                maxMemoryMB = memoryInfo.getDouble("maxMemoryMB")
            ),
            cpuCores = cpuInfo.getInt("availableProcessors"),
            deviceModel = deviceInfo.getString("model") ?: "Unknown",
            architectureType = architectureInfo.getString("type") ?: "unknown"
        )
    }
    
    private fun getSystemInfoSync(): ReadableMap? {
        val latch = CountDownLatch(1)
        var result: ReadableMap? = null
        
        sherpaOnnxImpl.getSystemInfo(createPromise(
            onResolve = { res ->
                result = res as? ReadableMap
                latch.countDown()
            },
            onReject = { _, _, _ ->
                latch.countDown()
            }
        ))
        
        latch.await(5, TimeUnit.SECONDS)
        return result
    }
    
    private fun getMemoryUsage(): Double {
        val runtime = Runtime.getRuntime()
        return (runtime.totalMemory() - runtime.freeMemory()) / 1024.0 / 1024.0
    }
    
    private fun logToProfile(
        testName: String,
        operation: String,
        duration: Long,
        memoryBefore: Double,
        memoryAfter: Double,
        success: Boolean
    ) {
        val timestamp = System.currentTimeMillis()
        val memoryDelta = memoryAfter - memoryBefore
        val archType = baselineSystemInfo?.architectureType ?: "unknown"
        val cpuCores = baselineSystemInfo?.cpuCores ?: 0
        val deviceModel = baselineSystemInfo?.deviceModel ?: "Unknown"
        
        FileWriter(profileDataFile, true).use { writer ->
            writer.append("$timestamp,$testName,$operation,$archType,$duration,")
            writer.append("${String.format("%.2f", memoryBefore)},${String.format("%.2f", memoryAfter)},")
            writer.append("${String.format("%.2f", memoryDelta)},$cpuCores,$deviceModel,$success\n")
        }
    }
    
    private fun generateOptimizationRecommendations(
        cpuCores: Int,
        totalMemoryMB: Double,
        freeMemoryMB: Double,
        supportsVulkan: Boolean
    ): List<String> {
        val recommendations = mutableListOf<String>()
        
        // CPU recommendations
        when {
            cpuCores >= 8 -> recommendations.add("Use 4-6 threads for optimal performance on high-end device")
            cpuCores >= 4 -> recommendations.add("Use 2-4 threads for good performance on mid-range device")
            else -> recommendations.add("Use 1-2 threads for basic performance on low-end device")
        }
        
        // Memory recommendations
        when {
            totalMemoryMB >= 8192 -> recommendations.add("Can use large models and high batch sizes")
            totalMemoryMB >= 4096 -> recommendations.add("Use medium-sized models for good balance")
            totalMemoryMB >= 2048 -> recommendations.add("Use lightweight models to avoid memory pressure")
            else -> recommendations.add("Use smallest available models and minimal batch sizes")
        }
        
        // GPU recommendations
        if (supportsVulkan) {
            recommendations.add("Consider GPU acceleration for compute-intensive operations")
        } else {
            recommendations.add("Stick to CPU inference for best compatibility")
        }
        
        // Memory pressure recommendations
        val memoryUsagePercent = ((totalMemoryMB - freeMemoryMB) / totalMemoryMB) * 100
        when {
            memoryUsagePercent > 80 -> recommendations.add("High memory pressure - use minimal configurations")
            memoryUsagePercent > 60 -> recommendations.add("Moderate memory pressure - consider lighter models")
            else -> recommendations.add("Low memory pressure - can use standard configurations")
        }
        
        return recommendations
    }
    
    private fun calculateStandardDeviation(values: List<Long>): Double {
        val mean = values.average()
        val variance = values.sumOf { (it - mean) * (it - mean) } / values.size
        return kotlin.math.sqrt(variance)
    }
    
    private fun calculateTrend(dataPoints: List<Pair<Long, Double>>): Double {
        if (dataPoints.size < 2) return 0.0
        
        val n = dataPoints.size
        val sumX = dataPoints.sumOf { it.first.toDouble() }
        val sumY = dataPoints.sumOf { it.second }
        val sumXY = dataPoints.sumOf { it.first * it.second }
        val sumX2 = dataPoints.sumOf { it.first.toDouble() * it.first }
        
        // Linear regression slope
        return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) / 1000.0 // Convert to per-second
    }
    
    // Data classes
    
    data class SystemInfoSnapshot(
        val tag: String,
        val timestamp: Long,
        val memoryInfo: MemoryInfoSnapshot,
        val cpuCores: Int,
        val deviceModel: String,
        val architectureType: String
    )
    
    data class MemoryInfoSnapshot(
        val usedMemoryMB: Double,
        val freeMemoryMB: Double,
        val totalMemoryMB: Double,
        val maxMemoryMB: Double
    )
    
    data class MemoryDelta(
        val before: Double,
        val after: Double,
        val delta: Double
    )
}
