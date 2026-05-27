require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'AudioStudio'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = { :ios => '16.4', :tvos => '16.4' }
  s.swift_version  = '5.4'
  s.source         = { git: 'https://github.com/deeeed/audiolab' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  cpp_root = File.join(__dir__, '..', 'cpp')

  # Swift/Objective-C compatibility + C++ mel spectrogram
  # C++ sources are #included in MelSpectrogramWrapper.mm (CocoaPods can't compile ../cpp/ files directly)
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'HEADER_SEARCH_PATHS' => "\"#{cpp_root}\" \"#{cpp_root}/kiss_fft\"",
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17'
  }

  s.source_files = "**/*.{h,m,mm,swift}"
  s.preserve_paths = "../cpp/**/*"
  s.exclude_files = [
    "*_test.swift",
    "standalone_test.swift",
    "tests/**/*",
    "AudioStudioTests/**/*"
  ]
end
