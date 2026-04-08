import type { MoonshineLineWordTiming } from '../types/interfaces';

type SentencepieceTokenizer = {
  decode(
    tokenIds: number[],
    addBosToken?: boolean,
    addPrecedingSpace?: boolean
  ): string;
  vocabById: string[];
};

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function medianFilter(
  data: Float32Array,
  channels: number,
  height: number,
  width: number,
  filterWidth: number
): Float32Array {
  if (filterWidth <= 1) {
    return data;
  }

  const normalizedFilterWidth =
    filterWidth % 2 === 0 ? filterWidth + 1 : filterWidth;
  const pad = Math.floor(normalizedFilterWidth / 2);
  const result = new Float32Array(data);
  const padded = new Array<number>(width + pad * 2).fill(0);
  const window = new Array<number>(normalizedFilterWidth).fill(0);

  for (let channel = 0; channel < channels; channel += 1) {
    for (let row = 0; row < height; row += 1) {
      const rowOffset = (channel * height + row) * width;

      for (let index = 0; index < pad; index += 1) {
        const sourceIndex = Math.min(width - 1, Math.max(0, pad - index));
        padded[index] = data[rowOffset + sourceIndex] ?? 0;
      }

      for (let index = 0; index < width; index += 1) {
        padded[pad + index] = data[rowOffset + index] ?? 0;
      }

      for (let index = 0; index < pad; index += 1) {
        const sourceIndex = Math.max(0, width - 2 - index);
        padded[pad + width + index] = data[rowOffset + sourceIndex] ?? 0;
      }

      for (let column = 0; column < width; column += 1) {
        for (
          let filterIndex = 0;
          filterIndex < normalizedFilterWidth;
          filterIndex += 1
        ) {
          window[filterIndex] = padded[column + filterIndex] ?? 0;
        }
        result[rowOffset + column] = computeMedian(window);
      }
    }
  }

  return result;
}

function dtw(
  costMatrix: Float32Array,
  textLength: number,
  timeLength: number
): { textIndices: number[]; timeIndices: number[] } {
  const cumulative = new Float32Array((textLength + 1) * (timeLength + 1));
  cumulative.fill(Number.POSITIVE_INFINITY);
  cumulative[0] = 0;

  const trace = new Int32Array(textLength * timeLength);

  for (let textIndex = 0; textIndex < textLength; textIndex += 1) {
    for (let timeIndex = 0; timeIndex < timeLength; timeIndex += 1) {
      const diagonal =
        cumulative[textIndex * (timeLength + 1) + timeIndex] ??
        Number.POSITIVE_INFINITY;
      const vertical =
        cumulative[textIndex * (timeLength + 1) + (timeIndex + 1)] ??
        Number.POSITIVE_INFINITY;
      const horizontal =
        cumulative[(textIndex + 1) * (timeLength + 1) + timeIndex] ??
        Number.POSITIVE_INFINITY;

      let direction = 0;
      let minValue = diagonal;
      if (vertical <= minValue && vertical <= horizontal) {
        direction = 1;
        minValue = vertical;
      } else if (horizontal < minValue) {
        direction = 2;
        minValue = horizontal;
      }

      trace[textIndex * timeLength + timeIndex] = direction;
      cumulative[(textIndex + 1) * (timeLength + 1) + (timeIndex + 1)] =
        (costMatrix[textIndex * timeLength + timeIndex] ?? 0) + minValue;
    }
  }

  let textIndex = textLength - 1;
  let timeIndex = timeLength - 1;
  const reversedTextIndices: number[] = [];
  const reversedTimeIndices: number[] = [];

  while (textIndex >= 0 || timeIndex >= 0) {
    reversedTextIndices.push(textIndex);
    reversedTimeIndices.push(timeIndex);

    if (textIndex === 0 && timeIndex === 0) {
      break;
    }

    const direction = trace[textIndex * timeLength + timeIndex] ?? 0;
    if (direction === 0) {
      textIndex -= 1;
      timeIndex -= 1;
    } else if (direction === 1) {
      textIndex -= 1;
    } else {
      timeIndex -= 1;
    }
  }

  return {
    textIndices: reversedTextIndices.reverse(),
    timeIndices: reversedTimeIndices.reverse(),
  };
}

function tokenStartsNewWord(
  tokenizer: SentencepieceTokenizer,
  tokenId: number
): boolean {
  const token = tokenizer.vocabById[tokenId];
  return typeof token === 'string' && token.startsWith('▁');
}

function decodeTokens(
  tokenizer: SentencepieceTokenizer,
  tokenIds: number[]
): string {
  return tokenizer.decode(tokenIds, false, false);
}

