#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

function usage() {
  console.error(`Usage:
  node scripts/diarization-score.mjs --reference ref-segments.json --hypothesis hyp.json [--out score.json] [--frame-ms 20]

Inputs can be:
  - an array of {start,end,speaker}
  - an object with .segments
  - an agentic benchmark object with .result.segments
  - a sweep object with .result.results[].result.segments
`)
  process.exit(2)
}

function parseArgs(argv) {
  const args = { frameMs: 20 }
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i]
    const val = argv[i + 1]
    if (key === '--reference') { args.reference = val; i++ }
    else if (key === '--hypothesis') { args.hypothesis = val; i++ }
    else if (key === '--out') { args.out = val; i++ }
    else if (key === '--frame-ms') { args.frameMs = Number(val); i++ }
    else usage()
  }
  if (!args.reference || !args.hypothesis || !Number.isFinite(args.frameMs) || args.frameMs <= 0) usage()
  return args
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function normalizeSegment(raw, index) {
  const start = Number(raw.start)
  const end = Number(raw.end)
  const speaker = String(raw.speaker ?? raw.label ?? raw.speaker_id ?? raw.name ?? 'UNKNOWN')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { index, start, end, speaker, duration: end - start }
}

function normalizeSegments(value, label = 'input') {
  let arr = value
  if (!Array.isArray(arr)) arr = value?.segments
  if (!Array.isArray(arr)) arr = value?.result?.segments
  if (!Array.isArray(arr)) throw new Error(`${label} does not contain a segment array`)
  return arr.map(normalizeSegment).filter(Boolean).sort((a, b) => a.start - b.start || a.end - b.end)
}

function extractHypotheses(value) {
  const sweep = value?.result?.results
  if (Array.isArray(sweep)) {
    return sweep
      .filter((entry) => entry?.result?.segments)
      .map((entry, index) => ({
        label: entry.result.label ?? entry.case?.label ?? `case-${index}`,
        metadata: {
          status: entry.status,
          embeddingModelId: entry.result.embeddingModelId,
          numClusters: entry.result.numClusters,
          threshold: entry.result.threshold,
          durationMs: entry.result.durationMs,
          segmentCount: entry.result.segmentCount,
          numSpeakers: entry.result.numSpeakers,
        },
        segments: normalizeSegments(entry.result, `hypothesis ${index}`),
      }))
  }
  return [{ label: value?.result?.label ?? value?.label ?? 'hypothesis', metadata: {}, segments: normalizeSegments(value, 'hypothesis') }]
}

function labels(segments) {
  return [...new Set(segments.map((s) => s.speaker))].sort()
}

