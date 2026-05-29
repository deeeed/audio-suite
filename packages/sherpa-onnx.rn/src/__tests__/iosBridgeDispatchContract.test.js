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

function methodBlock(methodName) {
  const start = source.search(new RegExp(`RCT_EXPORT_METHOD\\(${methodName}\\b`));
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source
    .slice(start + 1)
    .search(/\n\s*RCT_EXPORT_METHOD\(/);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

describe('iOS SherpaOnnx bridge dispatch contract', () => {
  it('does not force exported methods onto the main queue', () => {
    expect(source).not.toMatch(
      /-\s*\(dispatch_queue_t\)methodQueue\s*\{\s*return\s+dispatch_get_main_queue\(\)/s
    );
  });

  it('keeps all inference-capable exported methods on per-handler serial queues', () => {
    const intentionallyUnwrapped = new Set([
      'validateLibraryLoaded',
      'testOnnxIntegration',
      'getArchitectureInfo',
      'getSystemInfo',
      'extractTarBz2',
    ]);

    expect(methodNames).toHaveLength(60);

    for (const methodName of methodNames) {
      const hasDispatch = methodBlock(methodName).includes('dispatch_async(');
      expect({ methodName, hasDispatch }).toEqual({
        methodName,
        hasDispatch: !intentionallyUnwrapped.has(methodName),
      });
    }
  });

  it('uses dedicated serial queues for ASR, TTS, AudioTagging, and SpeakerID', () => {
    const expectedQueues = {
      asrSerialQueue: 10,
      ttsSerialQueue: 4,
      audioTaggingSerialQueue: 4,
      speakerIdSerialQueue: 12,
    };

    for (const [queueName, expectedWraps] of Object.entries(expectedQueues)) {
      expect(source).toContain(`dispatch_queue_create("com.sherpaonnx.${
        queueName === 'audioTaggingSerialQueue'
          ? 'audiotagging'
          : queueName.replace('SerialQueue', '').toLowerCase()
      }", DISPATCH_QUEUE_SERIAL)`);
      expect((source.match(new RegExp(`dispatch_async\\(${queueName}\\(\\),`, 'g')) || [])).toHaveLength(
        expectedWraps
      );
    }
  });
});
