# Android ONNX Runtime Coexistence

This note is the shared Android troubleshooting reference for apps that use more
than one native ONNX Runtime consumer, especially `@siteed/moonshine.rn` together
with `@siteed/sherpa-onnx.rn`.

## Why this matters

Android packages native libraries by ABI. At runtime there is only one
`libonnxruntime.so` loaded for a given ABI and SONAME, even if multiple React
Native packages contributed their own copy during the Gradle build.

`packagingOptions.pickFirst` or `android.packagingOptions.pickFirsts` can resolve
a duplicate-file build error, but it only chooses one file. It does **not** prove
that every native library in the app can bind to the selected ONNX Runtime
binary.

The failure mode can look like a missing library even when the APK/AAB contains
all expected files:

```text
Exception in HostFunction failed to load moonshine-jni library
java.lang.UnsatisfiedLinkError: dlopen failed: cannot locate symbol ...
```

When this happens, check symbol compatibility, not just file presence.

## Native libraries involved

`@siteed/moonshine.rn` contributes, through its Android AAR or Maven dependency:

- `libmoonshine-jni.so`
- `libmoonshine.so`
- `libonnxruntime.so`

`@siteed/sherpa-onnx.rn` contributes:

- `libsherpa-onnx-jni.so`
- `libonnxruntime.so`

A consumer app that installs both packages must ensure the selected
`libonnxruntime.so` satisfies every native library that imports
`OrtGetApiBase`.

## Inspecting a built app or intermediate

Find the libraries in an APK/AAB extraction or Gradle intermediate:

```bash
find . -path '*libmoonshine*.so' -o -path '*libsherpa*.so' -o -path '*libonnxruntime.so'
```

Inspect Moonshine:

```bash
llvm-readelf -Ws path/to/libmoonshine.so | rg 'OrtGetApiBase'
llvm-readelf -d path/to/libmoonshine.so | rg 'NEEDED|SONAME'
llvm-readelf -d path/to/libmoonshine-jni.so | rg 'NEEDED|SONAME'
```

Inspect Sherpa and the ONNX Runtime that the app packages:

```bash
llvm-readelf -Ws path/to/libsherpa-onnx-jni.so | rg 'OrtGetApiBase'
llvm-readelf -Ws path/to/libonnxruntime.so | rg 'OrtGetApiBase'
```

Interpretation:

```text
SAFE for Moonshine:  UND OrtGetApiBase
RISKY for Moonshine: UND OrtGetApiBase@VERS_<version>
```

A versioned import such as `OrtGetApiBase@VERS_1.23.0` must be paired with a
packaged `libonnxruntime.so` that exports that same symbol version. If the app
packages an ONNX Runtime exporting only `OrtGetApiBase@@VERS_1.24.3`, a
`VERS_1.23.0` Moonshine import is risky even though all `.so` files are present.

An unversioned Moonshine import (`UND OrtGetApiBase`) is the most tolerant form
and can bind to the selected ONNX Runtime default export. Sherpa's JNI library is
normally versioned, so its imported version should match the selected Sherpa
`libonnxruntime.so` export.

## Current package guidance

For `@siteed/sherpa-onnx.rn@1.3.0`, Android prebuilts use ONNX Runtime
`VERS_1.24.3`:

```text
libsherpa-onnx-jni.so: UND OrtGetApiBase@VERS_1.24.3
libonnxruntime.so:    OrtGetApiBase@@VERS_1.24.3
```

For `@siteed/moonshine.rn@0.3.3`, published Android consumers resolve
`ai.moonshine:moonshine-voice:0.0.59` from Maven by default. That Maven AAR has
been observed with:

```text
libmoonshine.so: UND OrtGetApiBase@VERS_1.23.0
```

That default Maven artifact is therefore risky in an app that also packages
Sherpa's ONNX Runtime `VERS_1.24.3`. Use one of the mitigation paths below when
shipping both packages together.

The audiolab playground monorepo release intermediates were also checked with a
repo-local source Moonshine AAR whose `libmoonshine.so` imports unversioned
`OrtGetApiBase`; that path is safe with the Sherpa `VERS_1.24.3` ONNX Runtime.
Do not assume a client app has that source AAR unless it explicitly configures
one.

## Mitigation paths for consumer apps

Pick one path and verify the final APK/AAB output:

1. **Use a Moonshine artifact with an unversioned `OrtGetApiBase` import.**
   Point `@siteed/moonshine.rn` at the artifact with
   `SITEED_MOONSHINE_ANDROID_AAR` / `siteedMoonshineAndroidAar`, or publish it to
   an internal Maven repo and set `SITEED_MOONSHINE_ANDROID_MAVEN_REPO` plus
   `SITEED_MOONSHINE_ANDROID_MAVEN_COORD`.
2. **Align Sherpa to the Moonshine artifact's ONNX Runtime version.** Rebuild
   Sherpa with `SITEED_SHERPA_ONNX_ORT_VERSION` or
   `SITEED_SHERPA_ONNX_ORT_ROOT`, then verify Sherpa's JNI import and packaged
   ONNX Runtime export match the Moonshine requirement.
3. **Patch the Moonshine native library after Gradle merges native libs.** If you
   own the app build and cannot replace the artifact, use a deterministic
   Node-based ELF patch that clears the Moonshine `OrtGetApiBase@VERS_...` import
   after `mergeNativeLibs` and again after `stripDebugSymbols`. Do not rely on
   `patchelf` being available in EAS/CI images.

For Expo apps, a packaging rule is still required when both packages contribute
`libonnxruntime.so`:

```json
{
  "expo": {
    "plugins": ["@siteed/sherpa-onnx.rn"]
  }
}
```

or in Android Gradle configuration:

```properties
android.packagingOptions.pickFirsts=**/libonnxruntime.so
```

That packaging rule is only the duplicate-file resolution step. Run the symbol
checks above after building because `pickFirst` does not validate ABI or symbol
compatibility.

## Repository checker

Inside this monorepo, run:

```bash
yarn android:ort:check
```

The checker inspects the arm64-v8a Sherpa JNI import, Sherpa packaged ONNX
Runtime export, and Moonshine `libmoonshine.so` import. By default it mirrors the
Moonshine Gradle wrapper: a repo-local source AAR is used when present, otherwise
the public Maven coordinate is used.

Use environment overrides when checking a client-specific Moonshine artifact:

```bash
SITEED_MOONSHINE_ANDROID_AAR=/absolute/path/to/moonshine.aar \
yarn android:ort:check
```

To check the public Maven path that npm consumers get by default, run:

```bash
SITEED_MOONSHINE_ANDROID_USE_MAVEN=1 yarn android:ort:check
```

The checker treats an unversioned Moonshine import as compatible, and treats a
versioned Moonshine import as compatible only when it matches the selected ONNX
Runtime export.
