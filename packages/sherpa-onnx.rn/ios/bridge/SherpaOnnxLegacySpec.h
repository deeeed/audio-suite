// packages/sherpa-onnx.rn/ios/bridge/SherpaOnnxSpec.h
// Defines the TurboModule interface (new architecture only).

#ifdef RCT_NEW_ARCH_ENABLED
#pragma once

#import <React/RCTBridgeModule.h>

/**
 * Protocol that defines the interface for the SherpaOnnx native module.
 * This is used by the codegen system to generate the C++ interfaces.
 */
@protocol SherpaOnnxSpec <RCTBridgeModule>

/**
 * Validates if the native library is properly loaded and returns
 * basic configuration information.
 */
- (void)validateLibraryLoaded:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject;

/**
 * Tests the integration with the ONNX runtime and returns results.
 */
- (void)testOnnxIntegration:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject;

/**
 * Create an ASR recognizer with the specified configuration
 */
- (void)createRecognizer:(NSDictionary *)config
                resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject;

/**
 * TTS methods
 */
- (void)initTts:(NSDictionary *)config
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject;

- (void)generateTts:(NSDictionary *)config
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject;

- (void)stopTts:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject;

- (void)releaseTts:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject;

/**
 * ASR methods
 */
- (void)initAsr:(NSDictionary *)config
       resolver:(RCTPromiseResolveBlock)resolve
       rejecter:(RCTPromiseRejectBlock)reject;

- (void)recognizeFromSamples:(nonnull NSNumber *)sampleRate
                     samples:(nonnull NSArray<NSNumber *> *)samples
                    resolver:(RCTPromiseResolveBlock)resolve
                    rejecter:(RCTPromiseRejectBlock)reject;

- (void)recognizeFromFile:(NSString *)filePath
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject;

- (void)releaseAsr:(RCTPromiseResolveBlock)resolve
          rejecter:(RCTPromiseRejectBlock)reject;

/**
 * Audio tagging methods
 */
- (void)initAudioTagging:(NSDictionary *)config
               resolver:(RCTPromiseResolveBlock)resolve
               rejecter:(RCTPromiseRejectBlock)reject;

- (void)processAndComputeAudioTagging:(NSString *)filePath
                            resolver:(RCTPromiseResolveBlock)resolve
                            rejecter:(RCTPromiseRejectBlock)reject;

- (void)processAndComputeAudioSamples:(nonnull NSNumber *)sampleRate
                             samples:(nonnull NSArray<NSNumber *> *)samples
                            resolver:(RCTPromiseResolveBlock)resolve
                            rejecter:(RCTPromiseRejectBlock)reject;

- (void)releaseAudioTagging:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject;

/**
 * Speaker ID methods
 */
- (void)initSpeakerId:(NSDictionary *)config
            resolver:(RCTPromiseResolveBlock)resolve
            rejecter:(RCTPromiseRejectBlock)reject;

- (void)processSpeakerIdSamples:(nonnull NSNumber *)sampleRate
                       samples:(nonnull NSArray<NSNumber *> *)samples
                      resolver:(RCTPromiseResolveBlock)resolve
                      rejecter:(RCTPromiseRejectBlock)reject;

- (void)computeSpeakerEmbedding:(RCTPromiseResolveBlock)resolve
                      rejecter:(RCTPromiseRejectBlock)reject;

- (void)registerSpeaker:(NSString *)name
             embedding:(nonnull NSArray<NSNumber *> *)embedding
              resolver:(RCTPromiseResolveBlock)resolve
              rejecter:(RCTPromiseRejectBlock)reject;

- (void)removeSpeaker:(NSString *)name
            resolver:(RCTPromiseResolveBlock)resolve
            rejecter:(RCTPromiseRejectBlock)reject;

- (void)getSpeakers:(RCTPromiseResolveBlock)resolve
          rejecter:(RCTPromiseRejectBlock)reject;

- (void)identifySpeaker:(nonnull NSArray<NSNumber *> *)embedding
              threshold:(nonnull NSNumber *)threshold
               resolver:(RCTPromiseResolveBlock)resolve
               rejecter:(RCTPromiseRejectBlock)reject;

- (void)verifySpeaker:(NSString *)name
           embedding:(nonnull NSArray<NSNumber *> *)embedding
           threshold:(nonnull NSNumber *)threshold
            resolver:(RCTPromiseResolveBlock)resolve
            rejecter:(RCTPromiseRejectBlock)reject;

- (void)processSpeakerIdFile:(NSString *)filePath
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject;

- (void)processSpeakerIdFileWindow:(NSString *)filePath
                        startTimeMs:(double)startTimeMs
                         durationMs:(double)durationMs
                           resolver:(RCTPromiseResolveBlock)resolve
                           rejecter:(RCTPromiseRejectBlock)reject;

- (void)releaseSpeakerId:(RCTPromiseResolveBlock)resolve
               rejecter:(RCTPromiseRejectBlock)reject;

/**
 * Archive methods
 */
- (void)extractTarBz2:(NSString *)sourcePath
          targetDir:(NSString *)targetDir
           resolver:(RCTPromiseResolveBlock)resolve
           rejecter:(RCTPromiseRejectBlock)reject;

@end

#endif // RCT_NEW_ARCH_ENABLED
