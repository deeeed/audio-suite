const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(
  __dirname,
  '../../ios/bridge/SherpaOnnxRnModule.mm'
);
const source = fs.readFileSync(modulePath, 'utf8');

const methodNames = Array.from(
  source.matchAll(/RCT_EXPORT_METHOD\((\w+)/g),
  (match) => match[1]
);

const intentionallyUnwrapped = new Set([
  'validateLibraryLoaded',
  'testOnnxIntegration',
  'getArchitectureInfo',
  'getSystemInfo',
  // Archive extraction is delegated to SherpaOnnxArchiveExtractor's completion
  // API and is not one of the synchronous ONNX inference handlers covered by
  // issue #405.
  'extractTarBz2',
]);

const methodsByQueue = {
  asrSerialQueue: [
    'initAsr',
    'recognizeFromSamples',
    'recognizeFromFile',
    'releaseAsr',
    'createAsrOnlineStream',
    'acceptAsrOnlineWaveform',
    'isAsrOnlineEndpoint',
    'getAsrOnlineResult',
    'finishAsrOnlineInput',
    'resetAsrOnlineStream',
  ],
  ttsSerialQueue: ['initTts', 'generateTts', 'stopTts', 'releaseTts'],
  audioTaggingSerialQueue: [
    'initAudioTagging',
    'processAndComputeAudioTagging',
    'processAndComputeAudioSamples',
    'releaseAudioTagging',
  ],
  speakerIdSerialQueue: [
    'initSpeakerId',
    'processSpeakerIdSamples',
    'computeSpeakerEmbedding',
    'resetSpeakerIdStream',
    'registerSpeaker',
    'removeSpeaker',
    'getSpeakers',
    'identifySpeaker',
    'verifySpeaker',
    'processSpeakerIdFile',
    'processSpeakerIdFileWindow',
    'releaseSpeakerId',
  ],
  kwsSerialQueue: [
    'initKws',
    'acceptKwsWaveform',
    'resetKwsStream',
    'releaseKws',
  ],
  vadSerialQueue: ['initVad', 'acceptVadWaveform', 'resetVad', 'releaseVad'],
  langIdSerialQueue: [
    'initLanguageId',
    'detectLanguage',
    'detectLanguageFromFile',
    'releaseLanguageId',
  ],
  punctSerialQueue: ['initPunctuation', 'addPunctuation', 'releasePunctuation'],
  diarizationSerialQueue: [
    'initDiarization',
    'processDiarizationFile',
    'processDiarizationFileWindow',
    'releaseDiarization',
  ],
  denoisingSerialQueue: ['initDenoiser', 'denoiseFile', 'releaseDenoiser'],
  inferenceSerialQueue: [
    'createOnnxSession',
    'runOnnxSession',
    'releaseOnnxSession',
  ],
};

const expectedQueueByMethod = Object.fromEntries(
  Object.entries(methodsByQueue).flatMap(([queueName, methods]) =>
    methods.map((methodName) => [methodName, queueName])
  )
);

const queueLabels = {
  asrSerialQueue: 'com.sherpaonnx.asr',
  ttsSerialQueue: 'com.sherpaonnx.tts',
  audioTaggingSerialQueue: 'com.sherpaonnx.audiotagging',
  speakerIdSerialQueue: 'com.sherpaonnx.speakerid',
  kwsSerialQueue: 'com.sherpaonnx.kws',
  vadSerialQueue: 'com.sherpaonnx.vad',
  langIdSerialQueue: 'com.sherpaonnx.langid',
  punctSerialQueue: 'com.sherpaonnx.punct',
  diarizationSerialQueue: 'com.sherpaonnx.diarization',
  denoisingSerialQueue: 'com.sherpaonnx.denoising',
  inferenceSerialQueue: 'com.sherpaonnx.inference',
};

function methodBlock(methodName) {
  const start = source.search(
    new RegExp(`RCT_EXPORT_METHOD\\(${methodName}\\b`)
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.slice(start + 1).search(/\n\s*RCT_EXPORT_METHOD\(/);
  return next === -1
    ? source.slice(start)
    : source.slice(start, start + 1 + next);
}

function findMatchingBrace(text, openBraceIndex) {
  let depth = 0;

  for (let i = openBraceIndex; i < text.length; i += 1) {
    if (text[i] === '{') {
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  throw new Error(`No matching brace found from index ${openBraceIndex}`);
}

function asyncDispatchRange(methodSource, queueName) {
  const dispatchCall = `dispatch_async(${queueName}(), ^`;
  const start = methodSource.indexOf(dispatchCall);
  expect({ queueName, hasDispatchCall: start !== -1 }).toEqual({
    queueName,
    hasDispatchCall: true,
  });

  const openBrace = methodSource.indexOf('{', start + dispatchCall.length);
  expect(openBrace).toBeGreaterThan(start);

  const closeBrace = findMatchingBrace(methodSource, openBrace);
  return {
    start,
    end: closeBrace + 1,
    body: methodSource.slice(openBrace, closeBrace + 1),
  };
}

describe('iOS SherpaOnnx bridge dispatch contract', () => {
  it('does not force exported methods onto the main queue', () => {
    expect(source).not.toMatch(
      /-\s*\(dispatch_queue_t\)methodQueue\s*\{\s*return\s+dispatch_get_main_queue\(\)/s
    );
  });

  it('classifies every exported method as queue-bound or intentionally unwrapped', () => {
    for (const methodName of methodNames) {
      const hasQueueMapping = Object.hasOwn(expectedQueueByMethod, methodName);
      const isIntentionallyUnwrapped = intentionallyUnwrapped.has(methodName);
      expect({ methodName, hasQueueMapping, isIntentionallyUnwrapped }).toEqual(
        {
          methodName,
          hasQueueMapping: !isIntentionallyUnwrapped,
          isIntentionallyUnwrapped: !hasQueueMapping,
        }
      );
    }
  });

  it('keeps every queue-bound method body, including promise completion, inside its serial queue', () => {
    for (const [methodName, queueName] of Object.entries(
      expectedQueueByMethod
    )) {
      const block = methodBlock(methodName);
      const dispatchRange = asyncDispatchRange(block, queueName);
      const outsideDispatch =
        block.slice(0, dispatchRange.start) + block.slice(dispatchRange.end);

      expect({
        methodName,
        queueName,
        hasPromiseCompletionInsideDispatch: /\b(resolve|reject)\s*\(/.test(
          dispatchRange.body
        ),
        hasPromiseCompletionOutsideDispatch: /\b(resolve|reject)\s*\(/.test(
          outsideDispatch
        ),
      }).toEqual({
        methodName,
        queueName,
        hasPromiseCompletionInsideDispatch: true,
        hasPromiseCompletionOutsideDispatch: false,
      });
    }
  });

  it('uses dedicated serial queues for all synchronous native handler groups', () => {
    for (const [queueName, label] of Object.entries(queueLabels)) {
      expect(source).toContain(
        `dispatch_queue_create("${label}", DISPATCH_QUEUE_SERIAL)`
      );
      expect(
        source.match(new RegExp(`dispatch_async\\(${queueName}\\(\\),`, 'g')) ||
          []
      ).toHaveLength(methodsByQueue[queueName].length);
    }
  });
});
