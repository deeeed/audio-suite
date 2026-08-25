import Foundation
import MoonshineVoice

struct OutputWord: Codable {
  let word: String
  let start: Float
  let end: Float
  let confidence: Float
}

struct OutputSegment: Codable {
  let start: Float
  let end: Float
  let speaker: UInt32
}

struct OutputLine: Codable {
  let text: String
  let start: Float
  let end: Float
  let words: [OutputWord]
  let speakerSpans: [OutputSegment]
}

struct Output: Codable {
  let runtime: String
  let version: Int32
  let modelArch: String
  let audioPath: String
  let lines: [OutputLine]
  let words: [OutputWord]
  let segments: [OutputSegment]
}

final class Collector: TranscriptEventListener {
  private var lines: [UInt64: TranscriptLine] = [:]

  private func store(_ line: TranscriptLine) {
    lines[line.lineId] = line
  }

  func onLineStarted(_ event: LineStarted) { store(event.line) }
  func onLineUpdated(_ event: LineUpdated) { store(event.line) }
  func onLineTextChanged(_ event: LineTextChanged) { store(event.line) }
  func onLineSpeakersChanged(_ event: LineSpeakersChanged) { store(event.line) }
  func onLineCompleted(_ event: LineCompleted) { store(event.line) }

  func sortedLines() -> [TranscriptLine] {
    lines.values.sorted {
      $0.startTime == $1.startTime
        ? $0.lineId < $1.lineId : $0.startTime < $1.startTime
    }
  }
}

func modelArch(_ value: String) -> ModelArch {
  switch value {
  case "small": return .smallStreaming
  case "medium": return .mediumStreaming
  default:
    fputs("model must be small or medium\n", stderr)
    exit(2)
  }
}

guard CommandLine.arguments.count == 3 else {
  fputs("usage: MoonshineNativeBenchmark <small|medium> <wav>\n", stderr)
  exit(2)
}

let archName = CommandLine.arguments[1]
let audioPath = CommandLine.arguments[2]
let wav = try loadWAVFile(audioPath)
let transcriber = try await Transcriber.load(
  language: "en",
  modelArch: modelArch(archName),
  includeWordTimestamps: true,
  options: [TranscriberOption(name: "identify_speakers", value: "true")]
)
let collector = Collector()
let stream = try transcriber.createStream(updateInterval: 0.5)
stream.addListener(collector)
try stream.start()
let chunkSize = Int(0.1 * Double(wav.sampleRate))
var offset = 0
while offset < wav.audioData.count {
  let end = min(offset + chunkSize, wav.audioData.count)
  try stream.addAudio(
    Array(wav.audioData[offset..<end]),
    sampleRate: Int32(wav.sampleRate)
  )
  offset = end
}
try stream.stop()
let lines = collector.sortedLines().map { line in
  OutputLine(
    text: line.text,
    start: line.startTime,
    end: line.startTime + line.duration,
    words: line.words.map {
      OutputWord(
        word: $0.word,
        start: $0.start,
        end: $0.end,
        confidence: $0.confidence
      )
    },
    speakerSpans: line.speakerSpans.map {
      OutputSegment(
        start: $0.startTime,
        end: $0.startTime + $0.duration,
        speaker: $0.speakerIndex
      )
    }
  )
}
let output = Output(
  runtime: "moonshine-swift",
  version: transcriber.getVersion(),
  modelArch: archName,
  audioPath: audioPath,
  lines: lines,
  words: lines.flatMap(\.words),
  segments: lines.flatMap(\.speakerSpans)
)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
FileHandle.standardOutput.write(try encoder.encode(output))
FileHandle.standardOutput.write(Data("\n".utf8))
stream.close()
transcriber.close()
