Pod::Spec.new do |s|
  s.name           = 'PlaygroundAPI'
  s.version        = '1.0.0'
  s.summary        = 'A sample project summary'
  s.description    = 'A sample project description'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'AudioStudio'
  s.dependency 'Essentia'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'HEADER_SEARCH_PATHS' => '"${PODS_ROOT}/../../react-native-essentia/cpp/include"'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
