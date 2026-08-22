# Recording File Sizes

This page shows actual file sizes measured from 60-second recordings using different audio configurations. These measurements help you choose the optimal settings for your use case.

## Uncompressed File Size Comparison

The following table shows file sizes for 60-second recordings without compression:

| Configuration | Sample Rate | Channels | Bit Depth | Android Size | iOS Size | Use Case |
|--------------|-------------|----------|-----------|--------------|----------|----------|
| Voice Low | 16 kHz | Mono | 8-bit | 0.97 MB | 1.93 MB | Voice memos |
| Voice Standard | 16 kHz | Mono | 16-bit | 1.94 MB | 1.93 MB | Podcasts |
| Audio Book | 44.1 kHz | Mono | 16-bit | 5.35 MB | 5.32 MB | Audio books |
| Music Standard | 44.1 kHz | Stereo | 16-bit | 10.69 MB | 5.32 MB* | Music recording |
| Professional | 48 kHz | Stereo | 32-bit | 11.70 MB | 5.79 MB* | Studio quality |

*Note: iOS test results show unexpected mono behavior for stereo configurations. Investigation pending.

## Compressed File Size Comparison

Compression provides significant file size reduction while maintaining good audio quality:

| Configuration | Format | Bitrate | Android Size | iOS Size |
|--------------|--------|---------|--------------|----------|
| Voice Compressed | Opus | 32k | 0.31 MB | N/A |
| Voice Compressed | AAC | 32k | N/A | 0.27 MB |
| Voice Compressed | AAC | 64k | 0.51 MB | 0.49 MB* |
| Music Compressed | AAC | 128k | 1.02 MB | 0.86 MB |
| Music Compressed | AAC | 256k | 2.00 MB | 2.00 MB |

*Estimated based on expected compression ratio

### Key Findings:
- **Opus compression** (Android only): ~85% reduction for voice at 32kbps
- **AAC compression**: Excellent performance on both platforms
  - Voice (32k): ~86% reduction (0.27-0.31 MB from ~2 MB)
  - Voice (64k): ~75% reduction (0.49-0.51 MB from ~2 MB)
  - Music (128k): ~91% reduction (0.86-1.02 MB from ~10 MB)
  - Music (256k): ~81% reduction (2.00 MB from ~10 MB)
- **Cross-platform consistency**: iOS and Android show similar compressed sizes

## File Size Formula

For uncompressed WAV files, you can calculate the exact file size using:

```
File Size (MB) = Duration (s) × Sample Rate × Channels × (Bit Depth / 8) / 1,048,576
```

### Examples:
- **Voice (16 kHz, Mono, 16-bit)**: 60 × 16,000 × 1 × 2 / 1,048,576 = 1.83 MB
- **Music (44.1 kHz, Stereo, 16-bit)**: 60 × 44,100 × 2 × 2 / 1,048,576 = 10.09 MB
- **Professional (48 kHz, Stereo, 32-bit)**: 60 × 48,000 × 2 × 4 / 1,048,576 = 21.97 MB

## Platform Consistency

The results show good consistency between Android and iOS for mono recordings:
- Voice recordings: Nearly identical file sizes
- Audio Book: Within 1% difference (5.35 MB vs 5.32 MB)

## Choosing the Right Configuration

### For Minimal File Size
- **Android**: Use Opus compression at 32kbps for voice (0.31 MB/min)
- **iOS**: Use AAC compression at 32kbps for voice (0.27 MB/min)
- **Cross-platform**: AAC 32k provides excellent compression (~0.3 MB/min)

### For Balanced Quality
- **Podcasts**: Voice with AAC 64k compression (~0.5 MB/min)
- **Audio Books**: AAC 64k for mono content (saves ~75% space)
- **Voice with compression**: AAC 64k provides good balance

### For Music and Professional Use
- **Music**: AAC 128k compression (~0.9 MB/min) saves ~91% space
- **High Quality**: AAC 256k compression (2.0 MB/min) saves ~81% space
- **Lossless**: Uncompressed WAV for editing (10-12 MB/min)

## Storage Planning

Based on actual measurements, here's realistic storage requirements:

### Uncompressed Storage Needs
| Recording Type | Configuration | 10 Minutes | 1 Hour | 5 Hours |
|----------------|--------------|------------|--------|---------|
| Voice Notes | Voice Low | 10-19 MB | 60-115 MB | 300-580 MB |
| Podcast | Voice Standard | 19 MB | 115 MB | 580 MB |
| Lectures | Audio Book | 53 MB | 320 MB | 1.6 GB |
| Music | Music Standard | 107 MB | 640 MB | 3.2 GB |

### Compressed Storage Needs
| Recording Type | Format/Bitrate | 10 Minutes | 1 Hour | 5 Hours |
|----------------|----------------|------------|--------|---------|
| Voice Notes | Opus/AAC 32k | 3 MB | 18 MB | 90 MB |
| Podcast | AAC 64k | 5 MB | 30 MB | 150 MB |
| Music | AAC 128k | 9 MB | 54 MB | 270 MB |
| High Quality | AAC 256k | 20 MB | 120 MB | 600 MB |

## Performance Notes

All configurations tested showed excellent stop recording performance:
- Stop time: < 200ms for all configurations
- No performance degradation with larger file sizes
- Consistent behavior across platforms

## Test Methodology

These measurements were collected using:
- Real device testing on Android and iOS Simulator
- Target duration: 60 seconds (actual: 60-65 seconds due to timing variations)
- Base64 encoded configuration for accurate nested parameters
- Agent validation workflow for automated testing
- Multiple compression formats and bitrates tested

### Known Issues & Limitations

1. **iOS Stereo Recording**: Stereo recordings may show mono file sizes on iOS

2. **Recording Duration Variance**: 3-5 second variance in actual recording duration

3. **iOS Bit Depth**: 
   - iOS doesn't support 8-bit PCM encoding, defaulting to 16-bit
   - This results in Voice Low (8-bit) having the same size as Voice Standard (16-bit)
   - The analysisData shows bitDepth: 32 due to internal float processing

4. **Compression Implementation**:
   - Primary output must be disabled for compressed-only recording
   - Fixed iOS issue where compression info wasn't returned when primary disabled

These figures were collected with a detox suite that has since been removed; file-size validation now runs through the playground's CDP recipes.