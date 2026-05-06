const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ANDROID_ABIS,
  ANDROID_LIBRARIES,
  IOS_LIBRARIES,
  IOS_PLATFORMS,
  createCurrentIosSymlinks,
  releaseAssetUrl,
  validatePrebuiltTree,
} = require('../../scripts/sherpa-prebuilt-contract');

function writeFile(rootDir, relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, 'test');
}

function createCompletePrebuiltTree(rootDir) {
  writeFile(rootDir, 'prebuilt/include/module.modulemap');
  writeFile(rootDir, 'prebuilt/include/sherpa-onnx/c-api/c-api.h');
  writeFile(rootDir, 'prebuilt/include/onnxruntime/onnxruntime_c_api.h');

  for (const platform of IOS_PLATFORMS) {
    for (const library of IOS_LIBRARIES) {
      writeFile(rootDir, path.join('prebuilt/ios', platform, library));
    }
  }

  for (const abi of ANDROID_ABIS) {
    for (const library of ANDROID_LIBRARIES) {
      writeFile(rootDir, path.join('prebuilt/android', abi, library));
    }
  }
}

describe('sherpa prebuilt contract', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-contract-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('builds the expected release asset URL', () => {
    expect(releaseAssetUrl('1.13.0')).toBe(
      'https://github.com/deeeed/audiolab/releases/download/sherpa-onnx-prebuilt-v1.13.0/sherpa-onnx-binaries-1.13.0.zip'
    );
  });

  it('reports missing native prebuilts', () => {
    const result = validatePrebuiltTree(tempDir);

    expect(result.ok).toBe(false);
    expect(result.missing).toContain('prebuilt/ios/device/libsherpa-onnx-core.a');
    expect(result.missing).toContain('prebuilt/ios/simulator/libsherpa-onnx-core.a');
    expect(result.missing).toContain('prebuilt/android/arm64-v8a/libsherpa-onnx-jni.so');
    expect(result.missing).toContain('prebuilt/include/module.modulemap');
  });

  it('validates a complete prebuilt tree and creates podspec current symlinks', () => {
    createCompletePrebuiltTree(tempDir);

    expect(validatePrebuiltTree(tempDir).ok).toBe(true);

    createCurrentIosSymlinks(tempDir);

    const result = validatePrebuiltTree(tempDir, { includeIosCurrent: true });
    expect(result.ok).toBe(true);
    expect(
      fs.readlinkSync(path.join(tempDir, 'prebuilt/ios/current/libonnxruntime.a'))
    ).toBe('../device/libonnxruntime.a');
  });
});
