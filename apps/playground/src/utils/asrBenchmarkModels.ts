import type { MoonshineModelArch } from '@siteed/moonshine.rn'
import type { AsrModelConfig } from '@siteed/sherpa-onnx.rn'

import mobileRecommendationModelIdsJson from './asrMobileRecommendationModelIds.json'

export type AsrBenchmarkEngine = 'moonshine' | 'whisper' | 'sherpa'
export type AsrBenchmarkMode = 'sample' | 'simulated'

export interface AsrBenchmarkSample {
    id: string
    module: number
    name: string
}

export interface MoonshineBenchmarkDescriptor {
    modelArch: MoonshineModelArch
    slug: string
    updateIntervalMs: number
    webWordTimestampsSupported?: boolean
}

export interface WhisperBenchmarkDescriptor {
    filename: string
    url: string
    whisperModelId: string
}

export interface SherpaBenchmarkDescriptor {
    config: Omit<AsrModelConfig, 'modelDir'>
    modelDir: string
    releaseBetweenSegments?: boolean
    requiredFiles?: string[]
    rollingWindowMs?: number
    segmentDurationMs?: number
}

export interface AsrBenchmarkModel {
    description: string
    engine: AsrBenchmarkEngine
    estimatedSizeLabel?: string
    id: string
    liveCapable: boolean
    moonshine?: MoonshineBenchmarkDescriptor
    name: string
    rationale: string
    recommendationLabel?: string
    recommendationTier?: 'recommended' | 'alternate' | 'avoid-default'
    recommendedUse?: string
    sherpa?: SherpaBenchmarkDescriptor
    warningLabel?: string
    whisper?: WhisperBenchmarkDescriptor
}

export interface MoonshineBenchmarkDownloadFile {
    expectedBytes: number
    fileName: string
    md5?: string
    url: string
}

function createMoonshineFiles(slug: string): MoonshineBenchmarkDownloadFile[] {
    const baseUrl = `https://download.moonshine.ai/model/${slug}/quantized`
    // Sizes are pinned so partial / interrupted downloads invalidate the
    // cache. MD5 pins were dropped — they go stale every time Moonshine
    // republishes a file (which happens silently and forces every cached
    // install to re-download). Size validation alone catches the common
    // "download interrupted mid-stream" case; if reproducibility ever
    // matters for compliance, swap this for a TOFU sidecar (compute md5
    // after first successful download, persist next to the file).
    const expectedFilesBySlug: Record<
        string,
        Record<string, { expectedBytes: number; md5?: string }>
    > = {
        'small-streaming-en': {
            'adapter.ort': { expectedBytes: 2867424 },
            'cross_kv.ort': { expectedBytes: 5298736 },
            'decoder_kv.ort': { expectedBytes: 81435904 },
            'decoder_kv_with_attention.ort': { expectedBytes: 81380336 },
            'encoder.ort': { expectedBytes: 43853224 },
            'frontend.ort': { expectedBytes: 30984200 },
            'streaming_config.json': { expectedBytes: 512 },
            'tokenizer.bin': { expectedBytes: 249974 },
        },
        'medium-streaming-en': {
            'adapter.ort': { expectedBytes: 3647712 },
            'cross_kv.ort': { expectedBytes: 11544952 },
            'decoder_kv.ort': { expectedBytes: 146216448 },
            'decoder_kv_with_attention.ort': { expectedBytes: 146138304 },
            'encoder.ort': { expectedBytes: 94202872 },
            'frontend.ort': { expectedBytes: 47467256 },
            'streaming_config.json': { expectedBytes: 513 },
            'tokenizer.bin': { expectedBytes: 249974 },
        },
    }
    const expectedFiles = expectedFilesBySlug[slug]
    if (!expectedFiles) {
        throw new Error(`Missing expected Moonshine download metadata for slug ${slug}`)
    }

    return Object.entries(expectedFiles).map(([fileName, file]) => ({
        expectedBytes: file.expectedBytes,
        fileName,
        md5: file.md5,
        url: `${baseUrl}/${fileName}`,
    }))
}

function createSherpaWhisperConfig(
    size: 'small' | 'medium',
    precision: 'fp32' | 'int8' = 'fp32',
): Omit<AsrModelConfig, 'modelDir'> {
    const suffix = precision === 'int8' ? '.int8.onnx' : '.onnx'
    return {
        modelType: 'whisper',
        streaming: false,
        numThreads: 4,
        decodingMethod: 'greedy_search',
        maxActivePaths: 4,
        provider: 'cpu',
        language: 'en',
        task: 'transcribe',
        modelFiles: {
            encoder: `${size}-encoder${suffix}`,
            decoder: `${size}-decoder${suffix}`,
            tokens: `${size}-tokens.txt`,
        },
    }
}

