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
    expectedBytes: number
    fileName: string
    md5?: string
    url: string
}

function createMoonshineFiles(slug: string): MoonshineBenchmarkDownloadFile[] {
    const baseUrl = `https://download.moonshine.ai/model/${slug}/quantized`
    const expectedFilesBySlug: Record<
        string,
        Record<string, { expectedBytes: number; md5?: string }>
    > = {
        'small-streaming-en': {
            'adapter.ort': { expectedBytes: 2867424, md5: '3bd0a8dda28d779ba92faed6ca33da81' },
            'cross_kv.ort': { expectedBytes: 5298736, md5: '6afd15b369fc66fd5a05b88286cdfd92' },
            'decoder_kv.ort': {
                expectedBytes: 81435904,
                md5: 'd5adfcfaa6e582144791f1568bd0f683',
            },
            'decoder_kv_with_attention.ort': {
                expectedBytes: 81380336,
                md5: 'a8028f0c430470fb6d3e081dbedd05aa',
            },
            'encoder.ort': { expectedBytes: 43853224, md5: '87b50cdeaadbc080ec984d0dcb21aaee' },
            'frontend.ort': {
                expectedBytes: 30984200,
                md5: '98a71c79496460f485a59b6a2e57d369',
            },
            'streaming_config.json': {
                expectedBytes: 512,
                md5: 'c987419d7fbd825ace3a36e76c413c4c',
            },
            'tokenizer.bin': { expectedBytes: 249974, md5: '1373d5894cf6669c03c31e8ed141f969' },
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
