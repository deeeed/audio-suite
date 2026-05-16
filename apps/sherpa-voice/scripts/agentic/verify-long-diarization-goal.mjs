#!/usr/bin/env node
/**
 * Verify the full long-diarization goal evidence.
 *
 * This is intentionally stricter than the implementation/typecheck gates: it
 * requires physical Android and physical iOS 60-minute global speaker re-ID
 * artifacts and pyannote scores. iOS simulator evidence is useful, but does not
 * satisfy the "both android and ios" physical-device completion gate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(appRoot, '../..');
const summaryPath = path.join(repoRoot, '.agent/validation-logs/diarization/native-long-window-validation-summary.json');
function readFiniteThreshold(name, defaultValue) {
  const value = Number.parseFloat(process.env[name] || String(defaultValue));
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

const maxDerPercent = readFiniteThreshold('MAX_DER_PERCENT', 10);
const maxJerPercent = readFiniteThreshold('MAX_JER_PERCENT', 12);

const requiredRows = [
  {
    label: 'android-pixel6a-60m-windowed-global-reid-eres2net-fullseg',
    platformIncludes: 'Pixel 6a physical',
  },
  {
    label: 'ios-physical-iphone12-60m-windowed-global-reid-eres2net-fullseg',
    platformIncludes: 'iPhone 12 physical',
  },
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveRepoPath(value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

function verifyScoreArtifact(scorePath, row) {
  const scoreDoc = readJson(scorePath);
  const score = scoreDoc?.results?.[0]?.score;
  const failures = [];
  if (!score) {
    failures.push(`score artifact has no results[0].score: ${scorePath}`);
    return failures;
  }
  if (score.hypSpeakerCount !== 2) {
    failures.push(`${row.label}: expected hypSpeakerCount=2, got ${score.hypSpeakerCount}`);
  }
  if (score.refSpeakerCount !== 2) {
    failures.push(`${row.label}: expected refSpeakerCount=2, got ${score.refSpeakerCount}`);
  }
  if (score.diarizationErrorRatePercent > maxDerPercent) {
    failures.push(`${row.label}: DER ${score.diarizationErrorRatePercent} > ${maxDerPercent}`);
  }
  if (score.jaccardErrorRatePercent > maxJerPercent) {
    failures.push(`${row.label}: JER ${score.jaccardErrorRatePercent} > ${maxJerPercent}`);
  }
  return failures;
}

function verifyRow(summary, requirement) {
  const failures = [];
  const row = summary.results?.find((item) => item.label === requirement.label);
  if (!row) {
    return [`missing summary row: ${requirement.label}`];
  }
  if (!String(row.platform || '').includes(requirement.platformIncludes)) {
    failures.push(`${row.label}: platform does not include "${requirement.platformIncludes}": ${row.platform}`);
  }
  if (row.windowCount !== 12) {
    failures.push(`${row.label}: expected 12 windows, got ${row.windowCount}`);
  }
  if (row.windowDurationMs !== 300000) {
    failures.push(`${row.label}: expected 300000ms windows, got ${row.windowDurationMs}`);
  }
  if (row.numSpeakers !== 2) {
    failures.push(`${row.label}: expected 2 speakers, got ${row.numSpeakers}`);
  }
  if (row.derPercent > maxDerPercent) {
    failures.push(`${row.label}: summary DER ${row.derPercent} > ${maxDerPercent}`);
  }
  if (row.jerPercent > maxJerPercent) {
    failures.push(`${row.label}: summary JER ${row.jerPercent} > ${maxJerPercent}`);
  }

  const artifactPath = resolveRepoPath(row.artifact);
  const scorePath = resolveRepoPath(row.scoreArtifact);
  if (!artifactPath || !fs.existsSync(artifactPath)) {
    failures.push(`${row.label}: missing raw artifact ${row.artifact}`);
  }
  if (!scorePath || !fs.existsSync(scorePath)) {
    failures.push(`${row.label}: missing score artifact ${row.scoreArtifact}`);
  } else {
    failures.push(...verifyScoreArtifact(scorePath, row));
  }

  return failures;
}

function main() {
  const failures = [];
  if (!fs.existsSync(summaryPath)) {
    failures.push(`missing summary: ${summaryPath}`);
  }
  const summary = failures.length ? null : readJson(summaryPath);
  if (summary) {
    if (Array.isArray(summary.blockedValidation) && summary.blockedValidation.length) {
      failures.push(`summary still has blockedValidation entries: ${JSON.stringify(summary.blockedValidation)}`);
    }
    for (const requirement of requiredRows) {
      failures.push(...verifyRow(summary, requirement));
    }
  }

  const report = {
    ok: failures.length === 0,
    summaryPath,
    thresholds: {
      maxDerPercent,
      maxJerPercent,
    },
    requiredRows,
    failures,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exit(1);
}

main();
