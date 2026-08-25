#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { loadAmiWords } from './ami-reference.mjs'

function parseArgs(argv) {
    const args = {}
    for (let index = 2; index < argv.length; index += 1) {
        const key = argv[index]
        const value = argv[index + 1]
        if (key === '--diarization') args.diarization = value
        else if (key === '--meeting') args.meetingId = value
        else if (key === '--start') args.startS = Number(value)
        else if (key === '--end') args.endS = Number(value)
        else if (key === '--words-root') args.wordsRoot = value
        else if (key === '--asr-words') args.asrWords = value
        else if (key === '--out') args.out = value
        else throw new Error(`Unknown argument: ${key}`)
        index += 1
    }
    if (!args.diarization || !args.meetingId || !args.wordsRoot) {
        throw new Error(
            '--diarization, --meeting, and --words-root are required'
        )
    }
    args.startS ??= 0
    args.endS ??= Number.POSITIVE_INFINITY
    if (
        !Number.isFinite(args.startS) ||
        !(
            Number.isFinite(args.endS) || args.endS === Number.POSITIVE_INFINITY
        ) ||
        args.endS <= args.startS
    ) {
        throw new Error('--start and --end must define a valid window')
    }
    return args
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function wordTokens(words) {
    return words.flatMap((entry) =>
        normalizeText(entry.word).split(' ').filter(Boolean)
    )
}

function levenshtein(a, b) {
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
    for (let left = 1; left <= a.length; left += 1) {
        const current = [left]
        for (let right = 1; right <= b.length; right += 1) {
            current[right] = Math.min(
                current[right - 1] + 1,
                previous[right] + 1,
                previous[right - 1] + (a[left - 1] === b[right - 1] ? 0 : 1)
            )
        }
        previous = current
    }
    return previous[b.length]
}

function normalizeSegments(value) {
    const raw = Array.isArray(value)
        ? value
        : value?.segments ||
          value?.result?.segments ||
          value?.rows?.[0]?.result?.segments
    if (!Array.isArray(raw))
        throw new Error('Diarization input has no segment array')
    return raw
        .map((segment) => ({
            start: Number(segment.start ?? segment.startTimeSeconds),
            end: Number(segment.end ?? segment.endTimeSeconds),
            speaker: String(segment.speaker ?? segment.speakerId),
        }))
        .filter(
            (segment) =>
                Number.isFinite(segment.start) &&
                Number.isFinite(segment.end) &&
                segment.end > segment.start
        )
        .sort((a, b) => a.start - b.start || a.end - b.end)
}

function loadDiarization(filePath, meetingId) {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (Array.isArray(value?.clips)) {
        const clip = value.clips.find(
            (candidate) => candidate.meetingId === meetingId
        )
        if (!clip) throw new Error(`${filePath} has no ${meetingId} clip`)
        return normalizeSegments(clip)
    }
    return normalizeSegments(value)
}

function loadAsrWords(filePath) {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const raw = value.words || value.wordTimings || value.result?.words
    if (!Array.isArray(raw)) throw new Error('ASR input has no words array')
    return raw
        .map((entry) => ({
            word: entry.word ?? entry.text ?? entry.token,
            start: Number(
                entry.start ?? entry.startTime ?? entry.startTimeSeconds
            ),
            end: Number(entry.end ?? entry.endTime ?? entry.endTimeSeconds),
        }))
        .filter(
            (entry) =>
                normalizeText(entry.word) &&
                Number.isFinite(entry.start) &&
                Number.isFinite(entry.end)
        )
        .sort((a, b) => a.start - b.start || a.end - b.end)
}

function assignSpeaker(word, segments) {
    let bestSpeaker = 'UNKNOWN'
    let bestOverlap = 0
    for (const segment of segments) {
        if (segment.start >= word.end) break
        const overlap =
            Math.min(word.end, segment.end) -
            Math.max(word.start, segment.start)
        if (overlap > bestOverlap) {
            bestOverlap = overlap
            bestSpeaker = segment.speaker
        }
    }
    if (bestOverlap > 0) return bestSpeaker
    const midpoint = (word.start + word.end) / 2
    return (
        segments.find(
            (segment) => segment.start <= midpoint && midpoint < segment.end
        )?.speaker || 'UNKNOWN'
    )
}

function groupTokens(words, speakerKey) {
    const groups = new Map()
    for (const word of words) {
        const speaker = speakerKey(word)
        const tokens = normalizeText(word.word).split(' ').filter(Boolean)
        groups.set(speaker, [...(groups.get(speaker) || []), ...tokens])
    }
    return groups
}

function cpwer(referenceGroups, hypothesisGroups) {
    const references = [...referenceGroups.entries()]
    const hypotheses = [...hypothesisGroups.entries()]
    if (references.length > 20) {
        throw new Error('cpWER scorer supports at most 20 reference speakers')
    }
    const fullMask = (1 << references.length) - 1
    let states = new Map([[0, { errors: 0, mapping: [] }]])

    for (const [hypothesisSpeaker, hypothesisWords] of hypotheses) {
        const next = new Map()
        for (const [mask, state] of states) {
            const candidates = [
                {
                    mask,
                    errors: state.errors + hypothesisWords.length,
                    mapping: [...state.mapping, [hypothesisSpeaker, null]],
                },
            ]
            for (let index = 0; index < references.length; index += 1) {
                if (mask & (1 << index)) continue
                candidates.push({
                    mask: mask | (1 << index),
                    errors:
                        state.errors +
                        levenshtein(references[index][1], hypothesisWords),
                    mapping: [
                        ...state.mapping,
                        [hypothesisSpeaker, references[index][0]],
                    ],
                })
            }
            for (const candidate of candidates) {
                const current = next.get(candidate.mask)
                if (!current || candidate.errors < current.errors) {
                    next.set(candidate.mask, candidate)
                }
            }
        }
        states = next
    }

    let best = null
    for (const [mask, state] of states) {
        let errors = state.errors
        for (let index = 0; index < references.length; index += 1) {
            if (!(mask & (1 << index))) errors += references[index][1].length
        }
        if (!best || errors < best.errors) best = { ...state, errors, mask }
    }
    const referenceWordCount = references.reduce(
        (sum, entry) => sum + entry[1].length,
        0
    )
    return {
        errors: best?.errors ?? referenceWordCount,
        referenceWordCount,
        cpwer:
            referenceWordCount > 0
                ? (best?.errors ?? referenceWordCount) / referenceWordCount
                : null,
        mapping: best?.mapping || [],
        mappedAllReferenceSpeakers: best?.mask === fullMask,
    }
}

function main() {
    const args = parseArgs(process.argv)
    const diarization = loadDiarization(
        path.resolve(args.diarization),
        args.meetingId
    )
    const referenceWords = loadAmiWords({
        meetingId: args.meetingId,
        startS: args.startS,
        endS: args.endS,
        wordsRoot: path.resolve(args.wordsRoot),
    })
    const hypothesisWords = args.asrWords
        ? loadAsrWords(path.resolve(args.asrWords))
        : referenceWords.map(({ word, start, end }) => ({ word, start, end }))
    const attributedWords = hypothesisWords.map((word) => ({
        ...word,
        speaker: assignSpeaker(word, diarization),
    }))
    const referenceTokens = wordTokens(referenceWords)
    const hypothesisTokens = wordTokens(hypothesisWords)
    const wordErrors = levenshtein(referenceTokens, hypothesisTokens)
    const speakerScore = cpwer(
        groupTokens(referenceWords, (word) => word.speaker),
        groupTokens(attributedWords, (word) => word.speaker)
    )
    const output = {
        meetingId: args.meetingId,
        mode: args.asrWords ? 'shared-asr' : 'oracle-words',
        referenceWordCount: referenceTokens.length,
        hypothesisWordCount: hypothesisTokens.length,
        wordErrors,
        wer:
            referenceTokens.length > 0
                ? wordErrors / referenceTokens.length
                : null,
        cpwer: speakerScore.cpwer,
        cpwerErrors: speakerScore.errors,
        referenceSpeakerCount: new Set(
            referenceWords.map((word) => word.speaker)
        ).size,
        hypothesisSpeakerCount: new Set(
            attributedWords.map((word) => word.speaker)
        ).size,
        mapping: speakerScore.mapping,
    }
    const rendered = `${JSON.stringify(output, null, 2)}\n`
    if (args.out) fs.writeFileSync(path.resolve(args.out), rendered)
    else process.stdout.write(rendered)
}

main()
