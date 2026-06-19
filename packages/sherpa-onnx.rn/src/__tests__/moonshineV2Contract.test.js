/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('node:fs');
const path = require('node:path');

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
    expect(read('ios/handlers/SherpaOnnxASRHandler.swift')).toContain(
      'mergedDecoder: (modelDir as NSString).appendingPathComponent(mergedDecoderFile)'
    );
    expect(read('src/web/features/asr.ts')).toContain('mf?.mergedDecoder');
  });
});
