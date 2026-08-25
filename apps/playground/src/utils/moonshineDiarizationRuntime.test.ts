import assert from 'node:assert/strict'
import test from 'node:test'
import { supportsExternalMoonshineDiarizationModels } from './moonshineDiarizationRuntime'

test('external Moonshine diarization models are Android 0.1.5 only', () => {
    assert.equal(supportsExternalMoonshineDiarizationModels('android'), true)
    assert.equal(supportsExternalMoonshineDiarizationModels('ios'), false)
    assert.equal(supportsExternalMoonshineDiarizationModels('web'), false)
})
