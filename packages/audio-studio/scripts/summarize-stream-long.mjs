#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
    const out = { format: 'markdown', files: [] }
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i]
        if (arg === '--json') out.format = 'json'
        else if (arg === '--csv') out.format = 'csv'
        else if (arg === '--markdown' || arg === '--md') out.format = 'markdown'
        else if (arg === '--help' || arg === '-h') {
            printHelp()
            process.exit(0)
        } else {
            out.files.push(arg)
        }
    }
    if (out.files.length === 0) {
        throw new Error('Provide one or more validate:stream-long JSONL log files')
    }
    return out
}

function printHelp() {
    console.log(`Usage: yarn summarize:stream-long [--markdown|--csv|--json] <log.jsonl> [...logs]

Summarizes validate:stream-long JSONL logs for backend benchmarking.
Reports final status, processed audio, wall time, chunks, transcript size,
Sherpa segment count, peak memory, final memory, and error/stall reason.`)
}

function readJsonl(file) {
    return fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line, index) => {
            try {
                return JSON.parse(line)
            } catch (error) {
                throw new Error(`${file}:${index + 1}: ${String(error)}`)
            }
        })
}

function maxNumber(values) {
    const finite = values.filter((value) => Number.isFinite(value))
    return finite.length ? Math.max(...finite) : undefined
}

function getMemoryEvents(events) {
    return events
        .map((event) => event.memory)
        .filter((memory) => memory && typeof memory === 'object')
}

function summarize(file) {
    const events = readJsonl(file)
    const start = events.find((event) => event.event === 'start')
    const final = [...events].reverse().find((event) => event.event === 'final')
    const error = [...events].reverse().find((event) => event.event === 'error')
    const budgetExceeded = [...events]
        .reverse()
        .find((event) => event.event === 'budget-exceeded')
    const stalled = [...events]
        .reverse()
        .find((event) => event.event === 'progress-stalled')
    const terminal = final?.result?.result ?? final?.result ?? null
    const progressEvents = events.filter((event) => event.progress)
    const lastProgress = [...progressEvents].reverse()[0]?.progress
    const progress = terminal ?? lastProgress ?? {}
    const memoryEvents = getMemoryEvents(events)
    const finalMemory = final?.memory ?? [...memoryEvents].reverse()[0] ?? {}
    const peakTotalPssKb = maxNumber(memoryEvents.map((m) => m.totalPssKb))
    const peakNativeHeapKb = maxNumber(memoryEvents.map((m) => m.nativeHeapKb))
    const startedAt = start?.at ? Date.parse(start.at) : undefined
    const endedAt = (final ?? error ?? stalled ?? budgetExceeded)?.at
        ? Date.parse((final ?? error ?? stalled ?? budgetExceeded).at)
        : undefined
    const wallMsFromLog =
        Number.isFinite(startedAt) && Number.isFinite(endedAt)
            ? endedAt - startedAt
            : undefined

    return {
        file,
        name: path.basename(file),
        status: final?.result?.status ?? error?.event ?? stalled?.event ?? budgetExceeded?.event ?? progress.status ?? 'unknown',
        mode: start?.mode ?? progress.mode,
        modelId: progress.modelId,
        fixture: start?.fixture,
        startTimeMs: start?.startTimeMs,
        endTimeMs: start?.endTimeMs,
        durationMs: progress.durationMs ?? progress.audio?.durationMs,
        processedAudioMs: progress.processedAudioMs,
        progress: progress.progress,
        chunks: progress.chunkCount ?? progress.audio?.chunks,
        samples: progress.sampleCount ?? progress.audio?.samples,
        sampleRate: progress.sampleRate ?? progress.audio?.sampleRate,
        transcriptChars:
            progress.transcriptCharCount ?? progress.sherpa?.transcriptCharCount,
        transcriptLines: progress.transcriptLineCount,
        transcriptEvents: progress.transcriptEventCount,
        sherpaSegmentCount: progress.sherpaSegmentCount,
        sherpaReleaseBetweenSegments: progress.sherpaReleaseBetweenSegments,
        elapsedWallMs: progress.elapsedWallMs ?? wallMsFromLog,
        logWallMs: wallMsFromLog,
        peakTotalPssKb,
        peakNativeHeapKb,
        finalTotalPssKb: finalMemory.totalPssKb,
        finalNativeHeapKb: finalMemory.nativeHeapKb,
        error: error?.error ?? stalled?.reason ?? budgetExceeded?.reason,
    }
}

function formatMs(ms) {
    if (!Number.isFinite(ms)) return ''
    if (ms < 1000) return `${ms}ms`
    const seconds = ms / 1000
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const minutes = Math.floor(seconds / 60)
    const rest = Math.round(seconds % 60)
    return `${minutes}m${String(rest).padStart(2, '0')}s`
}

function formatKb(kb) {
    if (!Number.isFinite(kb)) return ''
    return `${(kb / 1024).toFixed(1)}MB`
}

function formatPercent(value) {
    if (!Number.isFinite(value)) return ''
    return `${(value * 100).toFixed(1)}%`
}

function markdown(rows) {
    const headers = [
        'log',
        'status',
        'mode',
        'model',
        'audio',
        'wall',
        'chunks',
        'segments',
        'chars',
        'peak PSS',
        'peak native',
        'final PSS',
        'error',
    ]
    const lines = [
        `| ${headers.join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
    ]
    for (const row of rows) {
        lines.push(
            `| ${[
                row.name,
                row.status,
                row.mode ?? '',
                row.modelId ?? '',
                formatMs(row.durationMs ?? row.processedAudioMs),
                formatMs(row.elapsedWallMs ?? row.logWallMs),
                row.chunks ?? '',
                row.sherpaSegmentCount ?? '',
                row.transcriptChars ?? '',
                formatKb(row.peakTotalPssKb),
                formatKb(row.peakNativeHeapKb),
                formatKb(row.finalTotalPssKb),
                row.error ?? '',
            ]
                .map((cell) => String(cell).replace(/\|/g, '\\|'))
                .join(' | ')} |`,
        )
    }
    return lines.join('\n')
}

function csv(rows) {
    const headers = Object.keys(rows[0] ?? {})
    const escape = (value) => {
        const string = value == null ? '' : String(value)
        return /[",\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string
    }
    return [headers.join(','), ...rows.map((row) => headers.map((key) => escape(row[key])).join(','))].join('\n')
}

try {
    const options = parseArgs(process.argv.slice(2))
    const rows = options.files.map(summarize)
    if (options.format === 'json') console.log(JSON.stringify(rows, null, 2))
    else if (options.format === 'csv') console.log(csv(rows))
    else console.log(markdown(rows))
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
