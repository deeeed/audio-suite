package net.siteed.sherpaonnx

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import net.siteed.sherpaonnx.utils.createTestReactContext
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Contract test for the test double itself.
 *
 * Every handler resolves its Promise through reactContext.runOnUiQueueThread. The
 * inherited implementation dispatches via a UI message queue that only exists once a
 * React instance has initialized it, so without an override the instrumented tests
 * compile and then fail on their first completion. This asserts the dispatch actually
 * runs rather than trusting that it compiles.
 */
@RunWith(AndroidJUnit4::class)
class TestReactContextDispatchTest {

    @Test
    fun runOnUiQueueThreadActuallyDispatches() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val reactContext = createTestReactContext(context)

        val latch = CountDownLatch(1)
        reactContext.runOnUiQueueThread { latch.countDown() }

        assertTrue(
            "runOnUiQueueThread never ran its callback; every Promise resolution in the " +
                "handlers goes through this, so the instrumented suite would fail on first use.",
            latch.await(5, TimeUnit.SECONDS)
        )
    }
}
