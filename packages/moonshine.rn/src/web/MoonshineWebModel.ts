import llamaTokenizer from 'llama-tokenizer-js';
import { detectMoonshineOnnxRuntimeWasmBasePath } from './config';
import type { WebOrtRuntime, WebOrtSession, WebOrtTensor } from './ort-types';
import type { MoonshineLineWordTiming } from '../types/interfaces';
import { alignWordsFromCrossAttention } from './wordAlignment';

type WebModelShape = {
  headDim: number;
  numKVHeads: number;
  numLayers: number;
};

type LoadedSessions = {
  decoderSession: WebOrtSession;
  encoderSession: WebOrtSession;
  wordTimestampsEnabled: boolean;
  wordTimestampsFailureReason?: string;
};

export type MoonshineWebTranscription = {
  text: string;
  words?: MoonshineLineWordTiming[];
  wordTimestampsEnabled?: boolean;
  wordTimestampsFailureReason?: string;
};

type ModelPathSource = {
  kind: 'path';
  modelBasePath: string;
};

type ModelUrlSource = {
  kind: 'urls';
  decoderUrl: string;
  encoderUrl: string;
};

type WebModelSource = ModelPathSource | ModelUrlSource;

const MODEL_SHAPES: Record<'tiny' | 'base', WebModelShape> = {
  tiny: {
    numLayers: 6,
    numKVHeads: 8,
    headDim: 36,
  },
  base: {
    numLayers: 8,
    numKVHeads: 8,
    headDim: 52,
  },
};

const SESSION_CACHE = new Map<string, Promise<LoadedSessions>>();
const SESSION_OPTIONS = {
  executionProviders: ['wasm'],
};

function requireOrtRuntime(): WebOrtRuntime {
  const runtime = (globalThis as { ort?: WebOrtRuntime }).ort;
  if (!runtime?.InferenceSession || !runtime?.Tensor || !runtime?.env?.wasm) {
    throw new Error(
      'Moonshine web requires window.ort to be loaded before use. Load ort.min.js and configure its wasm path before creating a transcriber.'
    );
  }
  return runtime;
}