function overlapDuration(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

function buildOverlapMatrix(refSegments, hypSegments, refLabels, hypLabels) {
  const refIndex = new Map(refLabels.map((x, i) => [x, i]))
  const hypIndex = new Map(hypLabels.map((x, i) => [x, i]))
  const matrix = Array.from({ length: refLabels.length }, () => Array(hypLabels.length).fill(0))
  for (const r of refSegments) {
    for (const h of hypSegments) {
      const ov = overlapDuration(r, h)
      if (ov > 0) matrix[refIndex.get(r.speaker)][hypIndex.get(h.speaker)] += ov
    }
  }
  return matrix
}

function bestAssignment(refLabels, hypLabels, matrix) {
  const mapping = {}
  if (refLabels.length === 0 || hypLabels.length === 0) return { mapping, score: 0 }

  // For diarization comparisons the reference speaker count is usually small.
  // Assign each label on the smaller side to a unique label on the larger side.
  if (refLabels.length <= hypLabels.length) {
    let bestScore = -Infinity
    let bestPairs = []
    const used = new Set()
    function rec(ri, score, pairs) {
      if (ri === refLabels.length) {
        if (score > bestScore) { bestScore = score; bestPairs = pairs.slice() }
        return
      }
      for (let hi = 0; hi < hypLabels.length; hi++) {
        if (used.has(hi)) continue
        used.add(hi)
        pairs.push([refLabels[ri], hypLabels[hi]])
        rec(ri + 1, score + matrix[ri][hi], pairs)
        pairs.pop()
        used.delete(hi)
      }
    }
    rec(0, 0, [])
    for (const [ref, hyp] of bestPairs) mapping[hyp] = ref
    return { mapping, score: bestScore }
  }

  let bestScore = -Infinity
  let bestPairs = []
  const used = new Set()
  function rec(hi, score, pairs) {
    if (hi === hypLabels.length) {
      if (score > bestScore) { bestScore = score; bestPairs = pairs.slice() }
      return
    }
    for (let ri = 0; ri < refLabels.length; ri++) {
      if (used.has(ri)) continue
      used.add(ri)
      pairs.push([refLabels[ri], hypLabels[hi]])
      rec(hi + 1, score + matrix[ri][hi], pairs)
      pairs.pop()
      used.delete(ri)
    }
  }
  rec(0, 0, [])
  for (const [ref, hyp] of bestPairs) mapping[hyp] = ref
  return { mapping, score: bestScore }
}

function activeLabelsAt(segments, t) {
  const active = []
  for (const s of segments) {
    if (s.start <= t && t < s.end) active.push(s.speaker)
  }
  return active
}

function scoreDiarization(refSegments, hypSegments, frameMs) {
  const frame = frameMs / 1000
  const refLabels = labels(refSegments)
  const hypLabels = labels(hypSegments)
  const matrix = buildOverlapMatrix(refSegments, hypSegments, refLabels, hypLabels)
  const assignment = bestAssignment(refLabels, hypLabels, matrix)
  const maxEnd = Math.max(0, ...refSegments.map((s) => s.end), ...hypSegments.map((s) => s.end))

  let refSpeakerTime = 0
  let hypSpeakerTime = 0
  let correct = 0
  let confusion = 0
  let missed = 0
  let falseAlarm = 0

  for (let t = 0; t < maxEnd; t += frame) {
    const mid = t + frame / 2
    const refSet = new Set(activeLabelsAt(refSegments, mid))
    const hypActive = activeLabelsAt(hypSegments, mid)
    const mappedActive = []
    let unmatchedHyp = 0
    for (const hyp of hypActive) {
      const mapped = assignment.mapping[hyp]
      if (mapped) mappedActive.push(mapped)
      else unmatchedHyp += 1
    }
    const mappedSet = new Set(mappedActive)
    let frameCorrect = 0
    for (const ref of refSet) if (mappedSet.has(ref)) frameCorrect += 1

    const refN = refSet.size
    const assignedN = mappedSet.size
    const frameConfusion = Math.min(Math.max(0, refN - frameCorrect), Math.max(0, assignedN - frameCorrect))
    const frameMissed = Math.max(0, refN - frameCorrect - frameConfusion)
    const frameFalse = unmatchedHyp + Math.max(0, assignedN - frameCorrect - frameConfusion)

    refSpeakerTime += refN * frame
    hypSpeakerTime += hypActive.length * frame
    correct += frameCorrect * frame
    confusion += frameConfusion * frame
    missed += frameMissed * frame
    falseAlarm += frameFalse * frame
  }

  const totalError = missed + falseAlarm + confusion
  return {
    frameMs,
    refSpeakerCount: refLabels.length,
    hypSpeakerCount: hypLabels.length,
    refSegmentCount: refSegments.length,
    hypSegmentCount: hypSegments.length,
    refSpeakerTime: round(refSpeakerTime),
    hypSpeakerTime: round(hypSpeakerTime),
    correct: round(correct),
    missed: round(missed),
    falseAlarm: round(falseAlarm),
    confusion: round(confusion),
    totalError: round(totalError),
    der: refSpeakerTime > 0 ? round(totalError / refSpeakerTime) : null,
    derPercent: refSpeakerTime > 0 ? round((100 * totalError) / refSpeakerTime) : null,
    assignment: assignment.mapping,
    assignmentOverlap: round(assignment.score),
  }
}

function round(n) {
  return Math.round(n * 10000) / 10000
}

const args = parseArgs(process.argv)
const reference = normalizeSegments(readJson(args.reference), 'reference')
const hypothesisValue = readJson(args.hypothesis)
const hypotheses = extractHypotheses(hypothesisValue)
const results = hypotheses.map((h) => ({
  label: h.label,
  metadata: h.metadata,
  score: scoreDiarization(reference, h.segments, args.frameMs),
}))
const output = {
  reference: path.resolve(args.reference),
  hypothesis: path.resolve(args.hypothesis),
  frameMs: args.frameMs,
  results,
}
const rendered = JSON.stringify(output, null, 2)
if (args.out) {
  fs.mkdirSync(path.dirname(args.out), { recursive: true })
  fs.writeFileSync(args.out, rendered)
}
console.log(rendered)
