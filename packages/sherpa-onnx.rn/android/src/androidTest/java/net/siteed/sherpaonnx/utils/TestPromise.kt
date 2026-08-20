package net.siteed.sherpaonnx.utils

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap

/**
 * Test doubles for the React Native bridge types used by the instrumented tests.
 *
 * These previously lived in the test source set but were lost, which left the whole
 * androidTest source set uncompilable. Restored here rather than reworked, so existing
 * call sites keep working unchanged.
 */

/**
 * Builds a [Promise] that forwards to the supplied callbacks.
 *
 * [Promise] declares several `reject` overloads; tests only care about the two terminal
 * outcomes, so every overload funnels into [onResolve] / [onReject].
 */
fun createPromise(
    onResolve: (Any?) -> Unit,
    onReject: (String?, String?, Throwable?) -> Unit,
): Promise = object : Promise {
    override fun resolve(value: Any?) = onResolve(value)

    override fun reject(code: String?, message: String?) = onReject(code, message, null)

    override fun reject(code: String?, throwable: Throwable?) =
        onReject(code, throwable?.message, throwable)

    override fun reject(code: String?, message: String?, throwable: Throwable?) =
        onReject(code, message, throwable)

    override fun reject(code: String?, userInfo: WritableMap) = onReject(code, null, null)

    override fun reject(code: String?, throwable: Throwable?, userInfo: WritableMap) =
        onReject(code, throwable?.message, throwable)

    override fun reject(code: String?, message: String?, userInfo: WritableMap) =
        onReject(code, message, null)

    override fun reject(
        code: String?,
        message: String?,
        throwable: Throwable?,
        userInfo: WritableMap?,
    ) = onReject(code, message, throwable)

    override fun reject(throwable: Throwable) = onReject(null, throwable.message, throwable)

    override fun reject(throwable: Throwable, userInfo: WritableMap) =
        onReject(null, throwable.message, throwable)

    @Deprecated("Prefer reject(code, message)")
    override fun reject(message: String) = onReject(null, message, null)
}

/**
 * Builds a [ReactApplicationContext] for instrumented tests.
 *
 * The class is abstract in current React Native, so tests can no longer construct it
 * directly. Subclassing with no overrides preserves the previous behavior: a context
 * backed by the instrumentation target context, with no running React instance.
 */
fun createTestReactContext(context: android.content.Context): ReactApplicationContext =
    object : ReactApplicationContext(context) {
        // The instrumented tests only exercise plain Context behavior — the module under
        // test reaches for getSystemService() and packageManager, both inherited. Nothing
        // touches the React instance, so these throw rather than pretending to work: a
        // silent null here would surface as a confusing failure far from the cause.
        private fun noInstance(name: String): Nothing =
            throw UnsupportedOperationException(
                "$name is not available in tests: createTestReactContext() has no React instance."
            )

        override fun <T : com.facebook.react.bridge.JavaScriptModule> getJSModule(
            jsInterface: Class<T>
        ): T = noInstance("getJSModule")

        override fun <T : com.facebook.react.bridge.NativeModule> hasNativeModule(
            nativeModuleInterface: Class<T>
        ): Boolean = false

        override fun getNativeModules(): MutableCollection<com.facebook.react.bridge.NativeModule> =
            mutableListOf()

        override fun <T : com.facebook.react.bridge.NativeModule> getNativeModule(
            nativeModuleInterface: Class<T>
        ): T? = null

        override fun getNativeModule(name: String): com.facebook.react.bridge.NativeModule? = null

        override fun getCatalystInstance(): com.facebook.react.bridge.CatalystInstance =
            noInstance("getCatalystInstance")

        @Deprecated("Deprecated in React Native")
        override fun hasActiveCatalystInstance(): Boolean = false

        override fun hasActiveReactInstance(): Boolean = false

        @Deprecated("Deprecated in React Native")
        override fun hasCatalystInstance(): Boolean = false

        override fun hasReactInstance(): Boolean = false

        override fun destroy() = Unit

        override fun handleException(e: Exception) = throw e

        override fun isBridgeless(): Boolean = true

        override fun getJavaScriptContextHolder():
            com.facebook.react.bridge.JavaScriptContextHolder? = null

        override fun getJSCallInvokerHolder():
            com.facebook.react.turbomodule.core.interfaces.CallInvokerHolder? = null

        override fun getFabricUIManager(): com.facebook.react.bridge.UIManager? = null

        override fun getSourceURL(): String? = null

        override fun registerSegment(
            segmentId: Int,
            path: String,
            callback: com.facebook.react.bridge.Callback,
        ) = Unit

        // The inherited implementation dispatches through a UI message queue that only
        // exists once a React instance has initialized it, so it throws here. Every
        // handler resolves its Promise through this call, which means without the
        // override the tests compile and then fail on the first completion. Route
        // straight to the main looper instead — same thread, no React instance needed.
        override fun runOnUiQueueThread(runnable: Runnable) {
            com.facebook.react.bridge.UiThreadUtil.runOnUiThread(runnable)
        }
    }