export const ASR_BENCHMARK_MODELS: AsrBenchmarkModel[] = [
    {
        id: 'moonshine-small-streaming-en',
        name: 'Moonshine Small Streaming',
        description: 'Primary Moonshine live contender for on-device English transcription.',
        engine: 'moonshine',
        estimatedSizeLabel: '~230 MB on device',
        liveCapable: true,
        recommendationLabel: 'Moonshine live optimization candidate',
        recommendationTier: 'recommended',
        recommendedUse: 'Primary open-model live candidate after bridge/coalescing optimization',
        rationale:
            'The smaller serious Moonshine candidate. It is the lower-memory live fallback, but must still be gated by RTF/backlog after RN transport optimization.',
        moonshine: {
            modelArch: 'small-streaming',
            slug: 'small-streaming-en',
            updateIntervalMs: 250,
            webWordTimestampsSupported: true,
        },
    },
    {
        id: 'moonshine-medium-streaming-en',
        name: 'Moonshine Medium Streaming',
        description: 'Highest-quality official Moonshine streaming contender for English.',
        engine: 'moonshine',
        estimatedSizeLabel: '~420 MB on device',
        liveCapable: true,
        recommendationLabel: 'Moonshine quality candidate',
        recommendationTier: 'alternate',
        recommendedUse: 'Live transcript only if RTF/backlog is acceptable on target device',
        rationale: 'Current Moonshine quality ceiling for live English speech on device.',
        warningLabel: 'Likely slower than real time on Pixel 6a-class devices until optimized',
        moonshine: {
            modelArch: 'medium-streaming',
            slug: 'medium-streaming-en',
            updateIntervalMs: 250,
            webWordTimestampsSupported: false,
        },
    },
    {
        id: 'whisper-small',
        name: 'Whisper Small (whisper.rn)',
        description: 'Whisper.cpp-backed English small model through whisper.rn.',
        engine: 'whisper',
        estimatedSizeLabel: '~466 MB on device',
        liveCapable: true,
        recommendationLabel: 'Legacy baseline',
        recommendationTier: 'avoid-default',
        recommendedUse: 'Compatibility baseline only; excluded from practical matrix',
        rationale: 'Best practical open Whisper contender already available in playground.',
        warningLabel: 'Pseudo-streaming replay re-decodes cumulative audio and can hang long runs',
        whisper: {
            filename: 'ggml-small.en.bin',
            url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
            whisperModelId: 'small',
        },
    },
    {
        id: 'sherpa-qwen3-asr-0.6b-int8',
        name: 'Sherpa Qwen3-ASR 0.6B INT8',
        description:
            'Best currently validated Sherpa ONNX offline ASR candidate for on-device long-form transcription.',
        engine: 'sherpa',
        estimatedSizeLabel: '~1.0 GB on device',
        liveCapable: true,
        recommendationLabel: 'Delayed-live candidate',
        recommendationTier: 'recommended',
        recommendedUse: 'Rolling-window delayed live and offline final transcript quality',
        rationale:
            'Runs offline on Android from the downloaded sherpa-onnx Qwen3 0.6B INT8 package; useful for high-quality delayed-live refinement and final transcript quality.',
        warningLabel: 'Not true streaming; simulated live emits only after each rolling window',
        sherpa: {
            modelDir:
                'models/qwen3-asr-0.6B-int8-2026-03-25/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25',
            releaseBetweenSegments: true,
            rollingWindowMs: 15_000,
            segmentDurationMs: 30_000,
            config: {
                modelType: 'qwen3',
                streaming: false,
                numThreads: 4,
                decodingMethod: 'greedy_search',
                maxActivePaths: 4,
                provider: 'cpu',
                language: 'en',
                modelFiles: {
                    encoder: 'encoder.int8.onnx',
                    decoder: 'decoder.int8.onnx',
                    convFrontend: 'conv_frontend.onnx',
                    tokenizer: 'tokenizer',
                },
                qwen3: {
                    maxTotalLen: 512,
                    maxNewTokens: 128,
                    temperature: 0.000001,
                    topP: 0.8,
                    seed: 42,
                },
            },
        },
    },
    {
        id: 'sherpa-whisper-small',
        name: 'Sherpa Whisper Small',
        description:
            'Sherpa ONNX offline Whisper small baseline, using the same Sherpa ASR API as Qwen3.',
        engine: 'sherpa',
        estimatedSizeLabel: '~1.3 GB on device',
        liveCapable: false,
        recommendationLabel: 'Whisper baseline',
        recommendationTier: 'alternate',
        recommendedUse: 'EchoBridge parity baseline',
        rationale:
            'Practical Whisper parity baseline already available from the Sherpa model zoo; useful to separate model quality from wrapper/runtime behavior.',
        warningLabel: 'Offline-only and slower than Qwen3 on Pixel 6a',
        sherpa: {
            modelDir: 'models/whisper-small-multilingual/sherpa-onnx-whisper-small',
            releaseBetweenSegments: true,
            requiredFiles: ['small-encoder.onnx', 'small-decoder.onnx', 'small-tokens.txt'],
            segmentDurationMs: 30_000,
            config: createSherpaWhisperConfig('small'),
        },
    },
    {
        id: 'sherpa-whisper-medium',
        name: 'Sherpa Whisper Medium',
        description:
            'Sherpa ONNX offline Whisper medium parity/stress-test model against the EchoBridge Whisper medium reference.',
        engine: 'sherpa',
        estimatedSizeLabel: '~3.7 GB on device',
        liveCapable: false,
        recommendationLabel: 'Opt-in stress test',
        recommendationTier: 'avoid-default',
        recommendedUse: 'FP32 Whisper parity stress testing only',
        rationale:
            'Closest on-device Sherpa Whisper comparison to the EchoBridge Whisper medium backend reference; expected to be slow/heavy on mid-range phones.',
        warningLabel: 'Not a default mobile model; Pixel 6a run did not complete',
        sherpa: {
            modelDir: 'models/whisper-medium-multilingual/sherpa-onnx-whisper-medium',
            releaseBetweenSegments: true,
            requiredFiles: ['medium-encoder.onnx', 'medium-decoder.onnx', 'medium-tokens.txt'],
            segmentDurationMs: 30_000,
            config: createSherpaWhisperConfig('medium'),
        },
    },
    {
        id: 'sherpa-whisper-medium-int8',
        name: 'Sherpa Whisper Medium INT8',
        description: 'Quantized Sherpa ONNX Whisper medium variant for mobile feasibility checks.',
        engine: 'sherpa',
        estimatedSizeLabel: '~3.7 GB on device',
        liveCapable: false,
        recommendationLabel: 'EchoBridge parity default',
        recommendationTier: 'recommended',
        recommendedUse: 'Whisper-vs-EchoBridge parity benchmark',
        rationale:
            'Uses the same Whisper medium export as the parity model but selects INT8 encoder/decoder files to measure the mobile quality/speed trade-off.',
        warningLabel: 'Very slow offline model; backend-reference score is not human WER',
        sherpa: {
            modelDir: 'models/whisper-medium-multilingual/sherpa-onnx-whisper-medium',
            releaseBetweenSegments: true,
            requiredFiles: [
                'medium-encoder.int8.onnx',
                'medium-decoder.int8.onnx',
                'medium-tokens.txt',
            ],
            segmentDurationMs: 30_000,
            config: createSherpaWhisperConfig('medium', 'int8'),
        },
    },
]

