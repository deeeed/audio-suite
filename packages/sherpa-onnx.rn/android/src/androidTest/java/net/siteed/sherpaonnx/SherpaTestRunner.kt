package net.siteed.sherpaonnx

import android.os.Bundle
import androidx.test.runner.AndroidJUnitRunner
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

class SherpaTestRunner : AndroidJUnitRunner() {
    override fun onCreate(arguments: Bundle?) {
        try {
            SoLoader.init(targetContext, OpenSourceMergedSoMapping)
        } catch (error: Exception) {
            throw IllegalStateException("SoLoader initialization failed for the sherpa test APK", error)
        } catch (error: UnsatisfiedLinkError) {
            throw IllegalStateException("SoLoader initialization failed for the sherpa test APK", error)
        }
        super.onCreate(arguments)
    }
}
