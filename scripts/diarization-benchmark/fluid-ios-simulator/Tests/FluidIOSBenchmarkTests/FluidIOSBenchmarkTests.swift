import FluidAudio
import Foundation
import XCTest

struct BenchmarkSegment: Codable {
  let start: Float
  let end: Float
  let speaker: String
}

struct BenchmarkOutput: Codable {
  let runtime: String
  let device: String
  let processSeconds: Double
  let segments: [BenchmarkSegment]
}

final class FluidIOSBenchmarkTests: XCTestCase {
  func testParityMeeting() async throws {
    guard
      let audioURL = Bundle.module.url(
        forResource: "parity-meeting",
        withExtension: "wav",
        subdirectory: "Fixtures"
      )
    else {
      XCTFail("Missing parity fixture")
      return
    }
    let manager = OfflineDiarizerManager(
      config: OfflineDiarizerConfig(
        clusteringThreshold: Double("__CLUSTERING_THRESHOLD__")!,
        segmentationStepRatio: Double("__SEGMENTATION_STEP_RATIO__")!,
        minSegmentDuration: Double("__MIN_SEGMENT_DURATION__")!
      )
    )
    let cacheDirectory = FileManager.default.urls(
      for: .cachesDirectory,
      in: .userDomainMask
    )[0].appendingPathComponent(
      "audiolab-fluid-__FLUID_AUDIO_VERSION__-__MODEL_REVISION__",
      isDirectory: true
    )
    try await manager.prepareModels(directory: cacheDirectory)
    let startedAt = Date()
    let result = try await manager.process(audioURL)
    let output = BenchmarkOutput(
      runtime: "FluidAudio iOS simulator",
      device: ProcessInfo.processInfo.hostName,
      processSeconds: Date().timeIntervalSince(startedAt),
      segments: result.segments.map {
        BenchmarkSegment(
          start: $0.startTimeSeconds,
          end: $0.endTimeSeconds,
          speaker: $0.speakerId
        )
      }
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    print("IOS_BENCHMARK_JSON=\(try encoder.encode(output).base64EncodedString())")
    XCTAssertFalse(result.segments.isEmpty)
  }
}
