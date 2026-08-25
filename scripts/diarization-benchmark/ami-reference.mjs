import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const AMI_DIARIZATION_SETUP_COMMIT =
    '2509d8933721023fab4def2618aabd5c28eb82e9'

const AMI_SETUP_RAW_ROOT =
    `https://raw.githubusercontent.com/BUTSpeechFIT/AMI-diarization-setup/` +
    AMI_DIARIZATION_SETUP_COMMIT
const SPLITS = ['train', 'dev', 'test']

export function parseAmiRttm(text, meetingId, startS, endS) {
    const durationS = endS - startS
    return text
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .filter(
            (fields) =>
                fields.length >= 8 &&
                fields[0] === 'SPEAKER' &&
                fields[1] === meetingId
        )
        .map((fields) => ({
            sourceStart: Number(fields[3]),
            sourceEnd: Number(fields[3]) + Number(fields[4]),
            speaker: fields[7],
        }))
        .filter(
            (segment) =>
                Number.isFinite(segment.sourceStart) &&
                Number.isFinite(segment.sourceEnd) &&
                segment.sourceStart < endS &&
                segment.sourceEnd > startS
        )
        .map((segment) => ({
            start: Math.max(0, segment.sourceStart - startS),
            end: Math.min(durationS, segment.sourceEnd - startS),
            speaker: segment.speaker,
        }))
        .sort((a, b) => a.start - b.start || a.end - b.end)
}

function decodeXmlText(value) {
    return value
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
}

export function parseAmiWordsXml(text, speaker, startS, endS) {
    const words = []
    const wordRegex = /<w\b([^>]*)>([^<]*)<\/w>/g
    let match = null
    while ((match = wordRegex.exec(text))) {
        const attributes = match[1]
        if (/\bpunc="true"/.test(attributes)) continue
        const startMatch = attributes.match(/starttime="([^"]+)"/)
        const endMatch = attributes.match(/endtime="([^"]+)"/)
        if (!startMatch || !endMatch) continue
        const sourceStart = Number(startMatch[1])
        const sourceEnd = Number(endMatch[1])
        if (
            !Number.isFinite(sourceStart) ||
            !Number.isFinite(sourceEnd) ||
            sourceStart >= endS ||
            sourceEnd <= startS
        ) {
            continue
        }
        const word = decodeXmlText(match[2]).trim()
        if (!word) continue
        words.push({
            word,
            start: Math.max(0, sourceStart - startS),
            end: Math.min(endS - startS, sourceEnd - startS),
            speaker,
        })
    }
    return words
}

export function loadAmiWords({ meetingId, startS, endS, wordsRoot }) {
    if (!wordsRoot) throw new Error('AMI words root is required')
    const files = fs
        .readdirSync(wordsRoot)
        .filter(
            (name) =>
                name.startsWith(`${meetingId}.`) && name.endsWith('.words.xml')
        )
        .sort()
    if (files.length === 0) {
        throw new Error(
            `No AMI word annotations for ${meetingId} in ${wordsRoot}`
        )
    }
    return files
        .flatMap((name) =>
            parseAmiWordsXml(
                fs.readFileSync(path.join(wordsRoot, name), 'utf8'),
                name.split('.')[1],
                startS,
                endS
            )
        )
        .sort((a, b) => a.start - b.start || a.end - b.end)
}

function findLocalRttm(rttmRoot, meetingId) {
    if (!rttmRoot) return null
    const candidates = [
        path.join(rttmRoot, `${meetingId}.rttm`),
        ...SPLITS.map((split) =>
            path.join(rttmRoot, split, `${meetingId}.rttm`)
        ),
    ]
    return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function downloadOfficialRttm(meetingId, cacheDir) {
    fs.mkdirSync(cacheDir, { recursive: true })
    for (const split of SPLITS) {
        const url =
            `${AMI_SETUP_RAW_ROOT}/only_words/rttms/${split}/` +
            `${meetingId}.rttm`
        const destination = path.join(cacheDir, `${meetingId}.rttm`)
        const result = spawnSync('curl', ['-fsSL', url, '-o', destination], {
            encoding: 'utf8',
        })
        if (result.status === 0) {
            return { path: destination, split, url }
        }
        fs.rmSync(destination, { force: true })
    }
    throw new Error(`Official AMI RTTM not found for ${meetingId}`)
}

export function loadOfficialAmiReference({
    meetingId,
    startS,
    endS,
    cacheDir,
    rttmRoot = '',
}) {
    const localPath = findLocalRttm(rttmRoot, meetingId)
    const source = localPath
        ? { path: localPath, split: null, url: null }
        : downloadOfficialRttm(meetingId, cacheDir)
    const segments = parseAmiRttm(
        fs.readFileSync(source.path, 'utf8'),
        meetingId,
        startS,
        endS
    )
    if (segments.length === 0) {
        throw new Error(
            `Official AMI reference has no speech for ${meetingId} ${startS}-${endS}`
        )
    }
    return {
        segments,
        source: source.path,
        sourceUrl: source.url,
        split: source.split,
        setupCommit: AMI_DIARIZATION_SETUP_COMMIT,
        setup: 'BUTSpeechFIT/AMI-diarization-setup only_words',
    }
}
