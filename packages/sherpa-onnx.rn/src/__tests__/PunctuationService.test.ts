import { PunctuationService } from '../services/PunctuationService';
import type { ApiInterface } from '../types/api';

function createMockApi() {
  return {
    validateLibraryLoaded: jest
      .fn()
      .mockResolvedValue({ loaded: true, status: 'ok' }),
    initPunctuation: jest.fn().mockResolvedValue({ success: true }),
    addPunctuation: jest
      .fn()
      .mockResolvedValue({ success: true, text: 'Hello.', durationMs: 1 }),
    releasePunctuation: jest.fn().mockResolvedValue({ released: true }),
  };
}

describe('PunctuationService', () => {
  it('forwards model for offline CT-Transformer punctuation', async () => {
    const api = createMockApi();
    const service = new PunctuationService(api as unknown as ApiInterface);

    await service.init({
      modelDir: '/models/punctuation',
      model: 'model.int8.onnx',
    });

    expect(api.initPunctuation).toHaveBeenCalledTimes(1);
    expect(api.initPunctuation).toHaveBeenCalledWith(
      expect.objectContaining({
        modelDir: '/models/punctuation',
        model: 'model.int8.onnx',
      })
    );
  });

  it('keeps online CNN-BiLSTM config unchanged when model is absent', async () => {
    const api = createMockApi();
    const service = new PunctuationService(api as unknown as ApiInterface);

    await service.init({
      modelDir: '/models/punctuation',
      cnnBilstm: 'model.onnx',
      bpeVocab: 'bpe.vocab',
    });

    expect(api.initPunctuation).toHaveBeenCalledTimes(1);
    const forwarded = api.initPunctuation.mock.calls[0][0] as Record<string, unknown>;
    expect(forwarded).toMatchObject({
      modelDir: '/models/punctuation',
      cnnBilstm: 'model.onnx',
      bpeVocab: 'bpe.vocab',
    });
    expect(forwarded).not.toHaveProperty('model');
  });
});
