import type { MoonshineModelArch } from '@siteed/moonshine.rn'

export type AsrBenchmarkEngine = 'moonshine' | 'whisper'
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

export interface AsrBenchmarkModel {
    description: string
    engine: AsrBenchmarkEngine
    id: string
    liveCapable: boolean
    moonshine?: MoonshineBenchmarkDescriptor
    name: string
    rationale: string
    whisper?: WhisperBenchmarkDescriptor
}

export interface MoonshineBenchmarkDownloadFile {
    fileName: string
    url: string
}

function createMoonshineFiles(slug: string): MoonshineBenchmarkDownloadFile[] {
    const baseUrl = `https://download.moonshine.ai/model/${slug}/quantized`
    return [
        'adapter.ort',
        'cross_kv.ort',
        'decoder_kv.ort',
        'decoder_kv_with_attention.ort',
        'encoder.ort',
        'frontend.ort',
        'streaming_config.json',
        'tokenizer.bin',
    ].map((fileName) => ({
        fileName,
        url: `${baseUrl}/${fileName}`,
    }))
}

export const ASR_BENCHMARK_MODELS: AsrBenchmarkModel[] = [
    {
        id: 'moonshine-small-streaming-en',
        name: 'Moonshine Small Streaming',
        description: 'Primary Moonshine live contender for on-device English transcription.',
        engine: 'moonshine',
        liveCapable: true,
        rationale:
            'The smaller serious Moonshine candidate. Fast enough to be practical while still competitive on device.',
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
        liveCapable: true,
        rationale: 'Current Moonshine quality ceiling for live English speech on device.',
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
        liveCapable: true,
        rationale: 'Best practical open Whisper contender already available in playground.',
        whisper: {
            filename: 'ggml-small.en.bin',
            url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
            whisperModelId: 'small',
        },
    },
]

export const ASR_BENCHMARK_MODEL_IDS = ASR_BENCHMARK_MODELS.map((model) => model.id)

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
