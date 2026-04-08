#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import asrEvalManifest from './asr-eval-manifest.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');
const BRIDGE = path.join(APP_ROOT, 'scripts/agentic/cdp-bridge.mjs');
const REPORT_DIR = path.join(APP_ROOT, '.agent', 'reports');
const DEVICE = process.env.BENCHMARK_DEVICE || process.env.AGENTIC_DEVICE || '';
const SERIAL = process.env.ANDROID_SERIAL || process.env.ADB_SERIAL || '';
const APP_VARIANT = process.env.APP_VARIANT || 'development';
const BUNDLE_BASE = 'net.siteed.audioplayground';
const SCHEME_BASE = 'audioplayground';
const PKG =
  APP_VARIANT === 'production' ? BUNDLE_BASE : `${BUNDLE_BASE}.${APP_VARIANT}`;
const SCHEME =
  APP_VARIANT === 'production' ? SCHEME_BASE : `${SCHEME_BASE}-${APP_VARIANT}`;
const DEV_CLIENT_SCHEME = `exp+${SCHEME_BASE}`;
const ROUTE = '/asr-benchmark';
const OFFLINE_TIMEOUT_MS = 10 * 60 * 1000;
const SIMULATED_TIMEOUT_MS = 10 * 60 * 1000;
const STATE_TIMEOUT_MS = 90 * 1000;
const POLL_INTERVAL_MS = 1000;
const PRESETS = {
  'moonshine-longform': {
    clipIds: [
      'ami-is1001a-150-170',
      'jfk-public-quote',
      'recorder-jre-lex-watch',
      'osr-us-000-0010-8k',
    ],
    modelIds: ['moonshine-small-streaming-en', 'moonshine-medium-streaming-en'],
  },
};

