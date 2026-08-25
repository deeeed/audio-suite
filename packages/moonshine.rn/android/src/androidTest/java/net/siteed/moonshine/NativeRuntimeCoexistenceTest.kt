package net.siteed.moonshine

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeRuntimeCoexistenceTest {
  @Test
  fun loadsSherpaAndMoonshineWithTheirOwnOnnxRuntimes() {
    System.loadLibrary("onnxruntime")
    System.loadLibrary("sherpa-onnx-jni")
    System.loadLibrary("moonshine_onnxruntime")
    System.loadLibrary("moonshine")
    System.loadLibrary("moonshine-jni")
  }
}
