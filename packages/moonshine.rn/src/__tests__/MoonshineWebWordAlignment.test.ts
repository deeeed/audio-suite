import { alignWordsFromCrossAttention } from '../web/wordAlignment';

function createFakeTokenizer(): {
  decode(
    tokenIds: number[],
    addBosToken?: boolean,
    addPrecedingSpace?: boolean
  ): string;
  vocabById: string[];
} {
  const vocabById: string[] = [];
  vocabById[1] = '<s>';
  vocabById[2] = '</s>';
  vocabById[10] = '▁Hello';
  vocabById[11] = '▁world';

  return {
    decode(tokenIds: number[]) {
      return tokenIds
        .map((tokenId) => vocabById[tokenId] ?? '')
        .join('')
        .replaceAll('▁', ' ');
    },
    vocabById,
  };
}

describe('alignWordsFromCrossAttention', () => {
  it('creates monotonic per-word timings from cross-attention weights', () => {
    const tokenizer = createFakeTokenizer();
    const crossAttention = new Float32Array([
      12, 12, 12, 8, 1, 0, 0, 0, 0, 0, 1, 2, 8, 12, 12, 12,
    ]);

    const words = alignWordsFromCrossAttention(
      crossAttention,
      1,
      1,
      2,
      8,
      [1, 10, 11, 2],
      0.125,
      tokenizer
    );

    expect(words).toHaveLength(2);
    expect(words[0]?.word).toBe('Hello');
    expect(words[1]?.word).toBe('world');
    expect(words[0]?.startTimeMs).toBeLessThan(words[0]?.endTimeMs ?? 0);
    expect(words[0]?.endTimeMs).toBeLessThanOrEqual(words[1]?.startTimeMs ?? 0);
    expect(words[1]?.endTimeMs).toBeGreaterThan(words[0]?.endTimeMs ?? 0);
  });
});
