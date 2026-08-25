import assert from 'node:assert/strict'
import test from 'node:test'
import { getMoonshineIntentFiles } from './moonshineIntentModelFiles'

test('uses the ORT-format files required by Moonshine 0.1.5', () => {
    assert.deepEqual(getMoonshineIntentFiles('q4'), [
        'model_q4.ort',
        'tokenizer.bin',
    ])
    assert.deepEqual(getMoonshineIntentFiles('q8'), [
        'model_quantized.ort',
        'tokenizer.bin',
    ])
})

test('rejects removed embedding model variants', () => {
    assert.throws(
        () => getMoonshineIntentFiles('fp32'),
        /Unsupported Moonshine intent model variant: fp32/
    )
})
