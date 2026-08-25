import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAmiRttm, parseAmiWordsXml } from './ami-reference.mjs'

test('parseAmiRttm clips official segments to a benchmark window', () => {
    const rttm = [
        'SPEAKER M1 1 8.0 4.0 <NA> <NA> A <NA> <NA>',
        'SPEAKER M1 1 11.0 2.0 <NA> <NA> B <NA> <NA>',
        'SPEAKER M1 1 19.0 3.0 <NA> <NA> A <NA> <NA>',
        'SPEAKER OTHER 1 10.0 2.0 <NA> <NA> X <NA> <NA>',
    ].join('\n')

    assert.deepEqual(parseAmiRttm(rttm, 'M1', 10, 20), [
        { start: 0, end: 2, speaker: 'A' },
        { start: 1, end: 3, speaker: 'B' },
        { start: 9, end: 10, speaker: 'A' },
    ])
})

test('parseAmiWordsXml excludes punctuation and clips timestamps', () => {
    const xml = [
        '<w starttime="9.5" endtime="10.5">Hello</w>',
        '<w starttime="10.5" endtime="10.5" punc="true">.</w>',
        '<w starttime="11" endtime="12">Arthur&apos;s</w>',
    ].join('\n')

    assert.deepEqual(parseAmiWordsXml(xml, 'A', 10, 20), [
        { word: 'Hello', start: 0, end: 0.5, speaker: 'A' },
        { word: "Arthur's", start: 1, end: 2, speaker: 'A' },
    ])
})
