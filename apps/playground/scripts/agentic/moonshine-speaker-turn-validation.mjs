#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getMetroHost } from './metro-host.mjs';

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
const DEV_CLIENT_SCHEME =
  process.env.DEV_CLIENT_SCHEME ||
  (APP_VARIANT === 'production'
    ? `exp+${SCHEME_BASE}`
    : `exp+${SCHEME_BASE}-${APP_VARIANT}`);
const ROUTE = '/moonshine-live';
const TIMEOUT_MS = 10 * 60 * 1000;
const STATE_TIMEOUT_MS = 90 * 1000;
const POLL_INTERVAL_MS = 1000;

const WORDS_ROOT = '/Volumes/c910ssd/datasets/ami_public_manual_1.6.2/words';
const MODELS = [
  { id: 'moonshine-small-streaming-en', label: 'Moonshine Small Streaming' },
  { id: 'moonshine-medium-streaming-en', label: 'Moonshine Medium Streaming' },
];
const DEFAULT_WINDOWS = [
  { meetingId: 'IS1001a', startS: 230, endS: 250 },
  { meetingId: 'IS1001a', startS: 340, endS: 380 },
  { meetingId: 'IS1001a', startS: 530, endS: 550 },
];
const WINDOW_SPECS =
  process.env.AMI_START_S && process.env.AMI_END_S
    ? [
        {
          meetingId: process.env.AMI_MEETING_ID || 'IS1001a',
          startS: Number(process.env.AMI_START_S),
          endS: Number(process.env.AMI_END_S),
        },
      ]
    : DEFAULT_WINDOWS;

fs.mkdirSync(REPORT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, { cwd = REPO_ROOT, parseJson = false, maxBuffer = 50 * 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, APP_ROOT },
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
  return run('adb', SERIAL ? ['-s', SERIAL, ...args] : args);
}

function adbShell(command) {
  return adb(['shell', command]);
}

function bridge(args, parseJson = true) {
  return run(
    'node',
    DEVICE ? [BRIDGE, '--device', DEVICE, ...args] : [BRIDGE, ...args],
    { parseJson }
  );
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function isNoTargetError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('No debug targets found') ||
    message.includes('No __AGENTIC__ targets found') ||
    message.includes('WebSocket closed')
  );
}

async function waitForBridgeTarget(timeoutMs = STATE_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const devices = bridge(['list-devices']);
      if ((devices?.count ?? 0) > 0) return;
    } catch (_error) {
      // Target is not ready yet; keep polling until the timeout expires.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Timed out waiting for CDP target');
}

async function restartDevClient() {
  const metroHost = getMetroHost(SERIAL);
  adb(['reverse', 'tcp:7365', 'tcp:7365']);
  adb(['shell', 'am', 'force-stop', PKG]);
  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    `${DEV_CLIENT_SCHEME}://expo-development-client/?url=${encodeURIComponent(`http://${metroHost}:7365`)}`,
    PKG,
  ]);
  await sleep(5000);
  await waitForBridgeTarget();
}

async function ensureRoute() {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await waitForBridgeTarget();
      bridge(['navigate', ROUTE]);
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await restartDevClient();
    }
  }
}

async function callBridgeEval(expression) {
  try {
    return bridge(['eval', expression]);
  } catch (error) {
    if (!isNoTargetError(error)) throw error;
    await restartDevClient();
    await ensureRoute();
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

function getClipInfo(windowSpec) {
  const clipId = `${windowSpec.meetingId}-${windowSpec.startS}-${windowSpec.endS}`;
  return {
    ...windowSpec,
    clipId,
    durationS: windowSpec.endS - windowSpec.startS,
    hostAudio: `/Volumes/c910ssd/datasets/amicorpus/${windowSpec.meetingId}/audio/${windowSpec.meetingId}.Mix-Headset.wav`,
    hostClip: `/tmp/${clipId}.wav`,
    deviceClip: `/data/user/0/${PKG}/files/benchmarks/${clipId}.wav`,
  };
}

function ensureHostClip(clip) {
  if (!fs.existsSync(clip.hostAudio)) {
    throw new Error(`Missing AMI host audio: ${clip.hostAudio}`);
  }
  run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    String(clip.startS),
    '-t',
    String(clip.durationS),
    '-i',
    clip.hostAudio,
    '-ac',
    '1',
    '-ar',
    '16000',
    clip.hostClip,
  ]);
  if (!fs.existsSync(clip.hostClip) || fs.statSync(clip.hostClip).size <= 0) {
    throw new Error(`Failed to create clip at ${clip.hostClip}`);
  }
}

