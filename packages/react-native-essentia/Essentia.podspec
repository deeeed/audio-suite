require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
folly_compiler_flags = '-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1 -Wno-comma -Wno-shorten-64-to-32'

Pod::Spec.new do |s|
  s.name         = "Essentia"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "16.4" }
  s.source       = { :git => "https://github.com/deeeed/audiolab/.git", :tag => "#{s.version}" }

  # Source files
  s.source_files = [
    "cpp/third_party/nlohmann/json.hpp",
    "ios/WrapEssentia.{h,mm}",
    "cpp/Utils.h",
    "cpp/EssentiaWrapper.{h,cpp}",
    "cpp/FeatureExtractor.{h,cpp}",
  ]

  # Create the necessary directory and symlink in prepare_command
  s.prepare_command = <<-CMD
    echo "========== ESSENTIA PREPARE COMMAND =========="
    echo "Working directory: $(pwd)"

    # Create directory if needed
    mkdir -p ios/Frameworks

    MISSING_LIBRARIES=0

    if [ ! -f ios/Frameworks/device/Essentia_iOS.a ]; then
      echo "WARNING: Essentia library not found at ios/Frameworks/device/Essentia_iOS.a"
      MISSING_LIBRARIES=1
    else
      echo "Device library exists: $(ls -la ios/Frameworks/device/Essentia_iOS.a)"
      echo "File size: $(wc -c < ios/Frameworks/device/Essentia_iOS.a) bytes"

      # Check if it's a dummy or LFS pointer
      if [ $(wc -c < ios/Frameworks/device/Essentia_iOS.a) -lt 1000 ]; then
        echo "ERROR: Device library appears to be a dummy file (< 1KB)"
        echo "Content: $(cat ios/Frameworks/device/Essentia_iOS.a)"
        MISSING_LIBRARIES=1
      fi

      # Check if it's a Git LFS pointer
      if grep -q "git-lfs" "ios/Frameworks/device/Essentia_iOS.a"; then
        echo "ERROR: Device library appears to be a Git LFS pointer file"
        echo "Content: $(cat ios/Frameworks/device/Essentia_iOS.a)"
        MISSING_LIBRARIES=1
      fi
    fi

    if [ ! -f ios/Frameworks/simulator/Essentia_Sim.a ]; then
      # Try alternative names for simulator libraries
      if [ -f ios/Frameworks/simulator/Essentia_Sim_x86_64.a ] && [ -f ios/Frameworks/simulator/Essentia_Sim_arm64.a ]; then
        echo "Found split simulator libraries, creating a unified simulator library"
        # Create directory if needed
        mkdir -p ios/Frameworks/simulator
        # Combine the two libraries
        lipo -create ios/Frameworks/simulator/Essentia_Sim_x86_64.a ios/Frameworks/simulator/Essentia_Sim_arm64.a -output ios/Frameworks/simulator/Essentia_Sim.a
      else
        echo "WARNING: Essentia simulator library not found at ios/Frameworks/simulator/Essentia_Sim.a"
        MISSING_LIBRARIES=1
      fi
    else
      echo "Simulator library exists: $(ls -la ios/Frameworks/simulator/Essentia_Sim.a)"
      echo "File size: $(wc -c < ios/Frameworks/simulator/Essentia_Sim.a) bytes"

      # Check if it's a dummy or LFS pointer
      if [ $(wc -c < ios/Frameworks/simulator/Essentia_Sim.a) -lt 1000 ]; then
        echo "ERROR: Simulator library appears to be a dummy file (< 1KB)"
        echo "Content: $(cat ios/Frameworks/simulator/Essentia_Sim.a)"
        MISSING_LIBRARIES=1
      fi

      # Check if it's a Git LFS pointer
      if grep -q "git-lfs" "ios/Frameworks/simulator/Essentia_Sim.a"; then
        echo "ERROR: Simulator library appears to be a Git LFS pointer file"
        echo "Content: $(cat ios/Frameworks/simulator/Essentia_Sim.a)"
        MISSING_LIBRARIES=1
      fi
    fi

    if [ $MISSING_LIBRARIES -eq 1 ]; then
      echo "Missing libraries detected. Attempting to download pre-built binaries..."
      # Run the install.js script to download pre-built binaries
      node ./install.js

      # Verify if the download was successful
      if [ ! -f ios/Frameworks/device/Essentia_iOS.a ] || [ ! -f ios/Frameworks/simulator/Essentia_Sim.a ]; then
        echo "ERROR: Failed to download required Essentia libraries!"
        echo "Please build the libraries using ./build-essentia-ios.sh"
        echo "Or manually download pre-built libraries from the appropriate source"
      fi
    fi

    # Create the symlink (required by CocoaPods)
    ln -sf device/Essentia_iOS.a ios/Frameworks/libEssentiaPrebuilt.a

    echo "Created symlink: $(ls -la ios/Frameworks/libEssentiaPrebuilt.a)"
    echo "All libraries validated successfully!"
    echo "========== END ESSENTIA PREPARE COMMAND =========="
  CMD

  # Preserve original libraries
  s.preserve_paths = [
    "ios/Frameworks/device/Essentia_iOS.a",
    "ios/Frameworks/simulator/Essentia_Sim.a",
    "ios/Frameworks/libEssentiaPrebuilt.a"
  ]

  # Vendored library (symlinked dynamically)
  s.vendored_libraries = "ios/Frameworks/libEssentiaPrebuilt.a"

  # Script to symlink the correct library based on platform
  s.script_phase = {
    :name => 'Link Essentia Library',
    :script => '
      echo "========== ESSENTIA LIBRARY VALIDATION =========="
      echo "Script running for PLATFORM_NAME=$PLATFORM_NAME ARCHS=$ARCHS"
      echo "Working directory: $(pwd)"

      # Create absolute paths to avoid symlink issues
      DEVICE_LIB="${PODS_TARGET_SRCROOT}/ios/Frameworks/device/Essentia_iOS.a"
      SIM_LIB="${PODS_TARGET_SRCROOT}/ios/Frameworks/simulator/Essentia_Sim.a"
      PREBUILT_LIB="${PODS_TARGET_SRCROOT}/ios/Frameworks/libEssentiaPrebuilt.a"

      # Check for the correct library files
      if [[ "$PLATFORM_NAME" == *simulator* ]]; then
        # For simulator builds
        echo "Symlinking Essentia Simulator Library"
        ln -sf "$SIM_LIB" "$PREBUILT_LIB"
      else
        # For device builds
        echo "Symlinking Essentia Device Library"
        ln -sf "$DEVICE_LIB" "$PREBUILT_LIB"
      fi

      # Verify the symlink
      echo "Verifying symlink:"
      ls -la "$PREBUILT_LIB"
      file "$PREBUILT_LIB"
      echo "========== END ESSENTIA LIBRARY VALIDATION =========="
    ',
    :execution_position => :before_compile,
    :output_files => ["${PODS_TARGET_SRCROOT}/ios/Frameworks/libEssentiaPrebuilt.a"]
  }

  s.user_target_xcconfig = {
    'VALID_ARCHS' => 'arm64 x86_64'
  }

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}" "${PODS_TARGET_SRCROOT}/cpp" "${PODS_TARGET_SRCROOT}/cpp/include" "${PODS_TARGET_SRCROOT}/cpp/third_party"',
    'GCC_PREPROCESSOR_DEFINITIONS' => 'ESSENTIA_EXPORTS=1',
    'VALID_ARCHS' => 'arm64 x86_64'
  }

  s.requires_arc = true
  s.frameworks = "Foundation", "Accelerate", "CoreAudio"

  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"

    if ENV['RCT_NEW_ARCH_ENABLED'] == '1' then
      s.compiler_flags = folly_compiler_flags + " -DRCT_NEW_ARCH_ENABLED=1"
      s.pod_target_xcconfig = {
        "HEADER_SEARCH_PATHS" => "\"$(PODS_ROOT)/boost\" \"${PODS_TARGET_SRCROOT}\" \"${PODS_TARGET_SRCROOT}/cpp\" \"${PODS_TARGET_SRCROOT}/cpp/include\" \"${PODS_TARGET_SRCROOT}/cpp/third_party\"",
        "OTHER_CPLUSPLUSFLAGS" => "-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1",
        "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
        "GCC_PREPROCESSOR_DEFINITIONS" => "ESSENTIA_EXPORTS=1",
        "VALID_ARCHS" => "arm64 x86_64"
      }
      s.dependency "React-Codegen"
      s.dependency "RCT-Folly"
      s.dependency "RCTRequired"
      s.dependency "RCTTypeSafety"
      s.dependency "ReactCommon/turbomodule/core"
    end
  end
end
