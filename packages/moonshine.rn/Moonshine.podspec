require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  current_ios_dir = 'prebuilt/ios/current'
  xcframework_dir = 'prebuilt/ios/Moonshine.xcframework'
  simulator_slice = "#{xcframework_dir}/ios-arm64_x86_64-simulator"
  device_slice = "#{xcframework_dir}/ios-arm64"

  s.name         = 'Moonshine'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = 'https://github.com/deeeed/audiolab'
  s.license      = package['license']
  s.authors      = package['author']
  s.platforms    = { :ios => '15.1' }
  s.source       = { :git => 'https://github.com/deeeed/audiolab.git', :tag => s.version.to_s }
  s.source_files = 'ios/**/*.{h,m,mm}'
  s.preserve_paths = [
    "#{xcframework_dir}/**",
    "#{current_ios_dir}/**"
  ]
  s.vendored_libraries = "#{current_ios_dir}/libmoonshine_core.a"
  s.frameworks = 'CoreFoundation', 'Foundation'
  s.libraries = 'c++'
  s.xcconfig = {
    'LIBRARY_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/prebuilt/ios/current"'
  }
  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'DEFINES_MODULE' => 'YES'
  }

  s.prepare_command = <<-CMD
    set -euo pipefail
    CURRENT_DIR="#{current_ios_dir}"
    DEFAULT_SLICE="#{simulator_slice}"
    FALLBACK_SLICE="#{device_slice}"

    if [ ! -d "$DEFAULT_SLICE" ] || [ ! -d "$FALLBACK_SLICE" ]; then
      bash ./scripts/ensure-ios-artifacts.sh
    fi

    mkdir -p "$CURRENT_DIR"
    if [ -d "$DEFAULT_SLICE" ]; then
      rsync -a --delete --exclude 'libmoonshine.a' "$DEFAULT_SLICE/" "$CURRENT_DIR/"
      cp "$DEFAULT_SLICE/libmoonshine.a" "$CURRENT_DIR/libmoonshine_core.a"
      rm -f "$CURRENT_DIR/libmoonshine.a"
    elif [ -d "$FALLBACK_SLICE" ]; then
      rsync -a --delete --exclude 'libmoonshine.a' "$FALLBACK_SLICE/" "$CURRENT_DIR/"
      cp "$FALLBACK_SLICE/libmoonshine.a" "$CURRENT_DIR/libmoonshine_core.a"
      rm -f "$CURRENT_DIR/libmoonshine.a"
    else
      echo "Moonshine iOS slices not found under #{xcframework_dir}" >&2
      exit 1
    fi
  CMD

  s.script_phase = {
    :name => 'Select Moonshine iOS Slice',
    :script => <<-CMD,
      set -euo pipefail
      XCFRAMEWORK_DIR="${PODS_TARGET_SRCROOT}/#{xcframework_dir}"
      CURRENT_DIR="${PODS_TARGET_SRCROOT}/#{current_ios_dir}"

      if [[ "$PLATFORM_NAME" == *simulator* ]]; then
        SELECTED_SLICE="$XCFRAMEWORK_DIR/ios-arm64_x86_64-simulator"
      else
        SELECTED_SLICE="$XCFRAMEWORK_DIR/ios-arm64"
      fi

      if [ ! -d "$SELECTED_SLICE" ]; then
        bash "${PODS_TARGET_SRCROOT}/scripts/ensure-ios-artifacts.sh"
      fi

      if [ ! -d "$SELECTED_SLICE" ]; then
        echo "Moonshine iOS slice missing: $SELECTED_SLICE" >&2
        exit 1
      fi

      mkdir -p "$CURRENT_DIR"
      rsync -a --delete --exclude 'libmoonshine.a' "$SELECTED_SLICE/" "$CURRENT_DIR/"
      cp "$SELECTED_SLICE/libmoonshine.a" "$CURRENT_DIR/libmoonshine_core.a"
      rm -f "$CURRENT_DIR/libmoonshine.a"
    CMD
    :execution_position => :before_compile,
    :output_files => [
      "${PODS_TARGET_SRCROOT}/prebuilt/ios/current/libmoonshine_core.a",
      "${PODS_TARGET_SRCROOT}/prebuilt/ios/current/Headers/moonshine-c-api.h",
      "${PODS_TARGET_SRCROOT}/prebuilt/ios/current/Headers/module.modulemap"
    ]
  }

  s.dependency 'React-Core'
end