async function ensureDeviceClip(clip) {
  adbShell(
    `run-as ${PKG} sh -c "mkdir -p ${path.posix.dirname(clip.deviceClip)} && rm -f ${clip.deviceClip}"`
  );
  run('bash', [
    '-lc',
    `cat ${shellQuote(clip.hostClip)} | ${
      SERIAL ? `adb -s ${SERIAL}` : 'adb'
    } shell "run-as ${PKG} sh -c 'cat > ${clip.deviceClip}'"`,
  ]);
  const stagedSize = Number(
    adbShell(`run-as ${PKG} sh -c "wc -c < ${clip.deviceClip} 2>/dev/null || echo 0"`).trim() ||
      '0'
  );
  if (stagedSize <= 0) {
    throw new Error(`Failed to stage clip to ${clip.deviceClip}`);
  }
}

function readSpeakerWords(meetingId, startS, endS) {
  const allWords = [];
  const files = fs
    .readdirSync(WORDS_ROOT)
    .filter((name) => name.startsWith(`${meetingId}.`) && name.endsWith('.words.xml'))
    .sort();

  for (const name of files) {
    const speaker = name.split('.')[1];
    const xml = fs.readFileSync(path.join(WORDS_ROOT, name), 'utf8');
    const wordRegex = /<w\b([^>]*)>([^<]*)<\/w>/g;
    let match = null;
    while ((match = wordRegex.exec(xml))) {
      const attrs = match[1];
      const text = String(match[2] || '').trim();
      if (!text) continue;
      const startMatch = attrs.match(/starttime="([^"]+)"/);
      const endMatch = attrs.match(/endtime="([^"]+)"/);
      if (!startMatch || !endMatch) continue;
      const wordStart = Number(startMatch[1]);
      const wordEnd = Number(endMatch[1]);
      if (!Number.isFinite(wordStart) || !Number.isFinite(wordEnd)) continue;
      if (wordStart >= endS || wordEnd <= startS) continue;
      allWords.push({
        speaker,
        text,
        startS: wordStart,
        endS: wordEnd,
      });
    }
  }

  return allWords.sort((a, b) => a.startS - b.startS || a.endS - b.endS);
}

function mergeReferenceTurns(words, maxGapS = 0.7) {
  const turns = [];
  for (const word of words) {
    const previous = turns[turns.length - 1];
    if (
      previous &&
      previous.speaker === word.speaker &&
      word.startS - previous.endS <= maxGapS
    ) {
      previous.endS = Math.max(previous.endS, word.endS);
      previous.text = `${previous.text} ${word.text}`.trim();
      continue;
    }
    turns.push({
      speaker: word.speaker,
      startS: word.startS,
      endS: word.endS,
      text: word.text,
    });
  }
  return turns;
}

function getPredictedSpeakerLabel(line) {
  if (typeof line?.speakerIndex === 'number') {
    return `speaker-${line.speakerIndex}`;
  }
  if (line?.speakerId) {
    return String(line.speakerId);
  }
  return 'unknown';
}

function getDominantReferenceSpeaker(words, line, clipStartS) {
  const startedAtMs = line?.startedAtMs;
  const completedAtMs = line?.completedAtMs ?? startedAtMs;
  if (startedAtMs == null || completedAtMs == null) {
    return { speaker: null, overlapBySpeaker: {} };
  }

  const startS = clipStartS + startedAtMs / 1000;
  const endS = clipStartS + completedAtMs / 1000;
  const overlapBySpeaker = {};

  for (const word of words) {
    const overlap = Math.min(endS, word.endS) - Math.max(startS, word.startS);
    if (overlap > 0) {
      overlapBySpeaker[word.speaker] = (overlapBySpeaker[word.speaker] || 0) + overlap;
    }
  }

  let bestSpeaker = null;
  let bestOverlap = 0;
  for (const [speaker, overlap] of Object.entries(overlapBySpeaker)) {
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestSpeaker = speaker;
    }
  }

  return { speaker: bestSpeaker, overlapBySpeaker, startS, endS };
}

