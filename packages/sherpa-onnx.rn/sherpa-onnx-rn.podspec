require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "sherpa-onnx-rn"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "13.4" }
  s.source       = { :git => "https://github.com/deeeed/audiolab.git", :tag => "#{s.version}" }

  # Source files (new architecture only)
  # NOTE: codegen files are NOT included here -- React-Codegen pod auto-generates them.
  # Including them breaks Swift module compilation (C++ headers like std::optional
  # are incompatible with Swift's module builder).
  s.source_files = [
    "ios/*.{h,m,mm,swift}",
    "ios/bridge/*.{h,m,mm,swift}",
    "ios/native/*.{h,m,mm,swift}",
    "ios/handlers/*.{h,m,mm,swift}",
    "ios/utils/*.{h,m,mm,swift}"
  ]

  # Initialize preserve_paths once
  preserve_paths = [
    "prebuilt/include/**",
    "prebuilt/include/module.modulemap",
    "prebuilt/ios/device/**",
    "prebuilt/ios/simulator/**"
  ]

  s.preserve_paths = preserve_paths

  # List of libraries to link (order matters for dependency resolution)
  sherpa_libraries = [
    "libkissfft-float.a",
    "libkaldi-native-fbank-core.a",
    "libkaldi-decoder-core.a",
    "libsherpa-onnx-fst.a",
    "libsherpa-onnx-fstfar.a",
    "libsherpa-onnx-kaldifst-core.a",
    "libsherpa-onnx-core.a",
    "libsherpa-onnx-c-api.a",
    "libpiper_phonemize.a",
    "libespeak-ng.a",
    "libssentencepiece_core.a",
    "libucd.a",
    "libonnxruntime.a"
  ]

  # Vendored libraries pointing to the current folder (will be symlinked later)
  s.vendored_libraries = sherpa_libraries.map { |lib| "prebuilt/ios/current/#{lib}" }

  s.frameworks = "Foundation", "CoreML", "Accelerate", "CoreVideo"
  s.libraries = "c++", "bz2"

  s.xcconfig = {
    "HEADER_SEARCH_PATHS" => "\"$(PODS_TARGET_SRCROOT)/prebuilt/include\"",
    "LIBRARY_SEARCH_PATHS" => "$(PODS_TARGET_SRCROOT)/prebuilt/ios/current",
    "SWIFT_INCLUDE_PATHS" => "\"$(PODS_TARGET_SRCROOT)/prebuilt/include\""
  }

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    "OTHER_LDFLAGS" => "-framework CoreML -framework Accelerate -framework CoreVideo",
    "DEFINES_MODULE" => "YES",
    "SWIFT_OBJC_BRIDGING_HEADER" => "",
    "SWIFT_INSTALL_OBJC_HEADER" => "YES",
    "SWIFT_OBJC_INTERFACE_HEADER_NAME" => "sherpa-onnx-rn-Swift.h",
    "APPLICATION_EXTENSION_API_ONLY" => "NO",
    "CLANG_ENABLE_MODULES" => "YES",
    "CLANG_ENABLE_CPP_STATIC_LIBRARY_TYPES" => "YES",
    "OTHER_SWIFT_FLAGS" => "-Xcc -fmodule-map-file=$(PODS_TARGET_SRCROOT)/prebuilt/include/module.modulemap"
  }

  # Set up initial symlinks to device libraries - this runs during pod installation
  s.prepare_command = <<-CMD
    echo "Creating prebuilt/ios/current directory"
    mkdir -p prebuilt/ios/current
    
    # Only setup the symlinks if they don't exist
    if [ ! -f prebuilt/ios/current/libonnxruntime.a ]; then
      echo "Setting up initial symlinks to device libraries"
      
      # First check if device libs exist
      if [ -d prebuilt/ios/device ]; then
        for lib in #{sherpa_libraries.join(" ")}; do
          if [ -f "prebuilt/ios/device/$lib" ]; then
            echo "Linking $lib from device folder"
            ln -sf "../device/$lib" "prebuilt/ios/current/$lib"
          else
            echo "Warning: Device library $lib not found"
          fi
        done
      else
        echo ""
        echo "ERROR: iOS libraries not found!"
        echo ""
        echo "The sherpa-onnx iOS libraries need to be built before using this package."
        echo ""
        echo "To fix this error, run the following commands:"
        echo "  cd $(pwd)"
        echo "  ./build-sherpa-ios.sh"
        echo ""
        echo "This will download and build the required iOS libraries."
        echo "The build process may take 5-10 minutes."
        echo ""
        exit 1
      fi
    else
      echo "Symlinks already exist, skipping"
    fi
  CMD

  # Dynamically update symlinks based on platform - this runs during build
  s.script_phase = {
    :name => "Link Sherpa ONNX Libraries",
    :script => '
      set -e
      CURRENT_DIR="${PODS_TARGET_SRCROOT}/prebuilt/ios/current"
      DEVICE_DIR="${PODS_TARGET_SRCROOT}/prebuilt/ios/device"
      SIMULATOR_DIR="${PODS_TARGET_SRCROOT}/prebuilt/ios/simulator"
      
      # Make sure the current directory exists
      mkdir -p "$CURRENT_DIR"
      
      # Remove existing symlinks
      rm -f "$CURRENT_DIR"/*.a
      
      # Check if building for simulator
      if [[ "$PLATFORM_NAME" == *simulator* ]]; then
        echo "Building for simulator, linking simulator libraries"
        if [ -d "$SIMULATOR_DIR" ]; then
          for lib in ' + sherpa_libraries.join(" ") + '; do
            if [ -f "$SIMULATOR_DIR/$lib" ]; then
              echo "Linking $lib from simulator"
              ln -sf "../simulator/$lib" "$CURRENT_DIR/$lib"
            else
              echo "Warning: Simulator library $lib not found"
            fi
          done
        else
          echo ""
          echo "ERROR: iOS Simulator libraries not found!"
          echo ""
          echo "Building for iOS Simulator but libraries are missing at:"
          echo "  $SIMULATOR_DIR"
          echo ""
          echo "To fix this error:"
          echo "  1. cd ${PODS_TARGET_SRCROOT}"
          echo "  2. ./build-sherpa-ios.sh"
          echo ""
          echo "This will build both device and simulator libraries."
          echo ""
          exit 1
        fi
      else
        echo "Building for device, linking device libraries"
        if [ -d "$DEVICE_DIR" ]; then
          for lib in ' + sherpa_libraries.join(" ") + '; do
            if [ -f "$DEVICE_DIR/$lib" ]; then
              echo "Linking $lib from device"
              ln -sf "../device/$lib" "$CURRENT_DIR/$lib"
            else
              echo "Warning: Device library $lib not found"
            fi
          done
        else
          echo ""
          echo "ERROR: iOS Device libraries not found!"
          echo ""
          echo "Building for iOS Device but libraries are missing at:"
          echo "  $DEVICE_DIR"
          echo ""
          echo "To fix this error:"
          echo "  1. cd ${PODS_TARGET_SRCROOT}"
          echo "  2. ./build-sherpa-ios.sh"
          echo ""
          echo "This will build both device and simulator libraries."
          echo ""
          exit 1
        fi
      fi
    ',
    :execution_position => :before_compile,
    :output_files => sherpa_libraries.map { |lib| "${PODS_TARGET_SRCROOT}/prebuilt/ios/current/#{lib}" }
  }

  # TurboModule dependencies -- install_modules_dependencies handles all RN deps
  install_modules_dependencies(s)
end