const ALL_MODELS = [
  { id: 'moonshine-small-streaming-en', live: true },
  { id: 'moonshine-medium-streaming-en', live: true },
  { id: 'whisper-small', live: true },
];
const configuredPreset = String(process.env.BENCHMARK_PRESET || '').trim();
const presetConfig = configuredPreset ? PRESETS[configuredPreset] : null;
if (configuredPreset && !presetConfig) {
  throw new Error(
    `Unknown BENCHMARK_PRESET=${configuredPreset}. Available presets: ${Object.keys(PRESETS).join(', ')}`
  );
}
const configuredModelIds = new Set(
  String(
    process.env.BENCHMARK_MODELS ||
      presetConfig?.modelIds?.join(',') ||
      ''
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
const configuredClipIds = new Set(
  String(
    process.env.BENCHMARK_CLIPS ||
      presetConfig?.clipIds?.join(',') ||
      ''
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
const OFFLINE_MODELS =
  configuredModelIds.size > 0
    ? ALL_MODELS.filter((model) => configuredModelIds.has(model.id))
    : ALL_MODELS;
const SIMULATED_MODELS = OFFLINE_MODELS.filter((model) => model.live);
const EVAL_CLIPS =
  configuredClipIds.size > 0
    ? asrEvalManifest.filter((clip) => configuredClipIds.has(clip.id))
    : asrEvalManifest;

fs.mkdirSync(REPORT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMetroHost() {
  if (SERIAL.startsWith('emulator-')) {
    return '10.0.2.2';
  }

  if (process.env.AGENTIC_DEV_HOST) {
    return String(process.env.AGENTIC_DEV_HOST).trim();
  }

  try {
    const output = execSync(
      "ipconfig getifaddr en0 2>/dev/null || ifconfig | awk '/inet / && !/127\\./ && !/169\\.254\\./ {print $2}' | grep -v '^::' | head -1",
      { encoding: 'utf8' }
    ).trim();
    return output || 'localhost';
  } catch {
    return 'localhost';
  }
}

function run(command, args, { cwd = REPO_ROOT, parseJson = false, maxBuffer = 50 * 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      APP_ROOT,
    },
    maxBuffer,
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(output || `${command} ${args.join(' ')} failed`);
  }

  const stdout = (result.stdout || '').trim();
  if (!parseJson) return stdout;
  return stdout ? JSON.parse(stdout) : null;
}

function adb(args) {
  const adbArgs = SERIAL ? ['-s', SERIAL, ...args] : args;
  return run('adb', adbArgs, { parseJson: false });
}

function adbShell(command) {
  return adb(['shell', command]);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function bridge(args, parseJson = true) {
  const bridgeArgs = DEVICE ? ['--device', DEVICE, ...args] : args;
  return run('node', [BRIDGE, ...bridgeArgs], { parseJson });
}

function resolveHostPath(clip) {
  return clip.hostPath ?? path.join(REPO_ROOT, clip.relativeHostPath);
}

function getDeviceClipPath(clip) {
  if (!clip.deviceFileName) {
    throw new Error(
      `Clip ${clip.id} is missing deviceFileName; set it in asr-eval-manifest.mjs before staging benchmark audio.`
    );
  }
  return `/data/user/0/${PKG}/files/benchmarks/${clip.deviceFileName}`;
}

function isNoTargetError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('No debug targets found') ||
    message.includes('No __AGENTIC__ targets found')
  );
}

async function waitForBridgeTarget(timeoutMs = STATE_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const devices = bridge(['list-devices']);
      if ((devices?.count ?? 0) > 0) return;
    } catch {}
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Timed out waiting for CDP target');
}

async function waitForState(predicate, label, timeoutMs = STATE_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const state = bridge(['get-state']);
      if (predicate(state)) return state;
    } catch (error) {
      lastError = error;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `${label} timed out${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ''}`
  );
}

async function ensureDeviceClip(clip) {
  const hostPath = resolveHostPath(clip);
  const devicePath = getDeviceClipPath(clip);

  if (!fs.existsSync(hostPath)) {
    throw new Error(`Missing host clip for ${clip.id} at ${hostPath}`);
  }

  adbShell(
    `run-as ${PKG} sh -c "mkdir -p ${path.posix.dirname(devicePath)} && rm -f ${devicePath}"`
  );
  run('bash', [
    '-lc',
    `cat ${shellQuote(hostPath)} | ${
      SERIAL ? `adb -s ${SERIAL}` : 'adb'
    } shell "run-as ${PKG} sh -c 'cat > ${devicePath}'"`,
  ]);

  const stagedSize = Number(
    adbShell(
      `run-as ${PKG} sh -c "wc -c < ${devicePath} 2>/dev/null || echo 0"`
    ).trim() || '0'
  );
  if (stagedSize <= 0) {
    throw new Error(`Failed to stage ${clip.id} into app sandbox at ${devicePath}`);
  }

  return devicePath;
}

async function restartDevClient() {
  const metroHost = getMetroHost();
  adb(['reverse', 'tcp:7365', 'tcp:7365']);
  adb(['shell', 'am', 'force-stop', PKG]);
  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    `${DEV_CLIENT_SCHEME}://expo-development-client/?url=http://${metroHost}:7365`,
    PKG,
  ]);
  await sleep(5000);
  await waitForBridgeTarget();
}

async function ensureBenchmarkPage() {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await waitForBridgeTarget();
      bridge(['navigate', ROUTE]);
      await waitForState((state) => state?.route === ROUTE, 'benchmark route');
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await restartDevClient();
    }
  }
}

async function recoverIfNoTarget(error) {
  if (isNoTargetError(error) || String(error).includes('lost debug target')) {
    await restartDevClient();
    await ensureBenchmarkPage();
    return true;
  }
  return false;
}

async function callBridgeEval(expression) {
  try {
    return bridge(['eval', expression]);
  } catch (error) {
    const recovered = await recoverIfNoTarget(error);
    if (!recovered) throw error;
    return bridge(['eval', expression]);
  }
}

async function getLastResult() {
  return callBridgeEval('globalThis.__AGENTIC__?.getLastResult?.()');
}