export function alignWordsFromCrossAttention(
  crossAttentionData: Float32Array,
  numLayers: number,
  numHeads: number,
  numTokens: number,
  encoderFrames: number,
  tokens: number[],
  timePerFrame: number,
  tokenizer: SentencepieceTokenizer
): MoonshineLineWordTiming[] {
  if (
    crossAttentionData.length === 0 ||
    numLayers <= 0 ||
    numHeads <= 0 ||
    numTokens <= 0 ||
    encoderFrames <= 0 ||
    tokens.length < 2
  ) {
    return [];
  }

  const totalHeads = numLayers * numHeads;
  const normalizedWeights = new Float32Array(crossAttentionData);

  for (let headIndex = 0; headIndex < totalHeads; headIndex += 1) {
    for (let tokenIndex = 0; tokenIndex < numTokens; tokenIndex += 1) {
      const offset = (headIndex * numTokens + tokenIndex) * encoderFrames;
      let sum = 0;
      for (let frameIndex = 0; frameIndex < encoderFrames; frameIndex += 1) {
        sum += normalizedWeights[offset + frameIndex] ?? 0;
      }
      const mean = sum / encoderFrames;

      let squaredSum = 0;
      for (let frameIndex = 0; frameIndex < encoderFrames; frameIndex += 1) {
        const value = normalizedWeights[offset + frameIndex] ?? 0;
        const delta = value - mean;
        squaredSum += delta * delta;
      }
      const stdDev = Math.sqrt(squaredSum / encoderFrames) || 1e-10;

      for (let frameIndex = 0; frameIndex < encoderFrames; frameIndex += 1) {
        normalizedWeights[offset + frameIndex] =
          ((normalizedWeights[offset + frameIndex] ?? 0) - mean) / stdDev;
      }
    }
  }

  const filteredWeights = medianFilter(
    normalizedWeights,
    totalHeads,
    numTokens,
    encoderFrames,
    7
  );

  const averagedMatrix = new Float32Array(numTokens * encoderFrames);
  for (let headIndex = 0; headIndex < totalHeads; headIndex += 1) {
    for (let tokenIndex = 0; tokenIndex < numTokens; tokenIndex += 1) {
      const sourceOffset = (headIndex * numTokens + tokenIndex) * encoderFrames;
      const targetOffset = tokenIndex * encoderFrames;
      for (let frameIndex = 0; frameIndex < encoderFrames; frameIndex += 1) {
        const currentValue = averagedMatrix[targetOffset + frameIndex] ?? 0;
        const nextValue = filteredWeights[sourceOffset + frameIndex] ?? 0;
        averagedMatrix[targetOffset + frameIndex] = currentValue + nextValue;
      }
    }
  }

  const inverseHeadCount = 1 / totalHeads;
  for (let index = 0; index < averagedMatrix.length; index += 1) {
    const currentValue = averagedMatrix[index] ?? 0;
    averagedMatrix[index] = currentValue * inverseHeadCount;
  }

  const negatedMatrix = new Float32Array(averagedMatrix.length);
  for (let index = 0; index < averagedMatrix.length; index += 1) {
    negatedMatrix[index] = -(averagedMatrix[index] ?? 0);
  }

  const { textIndices, timeIndices } = dtw(
    negatedMatrix,
    numTokens,
    encoderFrames
  );

  const textTokens =
    tokens.length >= 2 ? tokens.slice(1, Math.max(1, tokens.length - 1)) : [];
  if (textTokens.length === 0) {
    return [];
  }

  const words: Array<{ tokenIds: number[]; stepIndices: number[] }> = [];
  let currentWord: { tokenIds: number[]; stepIndices: number[] } = {
    stepIndices: [],
    tokenIds: [],
  };

  for (let index = 0; index < textTokens.length; index += 1) {
    const tokenId = textTokens[index] ?? 0;
    if (tokenStartsNewWord(tokenizer, tokenId) && currentWord.tokenIds.length) {
      words.push(currentWord);
      currentWord = { stepIndices: [], tokenIds: [] };
    }

    currentWord.tokenIds.push(tokenId);
    currentWord.stepIndices.push(index);
  }

  if (currentWord.tokenIds.length) {
    words.push(currentWord);
  }

  const timings: MoonshineLineWordTiming[] = [];

  for (const word of words) {
    const decoded = decodeTokens(tokenizer, word.tokenIds).trim();
    if (!decoded) {
      continue;
    }

    const stepIndexSet = new Set(word.stepIndices);
    let minFrame = encoderFrames;
    let maxFrame = -1;
    for (let pathIndex = 0; pathIndex < textIndices.length; pathIndex += 1) {
      const alignedTokenIndex = textIndices[pathIndex] ?? -1;
      if (!stepIndexSet.has(alignedTokenIndex)) {
        continue;
      }
      const alignedFrameIndex = timeIndices[pathIndex] ?? -1;
      minFrame = Math.min(minFrame, alignedFrameIndex);
      maxFrame = Math.max(maxFrame, alignedFrameIndex);
    }

    if (maxFrame < 0) {
      continue;
    }

    timings.push({
      confidence: 1,
      endTimeMs: (maxFrame + 1) * timePerFrame * 1000,
      startTimeMs: minFrame * timePerFrame * 1000,
      word: decoded,
    });
  }

  for (let index = 1; index < timings.length; index += 1) {
    const previous = timings[index - 1];
    const current = timings[index];
    if (
      previous?.endTimeMs != null &&
      current?.startTimeMs != null &&
      previous.endTimeMs > current.startTimeMs
    ) {
      const midpoint = (previous.endTimeMs + current.startTimeMs) * 0.5;
      previous.endTimeMs = midpoint;
      current.startTimeMs = midpoint;
    }
  }

  return timings;
}
