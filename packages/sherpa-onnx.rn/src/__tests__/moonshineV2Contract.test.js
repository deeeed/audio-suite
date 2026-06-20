/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('node:fs');
const path = require('node:path');
const { buildOfflineAsrPlan } = require('../web/features/asr');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');
}

describe('Moonshine v2 bridge contract', () => {
  it('threads modelFiles.mergedDecoder through native and web bridges', () => {
    expect(read('src/types/interfaces.ts')).toContain('mergedDecoder?: string');
    expect(read('src/SherpaOnnxAPI.ts')).toContain('modelFileMergedDecoder');
    expect(read('src/NativeSherpaOnnxSpec.ts')).toContain('modelFileMergedDecoder?: string');
    expect(read('android/src/main/kotlin/net/siteed/sherpaonnx/handlers/ASRHandler.kt')).toContain(
      '"modelFileMergedDecoder" to "mergedDecoder"'
    );
    expect(read('android/src/main/kotlin/net/siteed/sherpaonnx/handlers/ASRHandler.kt')).toContain(
      'if (modelConfig.moonshine.mergedDecoder.isNotBlank())'
    );
    expect(read('ios/handlers/SherpaOnnxASRHandler.swift')).toContain(
      'mergedDecoder: (modelDir as NSString).appendingPathComponent(mergedDecoderFile)'
    );
    expect(read('src/web/features/asr.ts')).toContain('mf?.mergedDecoder');
  });

  it('builds a Moonshine v2 web plan without v1 decoder files', () => {
    const plan = buildOfflineAsrPlan(
      '/models',
      '/fs/moonshine-v2',
      'moonshine',
      {
        modelDir: '/models',
        modelType: 'moonshine',
        modelFiles: {
          encoder: 'encoder_model.ort',
          mergedDecoder: 'decoder_model_merged.ort',
          tokens: 'tokens.txt',
        },
      },
      {
        encoder: 'encoder_model.ort',
        mergedDecoder: 'decoder_model_merged.ort',
        tokens: 'tokens.txt',
      },
      {
        debug: 0,
        numThreads: 1,
        sampleRate: 16000,
        decodingMethod: 'greedy_search',
        maxActivePaths: 4,
      }
    );

    expect(plan.files.map((file) => file.fsPath)).toEqual([
      '/fs/moonshine-v2/tokens.txt',
      '/fs/moonshine-v2/encoder_model.ort',
      '/fs/moonshine-v2/decoder_model_merged.ort',
    ]);
    expect(plan.recognizerConfig.modelConfig.moonshine).toEqual({
      preprocessor: '',
      encoder: '/fs/moonshine-v2/encoder_model.ort',
      uncachedDecoder: '',
      cachedDecoder: '',
      mergedDecoder: '/fs/moonshine-v2/decoder_model_merged.ort',
    });
  });
});
