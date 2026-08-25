import AVFoundation
import FluidAudio
import Foundation

struct BenchmarkSegment: Codable {
  let start: Float
  let end: Float
  let speaker: String
}

struct BenchmarkOutput: Codable {
  let audioFile: String
  let durationSeconds: Double
  let processingTimeSeconds: Double
  let realTimeFactor: Double
  let segments: [BenchmarkSegment]
}

guard CommandLine.arguments.count == 7 else {
  fputs(
    "usage: FluidMacOSBenchmark <audio> <output-json> <model-cache> <threshold> <step-ratio> <min-segment-seconds>\n",
    stderr
  )
  exit(2)
}

let audioPath = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]
let modelCache = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
guard
  let threshold = Double(CommandLine.arguments[4]),
  let stepRatio = Double(CommandLine.arguments[5]),
  let minSegmentSeconds = Double(CommandLine.arguments[6])
else {
  fputs("invalid numeric configuration\n", stderr)
  exit(2)
}
let audioURL = URL(fileURLWithPath: audioPath)
let audioFile = try AVAudioFile(forReading: audioURL)
let durationSeconds = Double(audioFile.length) / audioFile.processingFormat.sampleRate
let manager = OfflineDiarizerManager(
  config: OfflineDiarizerConfig(
    clusteringThreshold: threshold,
    segmentationStepRatio: stepRatio,
    minSegmentDuration: minSegmentSeconds
  )
)
try await manager.prepareModels(directory: modelCache)
let startedAt = Date()
let result = try await manager.process(audioURL)
let processSeconds = Date().timeIntervalSince(startedAt)
let output = BenchmarkOutput(
  audioFile: audioPath,
  durationSeconds: durationSeconds,
  processingTimeSeconds: processSeconds,
  realTimeFactor: durationSeconds / processSeconds,
  segments: result.segments.map {
    BenchmarkSegment(
      start: $0.startTimeSeconds,
      end: $0.endTimeSeconds,
      speaker: $0.speakerId
    )
  }
)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let data = try encoder.encode(output)
try FileManager.default.createDirectory(
  at: URL(fileURLWithPath: outputPath).deletingLastPathComponent(),
  withIntermediateDirectories: true
)
try data.write(to: URL(fileURLWithPath: outputPath))
