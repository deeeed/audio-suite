#!/usr/bin/env node
/**
 * Run the physical-iOS 60-minute diarization validation once a signed
 * SherpaVoiceDev dev client is installed and reachable via Metro/CDP.
 *
 * Preconditions:
 *   1. iPhone has a trusted/signed `net.siteed.sherpavoice.development` build.
 *   2. Metro is running on port 7500.
 *   3. App is launched with the dev-client URL and appears in `yarn status`.
 *
 * This script serves the 60m WAV fixture from the workstation, downloads it
 * into the app sandbox via `__AGENTIC__.downloadValidationFileFromUrl`, ensures
 * the two required models are downloaded, runs the windowed + global speaker
 * re-ID benchmark, writes the raw artifact locally, scores it with
 * `scripts/diarization-score-pyannote.py`, and updates
 * `native-long-window-validation-summary.json`.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(appRoot, '../..');
const cdpBridge = path.join(appRoot, 'scripts/agentic/cdp-bridge.mjs');
const fixturePath = path.join(
  repoRoot,
  '.agent/fixtures/diarization/perps_controller_refactor_60m_16k_mono.wav'
);
const outputPath = path.join(
  repoRoot,
  '.agent/validation-logs/diarization/perps-60m-ios-physical-iphone12-windowed-global-reid-native-eres2net-fullseg.json'
);
const scorePath = path.join(
  repoRoot,
  '.agent/validation-logs/diarization/perps-60m-ios-physical-iphone12-windowed-global-reid-native-eres2net-fullseg-pyannote-score.json'
);
const summaryPath = path.join(
  repoRoot,
  '.agent/validation-logs/diarization/native-long-window-validation-summary.json'
);
const referencePath = path.join(
  repoRoot,
  '.agent/validation-logs/diarization/echobridge-reference/perps-60m-echobridge-num2.segments.json'
);
const scorerPath = path.join(appRoot, 'scripts/diarization-score-pyannote.py');
const pythonBin =
  process.env.PYANNOTE_PYTHON ||
  (fs.existsSync('/opt/homebrew/Caskroom/miniconda/base/envs/echobridge/bin/python')
    ? '/opt/homebrew/Caskroom/miniconda/base/envs/echobridge/bin/python'
    : 'python3');
const deviceFilter = process.env.IOS_AGENTIC_DEVICE || 'iPhone';
const port = Number.parseInt(process.env.VALIDATION_FILE_SERVER_PORT || '8765', 10);
const host = process.env.AGENTIC_DEV_HOST || firstLanIPv4();
const pollMs = Number.parseInt(process.env.DIARIZATION_POLL_MS || '30000', 10);
const maxMs = Number.parseInt(process.env.DIARIZATION_MAX_MS || String(90 * 60 * 1000), 10);
const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

if (!fs.existsSync(fixturePath)) {
  throw new Error(`Missing fixture: ${fixturePath}`);
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

function firstLanIPv4() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        return entry.address;
      }
    }
  }
  return '127.0.0.1';
}

function cdp(command, expression, extraEnv = {}) {
  const args = ['--device', deviceFilter, command];
  if (expression) args.push(expression);
  const result = spawnSync(process.execPath, [cdpBridge, ...args], {
    cwd: appRoot,
    env: {
      ...process.env,
      WATCHER_PORT: process.env.WATCHER_PORT || '7500',
      CDP_TIMEOUT: process.env.CDP_TIMEOUT || '10000',
      EVAL_TIMEOUT: process.env.EVAL_TIMEOUT || '30000',
      ...extraEnv,
    },
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `cdp ${command} failed (${result.status})\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  }
  return JSON.parse(result.stdout);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function rel(pathname) {
  return path.relative(repoRoot, pathname).replaceAll(path.sep, '/');
}

function runPyannoteScorer() {
  const hasPython = pythonBin === 'python3' || fs.existsSync(pythonBin);
  if (!hasPython || !fs.existsSync(referencePath) || !fs.existsSync(scorerPath)) {
    process.stderr.write(
      `scoring skipped: python=${hasPython} reference=${fs.existsSync(referencePath)} scorer=${fs.existsSync(scorerPath)}\n`
    );
    return null;
  }
  const result = spawnSync(
    pythonBin,
    [scorerPath, '--reference', referencePath, '--hypothesis', outputPath, '--out', scorePath],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `pyannote scoring failed (${result.status})\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  }
  return JSON.parse(fs.readFileSync(scorePath, 'utf8'));
}

function updateNativeSummary(result, scoreDoc) {
  if (!fs.existsSync(summaryPath) || !scoreDoc?.results?.[0]?.score) {
    return;
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const score = scoreDoc.results[0].score;
  const row = {
    label: 'ios-physical-iphone12-60m-windowed-global-reid-eres2net-fullseg',
    platform: 'iPhone 12 physical',
    durationMs: result.durationMs,
    runtimeSeconds: Math.round((result.durationMs / 1000) * 10) / 10,
    globalReidEmbeddingMs: result.globalSpeakerReidTiming?.embeddingMs,
    globalReidEmbeddedSegments: result.globalSpeakerReid?.embeddedSegmentCount,
    numSpeakers: result.numSpeakers,
    segmentCount: result.segmentCount,
    windowCount: result.windows?.length,
    windowDurationMs: result.windowDurationMs,
    derPercent: score.diarizationErrorRatePercent,
    jerPercent: score.jaccardErrorRatePercent,
    artifact: rel(outputPath),
    scoreArtifact: rel(scorePath),
  };
  summary.updatedAt = new Date().toISOString().slice(0, 10);
  summary.results = Array.isArray(summary.results) ? summary.results : [];
  summary.results = summary.results.filter((item) => item.label !== row.label);
  summary.results.push(row);
  if (Array.isArray(summary.blockedValidation)) {
    summary.blockedValidation = summary.blockedValidation.filter(
      (item) => item.platform !== 'iOS physical iPhone 12'
    );
  }
  summary.conclusion =
    `Windowed native diarization plus global speaker re-identification is validated on Android Pixel 6a physical and iPhone 12 physical. ` +
    `Latest physical iOS 60m reached ${row.derPercent.toFixed(2)}% DER / ${row.jerPercent.toFixed(2)}% JER.`;
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
}

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    if (!req.url || !req.url.includes('perps_controller_refactor_60m_16k_mono.wav')) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': 'audio/wav',
      'content-length': String(fs.statSync(fixturePath).size),
    });
    fs.createReadStream(fixturePath).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

async function waitForLastResult(op, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = cdp('eval', 'globalThis.__AGENTIC__.getLastResult()');
    if (last?.op === op && last.status && last.status !== 'pending') {
      if (last.status !== 'success') {
        throw new Error(`${op} failed: ${JSON.stringify(last, null, 2)}`);
      }
      return last.result;
    }
    process.stderr.write(`[${new Date().toISOString()}] ${op}: ${last?.status || 'waiting'}\n`);
    await sleep(pollMs);
  }
  throw new Error(`${op} timed out; last=${JSON.stringify(last, null, 2)}`);
}

async function ensureModel(modelId) {
  const state = cdp('eval', `globalThis.__AGENTIC__.getState().models?.statuses?.[${JSON.stringify(modelId)}] || null`);
  if (state?.localPath) {
    process.stderr.write(`model already downloaded: ${modelId}\n`);
    return;
  }
  process.stderr.write(`requesting model download: ${modelId}\n`);
  cdp('eval', `globalThis.__AGENTIC__.downloadModel(${JSON.stringify(modelId)})`);
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(10000);
    const current = cdp('eval', `globalThis.__AGENTIC__.getState().models?.statuses?.[${JSON.stringify(modelId)}] || null`);
    if (current?.localPath) {
      process.stderr.write(`model downloaded: ${modelId}\n`);
      return;
    }
    process.stderr.write(`[${new Date().toISOString()}] waiting for model ${modelId}: ${JSON.stringify(current)}\n`);
  }
  throw new Error(`Timed out waiting for model ${modelId}`);
}

async function main() {
  if (dryRun) {
    const report = {
      mode: 'dry-run',
      appRoot,
      repoRoot,
      cdpBridge,
      fixturePath,
      outputPath,
      scorePath,
      summaryPath,
      referencePath,
      scorerPath,
      pythonBin,
      checks: {
        cdpBridge: fs.existsSync(cdpBridge),
        fixture: fs.existsSync(fixturePath),
        outputDir: fs.existsSync(path.dirname(outputPath)),
        summary: fs.existsSync(summaryPath),
        reference: fs.existsSync(referencePath),
        scorer: fs.existsSync(scorerPath),
        python: pythonBin === 'python3' || fs.existsSync(pythonBin),
      },
      nextCommandAfterSignedInstall:
        'cd apps/sherpa-voice && yarn diarization:ios:physical',
    };
    console.log(JSON.stringify(report, null, 2));
    const failed = Object.entries(report.checks).filter(([, ok]) => !ok);
    if (failed.length) {
      process.exit(1);
    }
    return;
  }

  const server = await startFixtureServer();
  try {
    process.stderr.write(`fixture server: http://${host}:${port}/perps_controller_refactor_60m_16k_mono.wav\n`);
    process.stderr.write(`target device filter: ${deviceFilter}\n`);

    const route = cdp('get-route');
    process.stderr.write(`agentic route: ${JSON.stringify(route)}\n`);

    const downloadUrl = `http://${host}:${port}/perps_controller_refactor_60m_16k_mono.wav`;
    cdp('eval', `globalThis.__AGENTIC__.downloadValidationFileFromUrl(${JSON.stringify(downloadUrl)}, 'perps_controller_refactor_60m_16k_mono.wav')`);
    const downloaded = await waitForLastResult('downloadValidationFileFromUrl', 30 * 60 * 1000);
    const audioUri = downloaded.uri;
    process.stderr.write(`fixture ready: ${audioUri} (${downloaded.size} bytes)\n`);

    await ensureModel('pyannote-segmentation-3-0');
    await ensureModel('speaker-id-3dspeaker-eres2net-en');

    const benchCase = {
      label: 'ios-physical-iphone12-60m-windowed-global-reid-eres2net-fullseg',
      segmentationModelFile: 'model.onnx',
      embeddingModelId: 'speaker-id-3dspeaker-eres2net-en',
      numClusters: 2,
      threshold: 0.5,
      numThreads: 2,
    };
    const options = {
      totalDurationMs: 60 * 60 * 1000,
      windowDurationMs: 5 * 60 * 1000,
      globalSpeakerReid: true,
    };

    cdp('eval', `globalThis.__AGENTIC__.benchmarkNativeDiarizationWindowedFile(${JSON.stringify(audioUri)}, ${JSON.stringify(benchCase)}, ${JSON.stringify(options)})`);
    const result = await waitForLastResult('benchmarkNativeDiarizationWindowedFile', maxMs);
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    const scoreDoc = runPyannoteScorer();
    updateNativeSummary(result, scoreDoc);
    console.log(JSON.stringify({
      outputPath,
      scorePath: scoreDoc ? scorePath : null,
      summaryPath: scoreDoc ? summaryPath : null,
      summary: {
        durationMs: result.durationMs,
        segmentCount: result.segmentCount,
        numSpeakers: result.numSpeakers,
        globalSpeakerReidTiming: result.globalSpeakerReidTiming,
        derPercent: scoreDoc?.results?.[0]?.score?.diarizationErrorRatePercent,
        jerPercent: scoreDoc?.results?.[0]?.score?.jaccardErrorRatePercent,
      },
    }, null, 2));
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