function argMax(values: Float32Array): number {
  let bestIndex = 0;
  let bestValue = values[0] ?? Number.NEGATIVE_INFINITY;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index] ?? Number.NEGATIVE_INFINITY;
    if (value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function createBoolTensor(value: boolean): WebOrtTensor {
  const runtime = requireOrtRuntime();
  return new runtime.Tensor('bool', new Uint8Array([value ? 1 : 0]), [1]);
}

function createInt64Tensor(values: number[]): WebOrtTensor {
  const runtime = requireOrtRuntime();
  return new runtime.Tensor('int64', BigInt64Array.from(values.map(BigInt)), [
    1,
    values.length,
  ]);
}

function createAttentionMaskTensor(length: number): WebOrtTensor {
  const runtime = requireOrtRuntime();
  const data = new BigInt64Array(length);
  data.fill(1n);
  return new runtime.Tensor('int64', data, [1, length]);
}

async function readTensorData(tensor: WebOrtTensor): Promise<Float32Array> {
  if (tensor.getData) {
    return (await tensor.getData()) as Float32Array;
  }
  return tensor.data as Float32Array;
}

function getQuantizedBasePath(modelBasePath: string): string {
  return modelBasePath.endsWith('/quantized')
    ? modelBasePath
    : `${modelBasePath}/quantized`;
}

function resolveAttentionDecoderCandidates(
  modelArch: 'tiny' | 'base',
  modelBasePath: string
): string[] {
  const quantizedBasePath = getQuantizedBasePath(modelBasePath);
  const candidates = [
    `${quantizedBasePath}/decoder_with_attention.ort`,
    `${quantizedBasePath}/decoder_with_attention.onnx`,
  ];

  if (modelArch === 'tiny') {
    candidates.push(
      'https://download.moonshine.ai/model/tiny-en/quantized/decoder_with_attention.ort'
    );
  }

  return Array.from(new Set(candidates));
}

async function createSessionFromCandidates(
  runtime: WebOrtRuntime,
  candidates: string[],
  errorsOut: string[]
): Promise<WebOrtSession | null> {
  for (const candidate of candidates) {
    try {
      return await runtime.InferenceSession.create(candidate, SESSION_OPTIONS);
    } catch (error) {
      errorsOut.push(
        `${candidate}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return null;
}

export class MoonshineWebModel {
  private decoderSession: WebOrtSession | null = null;
  private encoderSession: WebOrtSession | null = null;
  private lastLatencyMs: number | undefined;
  private readonly wordTimestampsRequested: boolean;
  private wordTimestampsEnabled = false;
  private wordTimestampsFailureReason?: string;

  public constructor(
    private readonly modelArch: 'tiny' | 'base',
    private readonly source: WebModelSource,
    options: { wordTimestamps?: boolean } = {}
  ) {
    this.wordTimestampsRequested = options.wordTimestamps === true;
  }

  public getLatency(): number | undefined {
    return this.lastLatencyMs;
  }

  public getWordTimestampsFailureReason(): string | undefined {
    return this.wordTimestampsFailureReason;
  }

  public supportsWordTimestamps(): boolean {
    return this.wordTimestampsEnabled;
  }

  public async load(): Promise<void> {
    if (this.encoderSession && this.decoderSession) {
      return;
    }

    const runtime = requireOrtRuntime();
    runtime.env.wasm.wasmPaths = detectMoonshineOnnxRuntimeWasmBasePath();

    let loadedSessions: LoadedSessions;
    if (this.source.kind === 'urls') {
      loadedSessions = {
        decoderSession: await runtime.InferenceSession.create(
          this.source.decoderUrl,
          SESSION_OPTIONS
        ),
        encoderSession: await runtime.InferenceSession.create(
          this.source.encoderUrl,
          SESSION_OPTIONS
        ),
        wordTimestampsEnabled:
          this.wordTimestampsRequested &&
          /attention/i.test(this.source.decoderUrl),
        wordTimestampsFailureReason:
          this.wordTimestampsRequested &&
          !/attention/i.test(this.source.decoderUrl)
            ? 'Word timestamps were requested for a custom decoder URL that does not look attention-enabled.'
            : undefined,
      };
    } else {
      const quantizedBasePath = getQuantizedBasePath(this.source.modelBasePath);
      const modelBasePath = this.source.modelBasePath;
      const cacheKey = `${this.modelArch}::${quantizedBasePath}::wordTimestamps=${this.wordTimestampsRequested ? '1' : '0'}`;

      let sessionsPromise = SESSION_CACHE.get(cacheKey);
      if (!sessionsPromise) {
        sessionsPromise = (async () => {
          const encoderSession = await runtime.InferenceSession.create(
            `${quantizedBasePath}/encoder_model.onnx`,
            SESSION_OPTIONS
          );
          const decoderErrors: string[] = [];
          const attentionDecoderSession = this.wordTimestampsRequested
            ? await createSessionFromCandidates(
                runtime,
                resolveAttentionDecoderCandidates(
                  this.modelArch,
                  modelBasePath
                ),
                decoderErrors
              )
            : null;
          const decoderSession =
            attentionDecoderSession ??
            (await runtime.InferenceSession.create(
              `${quantizedBasePath}/decoder_model_merged.onnx`,
              SESSION_OPTIONS
            ));
          return {
            decoderSession,
            encoderSession,
            wordTimestampsEnabled: attentionDecoderSession != null,
            wordTimestampsFailureReason:
              this.wordTimestampsRequested && attentionDecoderSession == null
                ? decoderErrors.join(' | ') ||
                  'No attention-enabled web decoder was available.'
                : undefined,
          };
        })();
        SESSION_CACHE.set(cacheKey, sessionsPromise);
      }

      loadedSessions = await sessionsPromise;
    }

    this.encoderSession = loadedSessions.encoderSession;
    this.decoderSession = loadedSessions.decoderSession;
    this.wordTimestampsEnabled = loadedSessions.wordTimestampsEnabled;
    this.wordTimestampsFailureReason =
      loadedSessions.wordTimestampsFailureReason;
  }

  public async transcribe(audio: Float32Array): Promise<string> {
    const result = await this.transcribeDetailed(audio);
    return result.text;
  }

  public async transcribeDetailed(
    audio: Float32Array,
    options: { wordTimestamps?: boolean } = {}
  ): Promise<MoonshineWebTranscription> {
    await this.load();

    if (!this.encoderSession || !this.decoderSession) {
      throw new Error('Moonshine web model is not loaded');
    }

    const runtime = requireOrtRuntime();
    const shape = MODEL_SHAPES[this.modelArch];
    const startedAt = performance.now();
    const maxLength = Math.max(1, Math.trunc((audio.length / 16000) * 6));

    const encoderFeeds: Record<string, WebOrtTensor> = {
      input_values: new runtime.Tensor('float32', audio, [1, audio.length]),
    };
    if (this.encoderSession.inputNames?.includes('attention_mask')) {
      encoderFeeds.attention_mask = createAttentionMaskTensor(audio.length);
    }

    const encoderOutput = await this.encoderSession.run(encoderFeeds);
    const encoderHiddenStates = encoderOutput.last_hidden_state as WebOrtTensor;
    const encoderFrameCount = encoderHiddenStates.dims[1] ?? 0;

    const emptyPastKeyValues = Object.fromEntries(
      Array.from({ length: shape.numLayers }, (_, layerIndex) =>
        ['decoder', 'encoder'].flatMap((branch) =>
          ['key', 'value'].map((kind) => [
            `past_key_values.${layerIndex}.${branch}.${kind}`,
            new runtime.Tensor('float32', new Float32Array(0), [
              0,
              shape.numKVHeads,
              1,
              shape.headDim,
            ]),
          ])
        )
      ).flat()
    ) as Record<string, WebOrtTensor>;

    const tokens = [1];
    let nextInputIds = [1];
    let pastKeyValues = emptyPastKeyValues;
    const crossAttentionTensors: Float32Array[] = [];
    let crossAttentionHeads = 0;
    let crossAttentionEncoderFrames = 0;

    for (let index = 0; index < maxLength; index += 1) {
      const decoderInput: Record<string, WebOrtTensor> = {
        input_ids: createInt64Tensor(nextInputIds),
        encoder_hidden_states: encoderHiddenStates,
        use_cache_branch: createBoolTensor(index > 0),
        ...pastKeyValues,
      };
      if (
        encoderFrameCount > 0 &&
        this.decoderSession.inputNames?.includes('encoder_attention_mask')
      ) {
        decoderInput.encoder_attention_mask =
          createAttentionMaskTensor(encoderFrameCount);
      }

      const decoderOutput = await this.decoderSession.run(decoderInput);
      const logitsTensor = decoderOutput.logits as WebOrtTensor;
      const logits = await readTensorData(logitsTensor);
      const nextToken = argMax(logits);
      tokens.push(nextToken);

      if (nextToken === 2) {
        break;
      }

      nextInputIds = [nextToken];

      if (options.wordTimestamps && this.wordTimestampsEnabled) {
        for (
          let layerIndex = 0;
          layerIndex < shape.numLayers;
          layerIndex += 1
        ) {
          const attentionTensor =
            decoderOutput[`cross_attentions.${layerIndex}`];
          if (!attentionTensor) {
            break;
          }

          const attentionData = await readTensorData(attentionTensor);
          crossAttentionTensors.push(attentionData);

          if (crossAttentionHeads === 0) {
            crossAttentionHeads = attentionTensor.dims[1] ?? shape.numKVHeads;
            crossAttentionEncoderFrames =
              attentionTensor.dims[3] ?? attentionTensor.dims[2] ?? 0;
          }
        }
      }

      const presentKeyValues = Object.entries(decoderOutput)
        .filter(([key]) => key.includes('present'))
        .map(([, value]) => value as WebOrtTensor);

      Object.keys(pastKeyValues).forEach((key, presentIndex) => {
        const tensor = presentKeyValues[presentIndex];
        if (!tensor) {
          return;
        }
        if (index === 0 || key.includes('decoder')) {
          pastKeyValues[key] = tensor;
        }
      });
    }

    this.lastLatencyMs = performance.now() - startedAt;
    const text = llamaTokenizer.decode(tokens.slice(0, -1));

    if (
      !options.wordTimestamps ||
      !this.wordTimestampsEnabled ||
      crossAttentionTensors.length === 0 ||
      crossAttentionHeads <= 0 ||
      crossAttentionEncoderFrames <= 0
    ) {
      return {
        text,
        wordTimestampsEnabled: this.wordTimestampsEnabled,
        wordTimestampsFailureReason: this.wordTimestampsFailureReason,
      };
    }

    const crossAttentionBuffer = new Float32Array(
      crossAttentionTensors.reduce((total, tensor) => total + tensor.length, 0)
    );
    let offset = 0;
    for (const tensor of crossAttentionTensors) {
      crossAttentionBuffer.set(tensor, offset);
      offset += tensor.length;
    }

    const perLayerStep = crossAttentionHeads * crossAttentionEncoderFrames;
    const totalSteps = Math.floor(
      crossAttentionTensors.length / shape.numLayers
    );
    const rearranged = new Float32Array(
      shape.numLayers *
        crossAttentionHeads *
        totalSteps *
        crossAttentionEncoderFrames
    );

    for (let stepIndex = 0; stepIndex < totalSteps; stepIndex += 1) {
      for (let layerIndex = 0; layerIndex < shape.numLayers; layerIndex += 1) {
        const sourceOffset =
          (stepIndex * shape.numLayers + layerIndex) * perLayerStep;
        for (
          let headIndex = 0;
          headIndex < crossAttentionHeads;
          headIndex += 1
        ) {
          const destinationOffset =
            ((layerIndex * crossAttentionHeads + headIndex) * totalSteps +
              stepIndex) *
            crossAttentionEncoderFrames;
          const headOffset =
            sourceOffset + headIndex * crossAttentionEncoderFrames;
          rearranged.set(
            crossAttentionBuffer.subarray(
              headOffset,
              headOffset + crossAttentionEncoderFrames
            ),
            destinationOffset
          );
        }
      }
    }

    const words = alignWordsFromCrossAttention(
      rearranged,
      shape.numLayers,
      crossAttentionHeads,
      totalSteps,
      crossAttentionEncoderFrames,
      tokens,
      audio.length / 16000 / crossAttentionEncoderFrames,
      llamaTokenizer as {
        decode(
          tokenIds: number[],
          addBosToken?: boolean,
          addPrecedingSpace?: boolean
        ): string;
        vocabById: string[];
      }
    );

    return words.length > 0
      ? {
          text,
          words,
          wordTimestampsEnabled: this.wordTimestampsEnabled,
          wordTimestampsFailureReason: this.wordTimestampsFailureReason,
        }
      : {
          text,
          wordTimestampsEnabled: this.wordTimestampsEnabled,
          wordTimestampsFailureReason: this.wordTimestampsFailureReason,
        };
  }
}
