import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'cpwer.mjs'
)

test('oracle cpWER measures speaker attribution while WER stays zero', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpwer-test-'))
    try {
        const wordsRoot = path.join(root, 'words')
        fs.mkdirSync(wordsRoot)
        fs.writeFileSync(
            path.join(wordsRoot, 'M1.A.words.xml'),
            '<w starttime="0" endtime="1">hello</w><w starttime="2" endtime="3">again</w>'
        )
        fs.writeFileSync(
            path.join(wordsRoot, 'M1.B.words.xml'),
            '<w starttime="1" endtime="2">there</w><w starttime="3" endtime="4">friend</w>'
        )
        const diarizationPath = path.join(root, 'diarization.json')
        fs.writeFileSync(
            diarizationPath,
            JSON.stringify({
                segments: [
                    { start: 0, end: 1, speaker: 0 },
                    { start: 1, end: 2, speaker: 1 },
                    { start: 2, end: 4, speaker: 0 },
                ],
            })
        )
        const result = spawnSync(
            process.execPath,
            [
                SCRIPT,
                '--diarization',
                diarizationPath,
                '--meeting',
                'M1',
                '--words-root',
                wordsRoot,
            ],
            {
                encoding: 'utf8',
                env: { ...process.env, BENCHMARK_ALLOWED_ROOTS: root },
            }
        )
        assert.equal(result.status, 0, result.stderr)
        const score = JSON.parse(result.stdout)
        assert.equal(score.wer, 0)
        assert.equal(score.cpwer, 0.5)
    } finally {
        fs.rmSync(root, { recursive: true, force: true })
    }
})
