import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
    resolveAllowedExistingPath,
    resolveAllowedOutputPath,
} from './path-policy.mjs'

test('path policy accepts canonical paths inside a trusted root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'path-policy-'))
    try {
        const file = path.join(root, 'input.json')
        fs.writeFileSync(file, '{}')
        const canonicalRoot = fs.realpathSync(root)
        assert.equal(
            resolveAllowedExistingPath(file, [root]),
            path.join(canonicalRoot, 'input.json')
        )
        assert.equal(
            resolveAllowedOutputPath(path.join(root, 'out.json'), [root]),
            path.join(canonicalRoot, 'out.json')
        )
    } finally {
        fs.rmSync(root, { recursive: true, force: true })
    }
})

test('path policy rejects traversal outside a trusted root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'path-policy-'))
    try {
        assert.throws(
            () => resolveAllowedExistingPath('/etc/hosts', [root]),
            /outside benchmark roots/
        )
        assert.throws(
            () => resolveAllowedOutputPath('/etc/audiolab-output.json', [root]),
            /outside benchmark roots/
        )
    } finally {
        fs.rmSync(root, { recursive: true, force: true })
    }
})
