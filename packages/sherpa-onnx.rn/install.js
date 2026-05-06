#!/usr/bin/env node

/**
 * Sherpa-onnx installation script
 *
 * Downloads precompiled Sherpa ONNX binaries when they are not already present.
 * CI/EAS installs fail fast if the matching release asset is missing or
 * incomplete so CocoaPods does not fail later with opaque missing-library errors.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const { existsSync, mkdirSync } = require('fs');
const { execSync } = require('child_process');
const ProgressBar = require('progress');
const {
  formatValidationReport,
  releaseAssetUrl,
  validatePrebuiltTree,
} = require('./scripts/sherpa-prebuilt-contract');

// Configuration
const BINARY_VERSION = require('./package.json').sherpaOnnxVersion; // Matches the bundled sherpa-onnx upstream version

// URLs for precompiled binaries
const RELEASE_URL = releaseAssetUrl(BINARY_VERSION);

// Directories
const SCRIPT_DIR = __dirname;
const PREBUILT_DIR = path.join(SCRIPT_DIR, 'prebuilt');
const ALLOW_MISSING_ENV = 'SITEED_SHERPA_ONNX_ALLOW_MISSING_PREBUILTS';

/**
 * Creates a directory if it doesn't exist
 */
function ensureDirExists(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

function isDisabled(value) {
  return /^(0|false|no|off)$/i.test(String(value || ''));
}

function isSetAndEnabled(value) {
  return value !== undefined && String(value).trim() !== '' && !isDisabled(value);
}

function isReleaseInstallContext() {
  const ciEnabled = isSetAndEnabled(process.env.CI);
  const easDetected = ['EAS_BUILD', 'EAS_BUILD_ID', 'EAS_BUILD_PLATFORM'].some((name) =>
    isSetAndEnabled(process.env[name])
  );
  return ciEnabled || easDetected;
}

function logExpectedPrebuilts() {
  console.log(`Sherpa ONNX version: ${BINARY_VERSION}`);
  console.log(`Expected prebuilt asset: ${RELEASE_URL}`);
}

function validateExistingPrebuilts() {
  return validatePrebuiltTree(SCRIPT_DIR);
}

function failOrWarn(message, resultOrError) {
  console.error(message);

  if (resultOrError?.missing) {
    console.error(
      formatValidationReport(resultOrError, {
        rootDir: SCRIPT_DIR,
        assetUrl: RELEASE_URL,
      })
    );
  } else if (resultOrError) {
    console.error(resultOrError.stack || resultOrError.message || resultOrError);
  }

  console.error('Manual local fallback:');
  console.error('  ./setup.sh && ./build-sherpa-ios.sh && ./build-sherpa-android.sh');
  console.error(`Developer-only escape hatch: ${ALLOW_MISSING_ENV}=1`);

  if (isReleaseInstallContext() && !isTruthy(process.env[ALLOW_MISSING_ENV])) {
    process.exit(1);
  }

  console.warn(
    'Continuing because CI/EAS release mode was not detected. Native builds may fail until prebuilts are built manually.'
  );
}

/**
 * Downloads a file from a URL
 */
async function downloadFile(url, destPath) {
  console.log(`Downloading from ${url}...`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download prebuilt asset: HTTP ${response.status} ${response.statusText}`);
  }

  const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
  const bar = totalSize
    ? new ProgressBar('[:bar] :percent :etas', {
        complete: '=',
        incomplete: ' ',
        width: 50,
        total: totalSize,
      })
    : null;

  const fileStream = fs.createWriteStream(destPath);

  return new Promise((resolve, reject) => {
    response.body.on('data', (chunk) => {
      if (bar) bar.tick(chunk.length);
    });

    response.body.on('error', reject);
    response.body.pipe(fileStream);

    fileStream.on('finish', () => {
      fileStream.close();
      console.log('Download completed!');
      resolve();
    });

    fileStream.on('error', (err) => {
      try {
        fs.unlinkSync(destPath);
      } catch (_error) {
        // Ignore cleanup failures.
      }
      reject(err);
    });
  });
}

/**
 * Extracts a zip file
 */
function extractZip(zipPath, destDir) {
  console.log(`Extracting ${zipPath} to ${destDir}...`);
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
  console.log('Extraction completed!');
}

function runLocalAndroidRebuild() {
  console.log('SITEED_SHERPA_ONNX_REBUILD_ANDROID=1, rebuilding Android prebuilts locally.');
  execSync('./setup.sh && ./build-sherpa-android.sh', {
    cwd: SCRIPT_DIR,
    stdio: 'inherit',
    env: process.env,
  });
}

// Compatibility shim for older prebuilt archives that used the upstream
// ONNX Runtime include path instead of the flattened packaged include path.
function fixModulemapIfNeeded() {
  const modulemapPath = path.join(PREBUILT_DIR, 'include', 'module.modulemap');
  if (!existsSync(modulemapPath)) return;

  let content = fs.readFileSync(modulemapPath, 'utf8');
  if (content.includes('onnxruntime/core/session/onnxruntime_c_api.h')) {
    content = content.replace(
      'onnxruntime/core/session/onnxruntime_c_api.h',
      'onnxruntime/onnxruntime_c_api.h'
    );
    fs.writeFileSync(modulemapPath, content, 'utf8');
    console.log('Fixed module.modulemap onnxruntime header path.');
  }
}

/**
 * Main installation function
 */
async function install() {
  console.log('Starting Sherpa-onnx installation...');
  logExpectedPrebuilts();

  ensureDirExists(PREBUILT_DIR);

  if (process.env.SITEED_SHERPA_ONNX_REBUILD_ANDROID === '1') {
    runLocalAndroidRebuild();
    return;
  }

  const existingPrebuilts = validateExistingPrebuilts();
  if (existingPrebuilts.ok) {
    console.log('All required prebuilt libraries already exist, skipping download.');
    return;
  }

  // Allow explicit local opt-out for developers who build manually.
  if (process.env.SKIP_SHERPA_DOWNLOAD === '1') {
    failOrWarn('SKIP_SHERPA_DOWNLOAD=1 but required prebuilts are incomplete.', existingPrebuilts);
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-onnx-install-'));
  const downloadPath = path.join(tempDir, `sherpa-onnx-binaries-${BINARY_VERSION}.zip`);

  try {
    await downloadFile(RELEASE_URL, downloadPath);
    extractZip(downloadPath, SCRIPT_DIR);
    fixModulemapIfNeeded();

    const extractedPrebuilts = validateExistingPrebuilts();
    if (!extractedPrebuilts.ok) {
      throw new Error(
        formatValidationReport(extractedPrebuilts, {
          rootDir: SCRIPT_DIR,
          assetUrl: RELEASE_URL,
        })
      );
    }

    console.log('Sherpa-onnx installation completed successfully!');
  } catch (error) {
    failOrWarn('Installation failed — could not install complete prebuilt binaries.', error);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

install().catch((error) => {
  failOrWarn('Installation failed unexpectedly.', error);
});
