import ExpoModulesCore
import AudioStudio
import React

public class PlaygroundAPIModule: Module {
  // Get the audio module using the correct method from ModuleRegistry
  private var audioModule: AudioStudioModule? {
    // Safely unwrap appContext before accessing moduleRegistry
    guard let context = appContext else {
      return nil
    }
    // Use the moduleWithName method and cast to the correct type
    return context.moduleRegistry.get(moduleWithName: "AudioStudio") as? AudioStudioModule
  }

  private var audioProcessor: AudioProcessor?
  
  // Helper method to get Essentia module (matching Kotlin implementation but using Swift naming)
  private func getEssentiaModule() -> Any? {
    return essentiaModule
  }

  // Move helper methods to class scope
  private func listAvailableModules() -> [String] {
    guard let context = appContext else {
      print("[PlaygroundAPI] Warning: No app context available")
      return []
    }
    
    let moduleNames = context.moduleRegistry.getModuleNames()
    print("[PlaygroundAPI] All available modules:")
    
    for name in moduleNames {
      print("[PlaygroundAPI] - Module: \(name)")
    }
    
    return moduleNames
  }

  private func isModuleAvailable(_ className: String) -> Bool {
    guard let context = appContext else {
      return false
    }
    
    // First check if the class exists
    let classExists = NSClassFromString(className) != nil
    
    // Then check if it's registered in the module registry
    let moduleNames = context.moduleRegistry.getModuleNames()
    
    // Print all module names for debugging
    print("[PlaygroundAPI] Available modules for comparison:")
    moduleNames.forEach { name in
        print("[PlaygroundAPI] - '\(name)' vs '\(className)'")
    }
    
    // Exact match instead of contains
    let moduleExists = moduleNames.contains(className)
    
    print("[PlaygroundAPI] Checking module availability: \(className)")
    print("[PlaygroundAPI] - Class exists: \(classExists)")
    print("[PlaygroundAPI] - Module registered: \(moduleExists)")
    print("[PlaygroundAPI] - Module names: \(moduleNames)")
    
    return moduleExists // Return just moduleExists since we're checking exact names
  }

  // Get the Essentia module through React Native bridge
  private var essentiaModule: Any? {
    guard let bridge = RCTBridge.current() else {
        print("[PlaygroundAPI] Warning: No React bridge available")
        return nil
    }

    // Get module directly since we know it exists as "Essentia"
    if let module = bridge.module(forName: "Essentia") {
        print("[PlaygroundAPI] Found Essentia module: \(type(of: module))")
        return module
    }
    return nil
  }

