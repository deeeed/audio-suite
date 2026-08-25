export function getMoonshineIntentFiles(variant: string): string[] {
    if (variant === 'q4') {
        return ['model_q4.ort', 'tokenizer.bin']
    }
    if (variant === 'q8' || variant === 'quantized') {
        return ['model_quantized.ort', 'tokenizer.bin']
    }
    throw new Error(`Unsupported Moonshine intent model variant: ${variant}`)
}
