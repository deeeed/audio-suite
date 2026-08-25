// swift-tools-version: 6.1
import PackageDescription

let package = Package(
  name: "MoonshineNativeBenchmark",
  platforms: [.macOS(.v13)],
  dependencies: [
    .package(
      url: "https://github.com/moonshine-ai/moonshine-swift.git",
      exact: "0.1.5"
    )
  ],
  targets: [
    .executableTarget(
      name: "MoonshineNativeBenchmark",
      dependencies: [
        .product(name: "MoonshineVoice", package: "moonshine-swift")
      ]
    )
  ]
)
