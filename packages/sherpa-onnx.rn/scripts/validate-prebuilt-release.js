#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const {
  createCurrentIosSymlinks,
  releaseAssetUrl,
  validateOrThrow,
} = require('./sherpa-prebuilt-contract');

const packageRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(packageRoot, 'package.json'));

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    version: packageJson.sherpaOnnxVersion,
    keepTemp: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--version') {
      options.version = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--url') {
      options.url = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--keep-temp') {
      options.keepTemp = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function assertAssetExists(url) {
  const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Release asset HEAD check failed: HTTP ${response.status} ${response.statusText}\n${url}`);
  }
  console.log(`Release asset exists: HTTP ${response.status}`);
}

async function download(url, destination) {
  console.log(`Downloading release asset: ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Release asset download failed: HTTP ${response.status} ${response.statusText}\n${url}`);
  }

  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    response.body.pipe(file);
    response.body.on('error', reject);
    file.on('finish', resolve);
    file.on('error', reject);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const url = options.url || releaseAssetUrl(options.version);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-prebuilt-preflight-'));
  const archivePath = path.join(tempDir, `sherpa-onnx-binaries-${options.version}.zip`);

  console.log('Sherpa ONNX prebuilt release preflight');
  console.log(`Package version: ${packageJson.version}`);
  console.log(`sherpaOnnxVersion: ${options.version}`);
  console.log(`Expected asset URL: ${url}`);
  console.log(`Temp dir: ${tempDir}`);

  try {
    await assertAssetExists(url);
    await download(url, archivePath);

    console.log('Extracting release asset...');
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(tempDir, true);

    validateOrThrow(tempDir, { rootDir: tempDir, assetUrl: url });
    console.log('Archive contains required iOS device/simulator libraries, Android shared libraries, and headers.');

    createCurrentIosSymlinks(tempDir);
    validateOrThrow(tempDir, { includeIosCurrent: true, rootDir: tempDir, assetUrl: url });
    console.log('Podspec prepare_command simulation succeeded: prebuilt/ios/current links all required device libraries.');
    console.log('Preflight passed.');
  } finally {
    if (options.keepTemp) {
      console.log(`Keeping temp dir: ${tempDir}`);
    } else {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
