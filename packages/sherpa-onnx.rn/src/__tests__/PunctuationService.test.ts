import { PunctuationService } from '../services/PunctuationService';
import type { ApiInterface } from '../types/api';

function createMockApi(): jest.Mocked<Pick<ApiInterface, 'validateLibraryLoaded' | 'initPunctuation' | 'addPunctuation' | 'releasePunctuation'>> {
  return {
    validateLibraryLoaded: jest.fn().mockResolvedValue({ loaded: true, status: 'ok' }),
    initPunctuation: jest.fn().mockResolvedValue({ success: true }),
    addPunctuation: jest.fn().mockResolvedValue({ success: true, text: 'Hello.', durationMs: 1 }),
    releasePunctuation: jest.fn().mockResolvedValue({ released: true }),
  };
}

describe('PunctuationService', () => {
  it('forwards `model` to the native bridge when set (offline CT-Transformer path)', async () => {
    const api = createMockApi();
    const service = new PunctuationService(api as unknown as ApiInterface);

    await service.init({
      modelDir: '/tmp/punct-models/ct-transformer',
      model: 'model.int8.onnx',
    });

    expect(api.initPunctuation).toHaveBeenCalledTimes(1);
    const forwarded = api.initPunctuation.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(forwarded.model).toBe('model.int8.onnx');
    expect(forwarded.modelDir).toBe('/tmp/punct-models/ct-transformer');
  });

  it('omits `model` from the native config when not provided (online CNN-BiLSTM path)', async () => {
    const api = createMockApi();
    const service = new PunctuationService(api as unknown as ApiInterface);

    await service.init({
      modelDir: '/tmp/punct-models/cnn-bilstm',
      cnnBilstm: 'model.onnx',
      bpeVocab: 'bpe.vocab',
    });

    expect(api.initPunctuation).toHaveBeenCalledTimes(1);
    const forwarded = api.initPunctuation.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect('model' in forwarded).toBe(false);
    expect(forwarded.cnnBilstm).toBe('model.onnx');
    expect(forwarded.bpeVocab).toBe('bpe.vocab');
  });
});