function countSpeakerChanges(sequence) {
  let count = 0;
  let previous = null;
  for (const value of sequence) {
    if (!value) continue;
    if (previous != null && previous !== value) {
      count += 1;
    }
    previous = value;
  }
  return count;
}

function analyzeModelResult(model, rawResult, referenceWords, referenceTurns, clip) {
  const predictedLines = Array.isArray(rawResult?.lines) ? rawResult.lines : [];
  const alignedLines = predictedLines.map((line, index) => {
    const predictedSpeaker = getPredictedSpeakerLabel(line);
    const dominant = getDominantReferenceSpeaker(referenceWords, line, clip.startS);
    return {
      index,
      text: String(line?.text || '').trim(),
      predictedSpeaker,
      hasSpeakerId: Boolean(line?.hasSpeakerId),
      speakerIndex: line?.speakerIndex ?? null,
      speakerId: line?.speakerId ?? null,
      startedAtMs: line?.startedAtMs ?? null,
      completedAtMs: line?.completedAtMs ?? null,
      dominantReferenceSpeaker: dominant.speaker,
      startS: dominant.startS ?? null,
      endS: dominant.endS ?? null,
    };
  });

  const predictedKnownLines = alignedLines.filter(
    (line) => line.predictedSpeaker !== 'unknown'
  );
  const predictedDistinctSpeakers = Array.from(
    new Set(predictedKnownLines.map((line) => line.predictedSpeaker))
  );
  const referenceDistinctSpeakers = Array.from(
    new Set(referenceWords.map((word) => word.speaker))
  );

  const mappingCounts = new Map();
  for (const line of alignedLines) {
    if (!line.dominantReferenceSpeaker || line.predictedSpeaker === 'unknown') continue;
    const key = `${line.predictedSpeaker}__${line.dominantReferenceSpeaker}`;
    mappingCounts.set(key, (mappingCounts.get(key) || 0) + 1);
  }

  const clusterMapping = {};
  for (const predictedSpeaker of predictedDistinctSpeakers) {
    let bestSpeaker = null;
    let bestCount = -1;
    for (const referenceSpeaker of referenceDistinctSpeakers) {
      const count = mappingCounts.get(`${predictedSpeaker}__${referenceSpeaker}`) || 0;
      if (count > bestCount) {
        bestSpeaker = referenceSpeaker;
        bestCount = count;
      }
    }
    clusterMapping[predictedSpeaker] = bestSpeaker;
  }

  const mappedLines = alignedLines.filter(
    (line) => line.dominantReferenceSpeaker && clusterMapping[line.predictedSpeaker]
  );
  const mappedCorrect = mappedLines.filter(
    (line) => clusterMapping[line.predictedSpeaker] === line.dominantReferenceSpeaker
  ).length;

  return {
    modelId: model.id,
    modelName: model.label,
    commitCount: rawResult?.commitCount ?? null,
    firstCommitMs: rawResult?.firstCommitMs ?? null,
    firstPartialMs: rawResult?.firstPartialMs ?? null,
    initMs: rawResult?.initMs ?? null,
    partialCount: rawResult?.partialCount ?? null,
    sessionMs: rawResult?.sessionMs ?? null,
    transcript: rawResult?.transcript ?? '',
    referenceSpeakerCount: referenceDistinctSpeakers.length,
    referenceSpeakers: referenceDistinctSpeakers,
    referenceTurnCount: referenceTurns.length,
    predictedKnownSpeakerCount: predictedDistinctSpeakers.length,
    predictedKnownSpeakers: predictedDistinctSpeakers,
    predictedUnknownLineCount: alignedLines.filter((line) => line.predictedSpeaker === 'unknown').length,
    predictedLineCount: alignedLines.length,
    predictedSpeakerChangeCount: countSpeakerChanges(
      alignedLines.map((line) => (line.predictedSpeaker === 'unknown' ? null : line.predictedSpeaker))
    ),
    referenceSpeakerChangeCountOnPredictedLines: countSpeakerChanges(
      alignedLines.map((line) => line.dominantReferenceSpeaker)
    ),
    mappedLineAccuracy:
      mappedLines.length > 0 ? mappedCorrect / mappedLines.length : null,
    collapsedToSingleSpeaker:
      predictedDistinctSpeakers.length <= 1 && referenceDistinctSpeakers.length > 1,
    clusterMapping,
    alignedLines,
  };
}