  public func definition() -> ModuleDefinition {
   
    // Define the module using the correct pattern
    Name("PlaygroundAPI")
    
    Constants([
      "PI": Double.pi
    ])
    
    Events("onChange")
    
    Function("hello") {
      return "Hello world! 👋"
    }
    
    AsyncFunction("validateAudioProcessorIntegration") {
      do {
        // Try to create an AudioProcessor instance
        let processor = AudioProcessor(
          resolve: { _ in },
          reject: { _, _ in }
        )
        
        // Test creating a DecodingConfig
        let config = DecodingConfig(
          targetSampleRate: 44100,
          targetChannels: 1,
          targetBitDepth: 16,
          normalizeAudio: false
        )
        
        // Add a throw to make catch block reachable
        if arc4random_uniform(100) > 200 { // This condition is always false
          throw NSError(domain: "PlaygroundAPI", code: 999, userInfo: [NSLocalizedDescriptionKey: "Unreachable error"])
        }
        
        return [
          "audioProcessorInitialized": true,
          "audioProcessorClass": String(describing: type(of: processor)),
          "decodingConfigCreated": true,
          "decodingConfigClass": String(describing: type(of: config)),
          "success": true,
          "message": "AudioProcessor is properly integrated"
        ]
      } catch {
        return [
          "success": false,
          "error": error.localizedDescription,
          "errorType": String(describing: type(of: error))
        ]
      }
    }
    
    AsyncFunction("setValueAsync") { (value: String) in
      self.sendEvent("onChange", [
        "value": value
      ])
    }
    
    // Initialize the audio processor in the constructor or when needed
    AsyncFunction("initializeAudioProcessor") {
      self.audioProcessor = AudioProcessor(
        resolve: { _ in },
        reject: { _, _ in }
      )
      
      return [
        "success": true,
        "message": "Audio processor initialized successfully"
      ]
    }
    
    AsyncFunction("processAudio") { (fileUri: String) -> [String: Any] in
      // Lazy initialize the audioProcessor if it doesn't exist yet
      if self.audioProcessor == nil {
        self.audioProcessor = AudioProcessor(
          resolve: { _ in },
          reject: { _, _ in }
        )
      }
      
      guard self.audioProcessor != nil else {
        throw NSError(domain: "PlaygroundAPI", code: 1, userInfo: [NSLocalizedDescriptionKey: "Audio processor not available"])
      }
      
      // Use the URL initializer and then process the audio
      guard let url = URL(string: fileUri) else {
        throw NSError(domain: "PlaygroundAPI", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid file URI"])
      }
      
      // Create a new processor with the file URL
      let fileProcessor = try AudioProcessor(
        url: url,
        resolve: { _ in /* No-op resolve handler */ },
        reject: { _, _ in /* No-op reject handler */ }
      )
      
      // Extract audio features with default options
      let audioData = fileProcessor.processAudioData(
        numberOfSamples: nil,
        offset: 0,
        length: nil,
        segmentDurationMs: 100,
        featureOptions: [:],
        bitDepth: 16,
        numberOfChannels: 1
      )
      
      guard let data = audioData else {
        throw NSError(domain: "PlaygroundAPI", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to process audio data"])
      }
      
      return [
        "sampleRate": data.sampleRate,
        "channels": data.numberOfChannels,
        "bitDepth": data.bitDepth,
        "durationMs": data.durationMs,
        "dataPoints": data.dataPoints.count
      ]
    }
    
    AsyncFunction("processAudioWithModule") { (fileUri: String) -> [String: Any] in
      do {
        // Lazy initialize the audioProcessor if it doesn't exist yet
        if self.audioProcessor == nil {
          self.audioProcessor = AudioProcessor(
            resolve: { _ in },
            reject: { _, _ in }
          )
        }
        
        guard self.audioProcessor != nil else {
          return [
            "moduleAvailable": false,
            "error": "Audio processor not available"
          ]
        }
        
        // Use the URL initializer and then process the audio
        guard let url = URL(string: fileUri) else {
          return [
            "moduleAvailable": false,
            "error": "Invalid file URI"
          ]
        }
        
        // Create a new processor with the file URL
        let fileProcessor = try AudioProcessor(
          url: url,
          resolve: { _ in /* No-op resolve handler */ },
          reject: { _, _ in /* No-op reject handler */ }
        )
        
        // Use the processAudioData method with specific feature options
        let featureOptions: [String: Bool] = [
          "rms": true,
          "energy": true
        ]
        
        // Use the processAudioData method with mono channel configuration
        let audioData = fileProcessor.processAudioData(
          numberOfSamples: nil,
          offset: 0,
          length: nil,
          segmentDurationMs: 100,
          featureOptions: featureOptions,
          bitDepth: 16,
          numberOfChannels: 1  // Force mono channel
        )
        
        guard let data = audioData else {
          return [
            "moduleAvailable": false,
            "error": "Failed to process audio data"
          ]
        }
        
        return [
          "moduleAvailable": true,
          "message": "Successfully processed audio file",
          "durationMs": data.durationMs
        ]
      } catch {
        return [
          "moduleAvailable": false,
          "error": error.localizedDescription
        ]
      }
    }
    
    // Update validateEssentiaIntegration to match Kotlin implementation
    AsyncFunction("validateEssentiaIntegration") {
      var result: [String: Any] = [
        "success": true,
        "validationSteps": [] as [String]
      ]
      
      var steps = result["validationSteps"] as! [String]
      steps.append("Starting Essentia module validation")
      
      // Check Essentia module through React Native bridge
      if let essentia = essentiaModule {
        result["essentiaModuleImported"] = true
        result["essentiaModuleClass"] = String(describing: type(of: essentia))
        steps.append("Found Essentia module in React Native bridge")
        
        // Test native bridge by calling methods
        if let instance = essentia as? NSObject {
          steps.append("Attempting to call native methods")
          
          // Test testConnection method
          let testConnectionSelector = NSSelectorFromString("testConnection:rejecter:")
          if instance.responds(to: testConnectionSelector) {
            steps.append("Found testConnection method")
            print("[PlaygroundAPI] Calling testConnection...")
            
            // Create completion handlers and retain them
            let resolve: @convention(block) (Any?) -> Void = { value in
              print("[PlaygroundAPI] testConnection resolved with:", value ?? "nil")
              if let testResult = value as? String {
                result["jniTestResult"] = testResult
                result["jniConnectionSuccessful"] = true
                steps.append("Successfully called testConnection: \(testResult)")
              }
            }
            
            let reject: @convention(block) (String?, String?, Error?) -> Void = { code, message, error in
              print("[PlaygroundAPI] testConnection rejected:", message ?? "unknown error")
              result["jniConnectionSuccessful"] = false
              result["jniConnectionError"] = message
              steps.append("testConnection failed: \(message ?? "unknown error")")
            }
            
            // Convert blocks to objects and retain them
            let resolveObject = unsafeBitCast(resolve, to: AnyObject.self)
            let rejectObject = unsafeBitCast(reject, to: AnyObject.self)
            
            // Perform the selector with retained objects
            _ = instance.perform(testConnectionSelector, with: resolveObject, with: rejectObject)
            print("[PlaygroundAPI] testConnection call completed")
          } else {
            steps.append("Method 'testConnection:rejecter:' not found")
            result["jniConnectionSuccessful"] = false
          }
          
          // Test getVersion method
          let versionSelector = NSSelectorFromString("getVersion:rejecter:")
          if instance.responds(to: versionSelector) {
            steps.append("Found getVersion method")
            print("[PlaygroundAPI] Calling getVersion...")
            
            let resolve: @convention(block) (Any?) -> Void = { value in
              print("[PlaygroundAPI] getVersion resolved with:", value ?? "nil")
              if let version = value as? String {
                result["version"] = version
                steps.append("Successfully got version: \(version)")
              }
            }
            
            let reject: @convention(block) (String?, String?, Error?) -> Void = { code, message, error in
              print("[PlaygroundAPI] getVersion rejected:", message ?? "unknown error")
              steps.append("getVersion failed: \(message ?? "unknown error")")
            }
            
            let resolveObject = unsafeBitCast(resolve, to: AnyObject.self)
            let rejectObject = unsafeBitCast(reject, to: AnyObject.self)
            
            _ = instance.perform(versionSelector, with: resolveObject, with: rejectObject)
            print("[PlaygroundAPI] getVersion call completed")
          } else {
            steps.append("Method 'getVersion:rejecter:' not found")
          }
          
          // Test initialize method
          let initializeSelector = NSSelectorFromString("initialize:rejecter:")
          if instance.responds(to: initializeSelector) {
            steps.append("Found initialize method")
            print("[PlaygroundAPI] Calling initialize...")
            
            let resolve: @convention(block) (Any?) -> Void = { value in
              print("[PlaygroundAPI] initialize resolved with:", value ?? "nil")
              if let initResult = value as? Bool {
                result["initializeSuccessful"] = initResult
                steps.append("Successfully called initialize: \(initResult)")
              }
            }
            
            let reject: @convention(block) (String?, String?, Error?) -> Void = { code, message, error in
              print("[PlaygroundAPI] initialize rejected:", message ?? "unknown error")
              steps.append("initialize failed: \(message ?? "unknown error")")
            }
            
            let resolveObject = unsafeBitCast(resolve, to: AnyObject.self)
            let rejectObject = unsafeBitCast(reject, to: AnyObject.self)
            
            _ = instance.perform(initializeSelector, with: resolveObject, with: rejectObject)
            print("[PlaygroundAPI] initialize call completed")
          } else {
            steps.append("Method 'initialize:rejecter:' not found")
          }
          
          print("[PlaygroundAPI] All method calls completed")
          print("[PlaygroundAPI] Validation steps:", steps)
          print("[PlaygroundAPI] Result:", result)
        } else {
          steps.append("Failed to cast module instance to NSObject")
          result["success"] = false
        }
      } else {
        result["essentiaModuleImported"] = false
        result["essentiaModuleError"] = "Module not found in React Native bridge"
        steps.append("Failed to find Essentia module in React Native bridge")
        result["success"] = false
      }
      
      result["validationSteps"] = steps
      return result
    }

    AsyncFunction("checkModuleImports") {
      print("[PlaygroundAPI] Starting module imports check...")
      var result: [String: Any] = [:]
      
      // Check AudioProcessor
      if let audioModule = audioModule {
          print("[PlaygroundAPI] AudioModule found: \(String(describing: type(of: audioModule)))")
          result["audioModuleImported"] = true
          result["audioModuleClass"] = String(describing: type(of: audioModule))
          
          // Try to create an AudioProcessor instance
          do {
              let url = URL(string: "file://test.wav")!
              let processor = try AudioProcessor(
                  url: url,
                  resolve: { _ in },
                  reject: { _, _ in }
              )
              result["audioProcessorImported"] = true
              result["audioProcessorClass"] = String(describing: type(of: processor))
          } catch {
              print("[PlaygroundAPI] Error during audio processing tests: \(error)")
              result["audioProcessorError"] = error.localizedDescription
          }
      } else {
          result["audioModuleImported"] = false
          result["audioModuleError"] = "Module not found"
      }
      
      // Check Essentia (as a React Native module)
      if let essentia = essentiaModule {
          result["essentiaModuleImported"] = true
          result["essentiaModuleClass"] = String(describing: type(of: essentia))
          result["essentiaModuleType"] = "react-native"
      } else {
          result["essentiaModuleImported"] = false
          result["essentiaModuleError"] = "Module not found in React Native bridge"
          result["essentiaModuleType"] = "react-native"
      }
      
      // Add list of available modules
      result["availableModules"] = listAvailableModules()
      
      // Check specific modules
      let modules = [
          ["name": "AudioStudio", "class": "AudioStudio"],
          ["name": "PlaygroundAPI", "class": "PlaygroundAPI"]
      ]
      
      result["modules"] = modules.map { moduleInfo -> [String: Any] in
          let name = moduleInfo["name"]!
          return ["name": name, "exists": isModuleAvailable(name)]
      }
      
      result["success"] = true
      return result
    }
    
    AsyncFunction("testEssentiaVersion") { (promise: Promise) in
        if let essentia = essentiaModule {
            if let instance = essentia as? NSObject {
                let versionSelector = NSSelectorFromString("getVersion:rejecter:")
                if instance.responds(to: versionSelector) {
                    print("[PlaygroundAPI] Calling getVersion...")
                    
                    let resolve: @convention(block) (Any?) -> Void = { value in
                        print("[PlaygroundAPI] getVersion resolved with:", value ?? "nil")
                        if let version = value as? String {
                            promise.resolve([
                                "success": true,
                                "version": version
                            ])
                        } else {
                            promise.reject("NO_VERSION", "Version returned was nil")
                        }
                    }
                    
                    let reject: @convention(block) (String?, String?, Error?) -> Void = { code, message, error in
                        print("[PlaygroundAPI] getVersion rejected:", message ?? "unknown error")
                        promise.reject(code ?? "ERROR", message ?? "Unknown error")
                    }
                    
                    let resolveObject = unsafeBitCast(resolve, to: AnyObject.self)
                    let rejectObject = unsafeBitCast(reject, to: AnyObject.self)
                    
                    _ = instance.perform(versionSelector, with: resolveObject, with: rejectObject)
                    print("[PlaygroundAPI] getVersion call completed")
                } else {
                    promise.reject("METHOD_NOT_FOUND", "getVersion method not found")
                }
            } else {
                promise.reject("CAST_ERROR", "Failed to cast Essentia module to NSObject")
            }
        } else {
            promise.reject("MODULE_NOT_FOUND", "Essentia module not found")
        }
    }
    
    View(PlaygroundAPIView.self) {
      Prop("url") { (view: PlaygroundAPIView, url: URL) in
        if view.webView.url != url {
          view.webView.load(URLRequest(url: url))
        }
      }
      
      Events("onLoad")
    }
  }
}