export const ASR_BENCHMARK_MODEL_IDS = ASR_BENCHMARK_MODELS.map((model) => model.id)
// Shared source for the on-device recommendation matrix. The direct Android
// runner in apps/playground/scripts/agentic/direct-asr-benchmark.mjs reads the
// same JSON and performs a matching registry validation against its Node-side
// ALL_MODELS list so TS/UI and automation fail loudly on drift.
const mobileRecommendationModelIds = mobileRecommendationModelIdsJson as string[]
const benchmarkModelIdSet = new Set(ASR_BENCHMARK_MODEL_IDS)
const unknownMobileRecommendationModelIds = mobileRecommendationModelIds.filter(
    (modelId) => !benchmarkModelIdSet.has(modelId),
)

if (unknownMobileRecommendationModelIds.length > 0) {
    throw new Error(
        `Unknown ASR mobile recommendation model ids: ${unknownMobileRecommendationModelIds.join(', ')}`,
    )
}

export const ASR_MOBILE_RECOMMENDATION_MODEL_IDS = mobileRecommendationModelIds

export const ASR_BENCHMARK_SAMPLES: AsrBenchmarkSample[] = [
    {
        id: 'jfk-public-wav',
        name: 'JFK Speech',
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        module: require('../../public/audio_samples/jfk.wav'),
    },
]

export function getAsrBenchmarkModel(modelId: string): AsrBenchmarkModel | undefined {
    return ASR_BENCHMARK_MODELS.find((model) => model.id === modelId)
}

export function getMoonshineDownloadFiles(modelId: string): MoonshineBenchmarkDownloadFile[] {
    const model = getAsrBenchmarkModel(modelId)
    if (!model?.moonshine) {
        throw new Error(`Model ${modelId} is not a Moonshine benchmark model`)
    }

    return createMoonshineFiles(model.moonshine.slug)
}