function formatPercent(value) {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function formatMs(value) {
  return value == null ? 'n/a' : `${Math.round(value)}ms`;
}

function average(values) {
  const valid = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function summarizeByModel(clips) {
  const grouped = new Map();
  for (const clip of clips) {
    for (const result of clip.results) {
      const entry =
        grouped.get(result.modelId) ||
        {
          modelId: result.modelId,
          modelName: result.modelName,
          clips: [],
        };
      entry.clips.push(result);
      grouped.set(result.modelId, entry);
    }
  }

  return Array.from(grouped.values()).map((entry) => ({
    modelId: entry.modelId,
    modelName: entry.modelName,
    clipCount: entry.clips.length,
    avgPredictedKnownSpeakerCount: average(
      entry.clips.map((clip) => clip.predictedKnownSpeakerCount)
    ),
    avgReferenceSpeakerCount: average(
      entry.clips.map((clip) => clip.referenceSpeakerCount)
    ),
    avgPredictedSpeakerChangeCount: average(
      entry.clips.map((clip) => clip.predictedSpeakerChangeCount)
    ),
    avgReferenceSpeakerChangeCount: average(
      entry.clips.map((clip) => clip.referenceSpeakerChangeCountOnPredictedLines)
    ),
    avgMappedLineAccuracy: average(entry.clips.map((clip) => clip.mappedLineAccuracy)),
    collapsedClipCount: entry.clips.filter((clip) => clip.collapsedToSingleSpeaker).length,
    avgFirstPartialMs: average(entry.clips.map((clip) => clip.firstPartialMs)),
    avgFirstCommitMs: average(entry.clips.map((clip) => clip.firstCommitMs)),
  }));
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Moonshine Speaker Turn Validation`);
  lines.push('');
  lines.push(`Validated windows: \`${report.clips.length}\``);
  lines.push(`Models: \`${report.models.map((model) => model.label).join(', ')}\``);
  lines.push('');
  lines.push(`## Aggregate Summary`);
  lines.push('');
  lines.push(`| Model | Clips | Avg pred speakers | Avg ref speakers | Avg pred changes | Avg ref changes | Collapsed clips | Avg mapped accuracy | Avg first partial | Avg first commit |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const result of report.summaryByModel) {
    lines.push(
      `| ${result.modelName} | ${result.clipCount} | ${result.avgPredictedKnownSpeakerCount?.toFixed(1) ?? 'n/a'} | ${result.avgReferenceSpeakerCount?.toFixed(1) ?? 'n/a'} | ${result.avgPredictedSpeakerChangeCount?.toFixed(1) ?? 'n/a'} | ${result.avgReferenceSpeakerChangeCount?.toFixed(1) ?? 'n/a'} | ${result.collapsedClipCount} | ${formatPercent(result.avgMappedLineAccuracy)} | ${formatMs(result.avgFirstPartialMs)} | ${formatMs(result.avgFirstCommitMs)} |`
    );
  }
  lines.push('');

  for (const clip of report.clips) {
    lines.push(`## ${clip.id}`);
    lines.push('');
    lines.push(`- Window: \`${clip.startS}s-${clip.endS}s\``);
    lines.push(`- Audio: \`${clip.hostClip}\``);
    lines.push(`- Reference speakers: \`${clip.reference.speakers.join(', ')}\``);
    lines.push(`- Reference turn count: \`${clip.reference.turnCount}\``);
    lines.push('');
    lines.push(`| Model | Pred speakers | Ref speakers | Pred changes | Ref changes | Unknown lines | Mapped accuracy | First partial | First commit |`);
    lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
    for (const result of clip.results) {
      lines.push(
        `| ${result.modelName} | ${result.predictedKnownSpeakerCount} | ${result.referenceSpeakerCount} | ${result.predictedSpeakerChangeCount} | ${result.referenceSpeakerChangeCountOnPredictedLines} | ${result.predictedUnknownLineCount} | ${formatPercent(result.mappedLineAccuracy)} | ${formatMs(result.firstPartialMs)} | ${formatMs(result.firstCommitMs)} |`
      );
    }
    lines.push('');

    for (const result of clip.results) {
      lines.push(`### ${result.modelName}`);
      lines.push('');
      lines.push(`- Transcript: ${result.transcript ? `\`${result.transcript}\`` : '`(empty)`'}`);
      lines.push(`- Predicted speakers: \`${result.predictedKnownSpeakers.join(', ') || 'none'}\``);
      lines.push(`- Cluster mapping: \`${JSON.stringify(result.clusterMapping)}\``);
      lines.push(`- Collapsed to one speaker: \`${result.collapsedToSingleSpeaker}\``);
      lines.push('');
      lines.push(`| # | Pred speaker | Ref speaker | Start | End | Text |`);
      lines.push(`| --- | --- | --- | ---: | ---: | --- |`);
      for (const line of result.alignedLines.slice(0, 16)) {
        lines.push(
          `| ${line.index + 1} | ${line.predictedSpeaker} | ${line.dominantReferenceSpeaker ?? 'n/a'} | ${line.startS == null ? 'n/a' : line.startS.toFixed(2)} | ${line.endS == null ? 'n/a' : line.endS.toFixed(2)} | ${String(line.text || '').replace(/\|/g, '\\|')} |`
        );
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

async function main() {
  await ensureRoute();
  const clips = [];

  for (const windowSpec of WINDOW_SPECS) {
    const clip = getClipInfo(windowSpec);
    ensureHostClip(clip);
    await ensureDeviceClip(clip);

    const referenceWords = readSpeakerWords(clip.meetingId, clip.startS, clip.endS);
    const referenceTurns = mergeReferenceTurns(referenceWords);
    const results = [];

    for (const model of MODELS) {
      await callBridgeEval(
        `globalThis.__AGENTIC__?.benchmarkMoonshineSpeakerTurns?.(${JSON.stringify(
          model.id
        )}, ${JSON.stringify(clip.deviceClip)})`
      );
      const result = await waitForAsyncResult(
        'benchmarkMoonshineSpeakerTurns',
        TIMEOUT_MS,
        model.id
      );
      if (result.status !== 'success') {
        throw new Error(result.error || `Speaker validation failed for ${model.id}`);
      }
      results.push(
        analyzeModelResult(model, result.result, referenceWords, referenceTurns, clip)
      );
    }

    clips.push({
      id: clip.clipId,
      meetingId: clip.meetingId,
      startS: clip.startS,
      endS: clip.endS,
      hostAudio: clip.hostAudio,
      hostClip: clip.hostClip,
      deviceClip: clip.deviceClip,
      reference: {
        speakerCount: Array.from(new Set(referenceWords.map((word) => word.speaker))).length,
        speakers: Array.from(new Set(referenceWords.map((word) => word.speaker))),
        turnCount: referenceTurns.length,
        turns: referenceTurns,
        wordCount: referenceWords.length,
      },
      results,
    });
  }

  const report = {
    createdAt: new Date().toISOString(),
    models: MODELS,
    clips,
    summaryByModel: summarizeByModel(clips),
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(REPORT_DIR, `moonshine-speaker-turn-validation-${timestamp}.json`);
  const mdPath = path.join(REPORT_DIR, `moonshine-speaker-turn-validation-${timestamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));

  console.log(
    JSON.stringify(
      {
        json: jsonPath,
        markdown: mdPath,
        summary: report.summaryByModel.map((result) => ({
          modelId: result.modelId,
          predictedKnownSpeakerCount: result.avgPredictedKnownSpeakerCount,
          referenceSpeakerCount: result.avgReferenceSpeakerCount,
          collapsedClipCount: result.collapsedClipCount,
          avgMappedLineAccuracy: result.avgMappedLineAccuracy,
        })),
      },
      null,
      2
    )
  );
}

await main();