async function waitForAsyncResult(op, timeoutMs, expectedModelId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await getLastResult();
    if (!result || result.op !== op || result.status === 'pending') {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    const resultModelId = result?.result?.modelId ?? null;
    if (expectedModelId && resultModelId && resultModelId !== expectedModelId) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    return result;
  }
  throw new Error(`${op} timed out after ${timeoutMs}ms`);
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

function scoreTranscript(referenceTranscript, text) {
  const refNorm = normalizeText(referenceTranscript);
  const hypNorm = normalizeText(text);
  const refWords = refNorm ? refNorm.split(' ') : [];
  const hypWords = hypNorm ? hypNorm.split(' ') : [];
  const refChars = refNorm.split('');
  const hypChars = hypNorm.split('');

  return {
    wer: refWords.length ? levenshtein(refWords, hypWords) / refWords.length : null,
    cer: refChars.length ? levenshtein(refChars, hypChars) / refChars.length : null,
  };
}

function compareQualityResults(a, b) {
  if (a.error && !b.error) return 1;
  if (!a.error && b.error) return -1;
  const aWer = a.score?.wer;
  const bWer = b.score?.wer;
  if (aWer != null && bWer != null && aWer !== bWer) return aWer - bWer;
  const aLatency = a.recognizeMs ?? Number.MAX_SAFE_INTEGER;
  const bLatency = b.recognizeMs ?? Number.MAX_SAFE_INTEGER;
  if (aLatency !== bLatency) return aLatency - bLatency;
  return String(a.modelId).localeCompare(String(b.modelId));
}

function compareResponsivenessResults(a, b) {
  if (a.error && !b.error) return 1;
  if (!a.error && b.error) return -1;
  const aFirstPartial = a.firstPartialMs ?? Number.MAX_SAFE_INTEGER;
  const bFirstPartial = b.firstPartialMs ?? Number.MAX_SAFE_INTEGER;
  if (aFirstPartial !== bFirstPartial) return aFirstPartial - bFirstPartial;
  const aFirstCommit = a.firstCommitMs ?? Number.MAX_SAFE_INTEGER;
  const bFirstCommit = b.firstCommitMs ?? Number.MAX_SAFE_INTEGER;
  if (aFirstCommit !== bFirstCommit) return aFirstCommit - bFirstCommit;
  const aSession = a.sessionMs ?? Number.MAX_SAFE_INTEGER;
  const bSession = b.sessionMs ?? Number.MAX_SAFE_INTEGER;
  if (aSession !== bSession) return aSession - bSession;
  return String(a.modelId).localeCompare(String(b.modelId));
}

function clip(text, max = 180) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function percent(value) {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function ms(value) {
  return value == null ? 'n/a' : `${Math.round(value)}ms`;
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function runOffline(model, clip) {
  const deviceClipPath = getDeviceClipPath(clip);
  await ensureBenchmarkPage();
  await callBridgeEval(
    `globalThis.__AGENTIC__?.benchmarkAsrFile?.(${JSON.stringify(model.id)}, ${JSON.stringify(
      deviceClipPath
    )})`
  );
  const result = await waitForAsyncResult('benchmarkAsrFile', OFFLINE_TIMEOUT_MS, model.id);
  if (result.status === 'success') {
    return {
      clipId: clip.id,
      clipLabel: clip.label,
      createdAt: Date.now(),
      mode: 'offline',
      modelId: model.id,
      modelName: result.result?.modelName ?? model.id,
      runtime: model.id.startsWith('moonshine') ? 'streaming' : 'offline',
      initMs: result.result?.initMs ?? null,
      recognizeMs: result.result?.recognizeMs ?? null,
      transcript: result.result?.transcript ?? '',
    };
  }
  return {
    clipId: clip.id,
    clipLabel: clip.label,
    createdAt: Date.now(),
    mode: 'offline',
    modelId: model.id,
    modelName: model.id,
    runtime: model.id.startsWith('moonshine') ? 'streaming' : 'offline',
    error: result.error || 'offline benchmark failed',
    transcript: '',
  };
}

async function runSimulated(model, clip) {
  const deviceClipPath = getDeviceClipPath(clip);
  await ensureBenchmarkPage();
  await callBridgeEval(
    `globalThis.__AGENTIC__?.benchmarkAsrSimulatedLive?.(${JSON.stringify(model.id)}, ${JSON.stringify(
      deviceClipPath
    )})`
  );
  const result = await waitForAsyncResult(
    'benchmarkAsrSimulatedLive',
    SIMULATED_TIMEOUT_MS,
    model.id
  );
  if (result.status === 'success') {
    return {
      clipId: clip.id,
      clipLabel: clip.label,
      createdAt: Date.now(),
      mode: 'simulated',
      modelId: model.id,
      modelName: result.result?.modelName ?? model.id,
      runtime: 'streaming',
      commitCount: result.result?.commitCount ?? null,
      firstCommitMs: result.result?.firstCommitMs ?? null,
      firstPartialMs: result.result?.firstPartialMs ?? null,
      initMs: result.result?.initMs ?? null,
      partialCount: result.result?.partialCount ?? null,
      sessionMs: result.result?.sessionMs ?? null,
      transcript: result.result?.transcript ?? '',
    };
  }
  return {
    clipId: clip.id,
    clipLabel: clip.label,
    createdAt: Date.now(),
    mode: 'simulated',
    modelId: model.id,
    modelName: model.id,
    runtime: 'streaming',
    error: result.error || 'simulated live benchmark failed',
    transcript: '',
  };
}

function attachScores(results, clip) {
  return results.map((result) => ({
    ...result,
    score:
      result.error || !result.transcript || !clip.referenceTranscript
        ? null
        : scoreTranscript(clip.referenceTranscript, result.transcript),
  }));
}

function average(values) {
  const valid = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function aggregateByModel(clips, comparator) {
  const grouped = new Map();

  for (const clip of clips) {
    for (const result of clip.results) {
      const entry = grouped.get(result.modelId) ?? {
        modelId: result.modelId,
        modelName: result.modelName || result.modelId,
        runtime: result.runtime,
        clips: [],
      };
      entry.clips.push({
        clipId: clip.id,
        clipLabel: clip.label,
        result,
      });
      grouped.set(result.modelId, entry);
    }
  }

  return Array.from(grouped.values())
    .map((entry) => {
      const results = entry.clips.map((clipResult) => clipResult.result);
      const successes = results.filter((result) => !result.error);
      return {
        ...entry,
        errorCount: results.length - successes.length,
        successfulClipCount: successes.length,
        avgWer: average(successes.map((result) => result.score?.wer)),
        avgCer: average(successes.map((result) => result.score?.cer)),
        avgInitMs: average(successes.map((result) => result.initMs)),
        avgRecognizeMs: average(successes.map((result) => result.recognizeMs)),
        avgFirstPartialMs: average(successes.map((result) => result.firstPartialMs)),
        avgFirstCommitMs: average(successes.map((result) => result.firstCommitMs)),
        avgSessionMs: average(successes.map((result) => result.sessionMs)),
        avgCommitCount: average(successes.map((result) => result.commitCount)),
        avgPartialCount: average(successes.map((result) => result.partialCount)),
      };
    })
    .sort(comparator);
}

function compareQualityAggregate(a, b) {
  if (a.errorCount !== b.errorCount) return a.errorCount - b.errorCount;
  const aWer = a.avgWer ?? Number.MAX_SAFE_INTEGER;
  const bWer = b.avgWer ?? Number.MAX_SAFE_INTEGER;
  if (aWer !== bWer) return aWer - bWer;
  const aRecognize = a.avgRecognizeMs ?? Number.MAX_SAFE_INTEGER;
  const bRecognize = b.avgRecognizeMs ?? Number.MAX_SAFE_INTEGER;
  if (aRecognize !== bRecognize) return aRecognize - bRecognize;
  return String(a.modelId).localeCompare(String(b.modelId));
}

function compareResponsivenessAggregate(a, b) {
  if (a.errorCount !== b.errorCount) return a.errorCount - b.errorCount;
  const aFirstPartial = a.avgFirstPartialMs ?? Number.MAX_SAFE_INTEGER;
  const bFirstPartial = b.avgFirstPartialMs ?? Number.MAX_SAFE_INTEGER;
  if (aFirstPartial !== bFirstPartial) return aFirstPartial - bFirstPartial;
  const aFirstCommit = a.avgFirstCommitMs ?? Number.MAX_SAFE_INTEGER;
  const bFirstCommit = b.avgFirstCommitMs ?? Number.MAX_SAFE_INTEGER;
  if (aFirstCommit !== bFirstCommit) return aFirstCommit - bFirstCommit;
  const aSession = a.avgSessionMs ?? Number.MAX_SAFE_INTEGER;
  const bSession = b.avgSessionMs ?? Number.MAX_SAFE_INTEGER;
  if (aSession !== bSession) return aSession - bSession;
  return String(a.modelId).localeCompare(String(b.modelId));
}

function compareStreamingTextQualityAggregate(a, b) {
  if (a.errorCount !== b.errorCount) return a.errorCount - b.errorCount;
  const aWer = a.avgWer ?? Number.MAX_SAFE_INTEGER;
  const bWer = b.avgWer ?? Number.MAX_SAFE_INTEGER;
  if (aWer !== bWer) return aWer - bWer;
  const aFirstCommit = a.avgFirstCommitMs ?? Number.MAX_SAFE_INTEGER;
  const bFirstCommit = b.avgFirstCommitMs ?? Number.MAX_SAFE_INTEGER;
  if (aFirstCommit !== bFirstCommit) return aFirstCommit - bFirstCommit;
  return String(a.modelId).localeCompare(String(b.modelId));
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Playground Direct ASR Benchmark Report');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Device: ${DEVICE || '(auto-selected by CDP / adb)'}`);
  lines.push(`- Route: ${ROUTE}`);
  if (OFFLINE_MODELS.length > 0) {
    lines.push(`- Models: ${OFFLINE_MODELS.map((model) => model.id).join(', ')}`);
  }
  lines.push('');
  lines.push('## Evaluation Set');
  lines.push('');
  for (const clip of report.evalSet) {
    lines.push(`- ${clip.label}: ${clip.description}`);
    lines.push(`  Source: ${clip.transcriptSource}`);
  }
  lines.push('');
  lines.push('## Quality Benchmark');
  lines.push('');
  lines.push('Offline/file transcription on identical staged WAV clips. This is the fair text-quality comparison.');
  lines.push('');
  lines.push('| Model | Avg WER | Avg CER | Avg init | Avg recognize | Successful clips | Errors |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const item of report.quality.aggregate) {
    lines.push(
      `| ${escapeCell(item.modelName || item.modelId)} | ${escapeCell(percent(item.avgWer))} | ${escapeCell(percent(item.avgCer))} | ${escapeCell(ms(item.avgInitMs))} | ${escapeCell(ms(item.avgRecognizeMs))} | ${escapeCell(item.successfulClipCount)} | ${escapeCell(item.errorCount)} |`
    );
  }
  lines.push('');
  for (const clip of report.quality.clips) {
    lines.push(`### ${clip.label}`);
    lines.push('');
    lines.push(
      `Reference: ${clip.referenceTranscript ?? 'Unavailable in repo; performance-only clip'}`
    );
    lines.push('');
    lines.push('| Model | WER | CER | Init | Recognize | Error | Transcript |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const item of clip.results) {
      lines.push(
        `| ${escapeCell(item.modelName || item.modelId)} | ${escapeCell(percent(item.score?.wer))} | ${escapeCell(percent(item.score?.cer))} | ${escapeCell(ms(item.initMs))} | ${escapeCell(ms(item.recognizeMs))} | ${escapeCell(item.error || '')} | ${escapeCell(clipText(item.transcript))} |`
      );
    }
    lines.push('');
  }
  lines.push('## Live Responsiveness Benchmark');
  lines.push('');
  lines.push('Simulated live feeds the identical PCM waveform directly into each runtime.');
  lines.push('');
  lines.push('Whisper is pseudo-streaming here: it repeatedly re-decodes cumulative audio and its diagnostic WER should not be treated as a true streaming quality leaderboard.');
  lines.push('');
  lines.push('| Model | Avg init | Avg first partial | Avg first commit | Avg session | Avg diagnostic WER | Successful clips | Errors |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const item of report.liveResponsiveness.aggregate) {
    lines.push(
      `| ${escapeCell(item.modelName || item.modelId)} | ${escapeCell(ms(item.avgInitMs))} | ${escapeCell(ms(item.avgFirstPartialMs))} | ${escapeCell(ms(item.avgFirstCommitMs))} | ${escapeCell(ms(item.avgSessionMs))} | ${escapeCell(percent(item.avgWer))} | ${escapeCell(item.successfulClipCount)} | ${escapeCell(item.errorCount)} |`
    );
  }
  lines.push('');
  for (const clip of report.liveResponsiveness.clips) {
    lines.push(`### ${clip.label}`);
    lines.push('');
    lines.push('| Model | First partial | First commit | Session | Diagnostic WER | Commits | Partials | Error | Transcript |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const item of clip.results) {
      lines.push(
        `| ${escapeCell(item.modelName || item.modelId)} | ${escapeCell(ms(item.firstPartialMs))} | ${escapeCell(ms(item.firstCommitMs))} | ${escapeCell(ms(item.sessionMs))} | ${escapeCell(percent(item.score?.wer))} | ${escapeCell(item.commitCount ?? '')} | ${escapeCell(item.partialCount ?? '')} | ${escapeCell(item.error || '')} | ${escapeCell(clipText(item.transcript))} |`
      );
    }
    lines.push('');
  }
  lines.push('## Summary');
  lines.push('');
  if (report.summary.bestQuality) {
    lines.push(
      `- Best quality: ${report.summary.bestQuality.modelName} (${percent(report.summary.bestQuality.avgWer)} average WER).`
    );
  }
  if (report.summary.bestResponsiveness) {
    lines.push(
      `- Best live responsiveness: ${report.summary.bestResponsiveness.modelName} (${ms(report.summary.bestResponsiveness.avgFirstPartialMs)} average first partial, ${ms(report.summary.bestResponsiveness.avgFirstCommitMs)} average first commit).`
    );
  }
  if (report.summary.bestStreamingTextQuality) {
    lines.push(
      `- Best true-streaming diagnostic text quality: ${report.summary.bestStreamingTextQuality.modelName} (${percent(report.summary.bestStreamingTextQuality.avgWer)} average diagnostic WER).`
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function clipText(text, max = 180) {
  return clip(text, max);
}

async function main() {
  if (OFFLINE_MODELS.length === 0) {
    throw new Error('No models selected. Check BENCHMARK_MODELS.');
  }
  if (EVAL_CLIPS.length === 0) {
    throw new Error('No clips selected. Check BENCHMARK_CLIPS.');
  }

  await ensureBenchmarkPage();

  const qualityClips = [];
  const liveClips = [];

  for (const clip of EVAL_CLIPS) {
    await ensureDeviceClip(clip);

    if (clip.modes.includes('offline')) {
      const offlineResults = [];
      for (const model of OFFLINE_MODELS) {
        offlineResults.push(await runOffline(model, clip));
      }
      qualityClips.push({
        ...clip,
        deviceClip: getDeviceClipPath(clip),
        results: attachScores(offlineResults, clip).sort(compareQualityResults),
      });
    }

    if (clip.modes.includes('simulated')) {
      const simulatedResults = [];
      for (const model of SIMULATED_MODELS) {
        simulatedResults.push(await runSimulated(model, clip));
      }
      liveClips.push({
        ...clip,
        deviceClip: getDeviceClipPath(clip),
        results: attachScores(simulatedResults, clip).sort(compareResponsivenessResults),
      });
    }
  }

  const qualityAggregate = aggregateByModel(qualityClips, compareQualityAggregate);
  const liveAggregate = aggregateByModel(liveClips, compareResponsivenessAggregate);
  const moonshineLiveAggregate = aggregateByModel(
    liveClips.filter((clip) =>
      clip.results.some((result) => String(result.modelId).startsWith('moonshine'))
    ).map((clip) => ({
      ...clip,
      results: clip.results.filter((result) =>
        String(result.modelId).startsWith('moonshine')
      ),
    })),
    compareStreamingTextQualityAggregate
  );

  const report = {
    generatedAt: new Date().toISOString(),
    evalSet: EVAL_CLIPS.map((clip) => ({
      ...clip,
      hostPath: resolveHostPath(clip),
      deviceClip: getDeviceClipPath(clip),
    })),
    quality: {
      clips: qualityClips,
      aggregate: qualityAggregate,
    },
    liveResponsiveness: {
      clips: liveClips,
      aggregate: liveAggregate,
    },
    summary: {
      bestQuality: qualityAggregate.find((item) => item.errorCount === 0) ?? null,
      bestResponsiveness: liveAggregate.find((item) => item.errorCount === 0) ?? null,
      bestStreamingTextQuality:
        moonshineLiveAggregate.find((item) => item.errorCount === 0) ?? null,
    },
  };

  const timestamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(REPORT_DIR, `direct-asr-benchmark-${timestamp}.json`);
  const mdPath = path.join(REPORT_DIR, `direct-asr-benchmark-${timestamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, renderMarkdown(report));
  console.log(JSON.stringify({ report: jsonPath, markdown: mdPath, summary: report.summary }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
