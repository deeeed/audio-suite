package net.siteed.sherpaonnx

import android.os.Bundle
import androidx.test.runner.AndroidJUnitRunner
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

class SherpaTestRunner : AndroidJUnitRunner() {
    override fun onCreate(arguments: Bundle?) {
        SoLoader.init(targetContext, OpenSourceMergedSoMapping)
        super.onCreate(arguments)
    }
}
