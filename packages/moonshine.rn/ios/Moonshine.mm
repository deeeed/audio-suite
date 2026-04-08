#import "Moonshine.h"

#import <React/RCTLog.h>

#import <deque>
#import <mutex>
#import <optional>
#import <string>
#import <unordered_map>
#import <vector>

#include "moonshine-c-api.h"

static NSString *const MoonshineEventName = @"MoonshineTranscriptEvent";
static NSString *const MoonshineErrorDomain = @"net.siteed.moonshine";
static const NSInteger MoonshineErrorCodeGeneric = -1;

namespace {

struct IntentMatch {
  std::string triggerPhrase;
  std::string utterance;
  float similarity;
};

struct TranscriberOptionBuffer {
  std::deque<std::string> names;
  std::deque<std::string> values;
  std::vector<transcriber_option_t> options;
};

std::mutex gIntentMatchMutex;
std::unordered_map<int32_t, IntentMatch> gLastIntentMatches;

void ClearIntentMatch(int32_t handle) {
  std::lock_guard<std::mutex> lock(gIntentMatchMutex);
  gLastIntentMatches.erase(handle);
}

std::optional<IntentMatch> TakeIntentMatch(int32_t handle) {
  std::lock_guard<std::mutex> lock(gIntentMatchMutex);
  auto iterator = gLastIntentMatches.find(handle);
  if (iterator == gLastIntentMatches.end()) {
    return std::nullopt;
  }
  auto match = iterator->second;
  gLastIntentMatches.erase(iterator);
  return match;
}

void MoonshineIntentCallback(
    void *userData,
    const char *triggerPhrase,
    const char *utterance,
    float similarity
) {
  const auto handle = static_cast<int32_t>(reinterpret_cast<intptr_t>(userData));
  std::lock_guard<std::mutex> lock(gIntentMatchMutex);
  IntentMatch match;
  match.triggerPhrase = triggerPhrase != nullptr ? triggerPhrase : "";
  match.utterance = utterance != nullptr ? utterance : "";
  match.similarity = similarity;
  gLastIntentMatches[handle] = match;
}

NSString *StringFromCString(const char *value) {
  if (value == nullptr) {
    return @"";
  }
  return [NSString stringWithUTF8String:value] ?: @"";
}

NSString *StringFromValue(id value) {
  if (value == nil || value == (id)kCFNull) {
    return nil;
  }
  if ([value isKindOfClass:NSString.class]) {
    return value;
  }
  if ([value isKindOfClass:NSNumber.class]) {
    return [(NSNumber *)value stringValue];
  }
  return nil;
}

NSNumber *NumberFromValue(id value) {
  if (value == nil || value == (id)kCFNull) {
    return nil;
  }
  if ([value isKindOfClass:NSNumber.class]) {
    return value;
  }
  if ([value isKindOfClass:NSString.class]) {
    NSString *stringValue = (NSString *)value;
    if (stringValue.length == 0) {
      return nil;
    }
    return @([stringValue doubleValue]);
  }
  return nil;
}

BOOL BoolFromValue(id value) {
  if (value == nil || value == (id)kCFNull) {
    return NO;
  }
  if ([value isKindOfClass:NSNumber.class]) {
    return [(NSNumber *)value boolValue];
  }
  if ([value isKindOfClass:NSString.class]) {
    return [(NSString *)value boolValue];
  }
  return NO;
}

NSString *TrimmedPathString(NSString *value) {
  if (value == nil) {
    return nil;
  }
  NSString *trimmed = [value stringByTrimmingCharactersInSet:
      [NSCharacterSet whitespaceAndNewlineCharacterSet]];
  while ([trimmed hasPrefix:@"/"]) {
    trimmed = [trimmed substringFromIndex:1];
  }
  while ([trimmed hasSuffix:@"/"]) {
    trimmed = [trimmed substringToIndex:trimmed.length - 1];
  }
  return trimmed;
}

NSString *ResolvedLocalPathString(NSString *value) {
  if (value == nil) {
    return nil;
  }
  NSString *trimmed = [value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if ([trimmed length] == 0) {
    return trimmed;
  }
  if ([trimmed hasPrefix:@"file://"]) {
    NSURL *url = [NSURL URLWithString:trimmed];
    if (url.fileURL && url.path.length > 0) {
      return url.path;
    }
    return [trimmed stringByRemovingPercentEncoding] ?: trimmed;
  }
  return trimmed;
}

BOOL IsStrictIntegerString(NSString *value) {
  if (value.length == 0) {
    return NO;
  }
  NSCharacterSet *nonDigits = [[NSCharacterSet decimalDigitCharacterSet] invertedSet];
  return [value rangeOfCharacterFromSet:nonDigits].location == NSNotFound;
}

std::vector<float> FloatVectorFromArray(NSArray *samples) {
  std::vector<float> result;
  result.reserve(samples.count);
  for (id value in samples) {
    result.push_back(NumberFromValue(value).floatValue);
  }
  return result;
}

std::vector<uint8_t> ByteVectorFromArray(NSArray *bytes) {
  std::vector<uint8_t> result;
  result.reserve(bytes.count);
  for (id value in bytes) {
    result.push_back(static_cast<uint8_t>(NumberFromValue(value).unsignedCharValue));
  }
  return result;
}

NSArray<NSNumber *> *AudioArrayFromPointer(const float *audioData, size_t count) {
  if (audioData == nullptr || count == 0) {
    return @[];
  }
  const uint64_t maxReasonableCount = 10'000'000;
  size_t safeCount = static_cast<size_t>(MIN(static_cast<uint64_t>(count), maxReasonableCount));
  NSMutableArray<NSNumber *> *result = [NSMutableArray arrayWithCapacity:safeCount];
  for (size_t index = 0; index < safeCount; index += 1) {
    [result addObject:@(audioData[index])];
  }
  return result;
}

NSArray<NSDictionary *> *WordsArrayFromTranscriptLine(const transcript_line_t &line) {
  if (line.words == nullptr || line.word_count == 0) {
    return @[];
  }

  NSMutableArray<NSDictionary *> *result =
      [NSMutableArray arrayWithCapacity:static_cast<NSUInteger>(line.word_count)];
  for (uint64_t index = 0; index < line.word_count; index += 1) {
    const transcript_word_t &word = line.words[index];
    [result addObject:@{
      @"word": StringFromCString(word.text),
      @"startTimeMs": @((double)word.start * 1000.0),
      @"endTimeMs": @((double)word.end * 1000.0),
      @"confidence": @(word.confidence),
    }];
  }
  return result;
}

NSDictionary *LineDictionaryFromTranscriptLine(
    const transcript_line_t &line,
    BOOL includeAudioData
) {
  NSMutableDictionary *result = [NSMutableDictionary dictionary];
  NSString *lineId = [NSString stringWithFormat:@"%llu", line.id];
  double startedAtMs = (double)line.start_time * 1000.0;
  double durationMs = (double)line.duration * 1000.0;

  result[@"lineId"] = lineId;
  result[@"text"] = StringFromCString(line.text);
  result[@"isFinal"] = @(line.is_complete != 0);
  result[@"isNew"] = @(line.is_new != 0);
  result[@"isUpdated"] = @(line.is_updated != 0);
  result[@"startedAtMs"] = @(startedAtMs);
  result[@"durationMs"] = @(durationMs);
  result[@"hasTextChanged"] = @(line.has_text_changed != 0);
  result[@"hasSpeakerId"] = @(line.has_speaker_id != 0);
  result[@"lastTranscriptionLatencyMs"] = @(line.last_transcription_latency_ms);

  if (line.is_complete != 0) {
    result[@"completedAtMs"] = @(startedAtMs + durationMs);
  }
  if (line.has_speaker_id != 0) {
    result[@"speakerId"] = [NSString stringWithFormat:@"%llu", line.speaker_id];
    result[@"speakerIndex"] = @(line.speaker_index);
  }
  if (includeAudioData && line.audio_data != nullptr && line.audio_data_count > 0) {
    result[@"audioData"] = AudioArrayFromPointer(line.audio_data, line.audio_data_count);
  }
  if (line.words != nullptr && line.word_count > 0) {
    result[@"words"] = WordsArrayFromTranscriptLine(line);
  }

  return result;
}

NSString *TranscriptTextFromLineMaps(NSArray<NSDictionary *> *lines) {
  NSMutableArray<NSString *> *segments = [NSMutableArray arrayWithCapacity:lines.count];
  for (NSDictionary *line in lines) {
    NSString *text = [StringFromValue(line[@"text"]) stringByTrimmingCharactersInSet:
        [NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (text.length > 0) {
      [segments addObject:text];
    }
  }
  return [segments componentsJoinedByString:@" "];
}

NSError *MoonshineNSError(NSString *message, NSInteger code = MoonshineErrorCodeGeneric) {
  return [NSError errorWithDomain:MoonshineErrorDomain
                             code:code
                         userInfo:@{NSLocalizedDescriptionKey: message ?: @"Moonshine error"}];
}

void ThrowNSError(NSString *message, NSInteger code = MoonshineErrorCodeGeneric) {
  @throw MoonshineNSError(message, code);
}

NSError *MoonshineNSErrorFromException(id exception) {
  if ([exception isKindOfClass:NSError.class]) {
    return (NSError *)exception;
  }
  if ([exception isKindOfClass:NSException.class]) {
    NSException *objcException = (NSException *)exception;
    return MoonshineNSError(objcException.reason ?: objcException.description);
  }
  return MoonshineNSError([exception description] ?: @"Moonshine error");
}

void RejectPromiseWithError(
    RCTPromiseRejectBlock reject,
    NSError *error,
    NSString *code = @"MOONSHINE_ERROR"
) {
  reject(code, error.localizedDescription ?: @"Moonshine error", error);
}

void ThrowIfMoonshineError(int32_t code, NSString *operation) {
  if (code == MOONSHINE_ERROR_NONE) {
    return;
  }
  NSString *reason = StringFromCString(moonshine_error_to_string(code));
  ThrowNSError([NSString stringWithFormat:@"Failed to %@: %@ (%d)", operation, reason, code], code);
}

void ThrowIfNegativeHandle(int32_t handle, NSString *operation) {
  if (handle >= 0) {
    return;
  }
  NSString *reason = StringFromCString(moonshine_error_to_string(handle));
  ThrowNSError([NSString stringWithFormat:@"Failed to %@: %@ (%d)", operation, reason, handle], handle);
}

} // namespace

@interface MoonshineStreamState : NSObject
@property(nonatomic, strong) NSMutableArray<NSString *> *orderedLineIds;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *linesById;
@property(nonatomic, strong) NSMutableSet<NSString *> *completedLineIds;
@end

@implementation MoonshineStreamState
- (instancetype)init {
  self = [super init];
  if (self) {
    _orderedLineIds = [NSMutableArray array];
    _linesById = [NSMutableDictionary dictionary];
    _completedLineIds = [NSMutableSet set];
  }
  return self;
}
@end

@interface MoonshineTranscriberState : NSObject
@property(nonatomic, assign) int32_t handle;
@property(nonatomic, assign) int32_t defaultStreamHandle;
@property(nonatomic, assign) BOOL includeAudioDataInLines;
@property(nonatomic, strong) NSMutableSet<NSNumber *> *activeStreamHandles;
@property(nonatomic, strong)
    NSMutableDictionary<NSNumber *, MoonshineStreamState *> *streamStates;
@end

@implementation MoonshineTranscriberState
- (instancetype)init {
  self = [super init];
  if (self) {
    _activeStreamHandles = [NSMutableSet set];
    _streamStates = [NSMutableDictionary dictionary];
  }
  return self;
}
@end

@interface MoonshineParsedStreamId : NSObject
@property(nonatomic, copy) NSString *transcriberId;
@property(nonatomic, assign) int32_t handle;
@end

@implementation MoonshineParsedStreamId
@end

@interface Moonshine ()
@property(nonatomic, strong) dispatch_queue_t moonshineQueue;
@property(nonatomic, assign) BOOL hasListeners;
@property(nonatomic, assign) NSInteger transcriberCounter;
@property(nonatomic, copy) NSString *defaultTranscriberId;
@property(nonatomic, strong)
    NSMutableDictionary<NSString *, MoonshineTranscriberState *> *transcriberStates;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *intentRecognizerHandles;
@end

@implementation Moonshine

RCT_EXPORT_MODULE(Moonshine)

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _moonshineQueue = dispatch_queue_create("net.siteed.moonshine", DISPATCH_QUEUE_SERIAL);
    _transcriberCounter = 1;
    _transcriberStates = [NSMutableDictionary dictionary];
    _intentRecognizerHandles = [NSMutableDictionary dictionary];
  }
  return self;
}

- (dispatch_queue_t)methodQueue {
  return self.moonshineQueue;
}

- (void)invalidate {
  [self releaseAllInternal];
  [super invalidate];
}

- (NSArray<NSString *> *)supportedEvents {
  return @[MoonshineEventName];
}

- (void)startObserving {
  self.hasListeners = YES;
}

- (void)stopObserving {
  self.hasListeners = NO;
}

RCT_EXPORT_METHOD(addAudio:(nonnull NSNumber *)sampleRate
                  samples:(NSArray *)samples
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withDefaultTranscriberRejecter:reject block:^(NSString *transcriberId, MoonshineTranscriberState *state) {
    [self addAudioToTrackedStreamForTranscriber:transcriberId
                                          state:state
                                     streamHandle:state.defaultStreamHandle
                                      sampleRate:sampleRate.intValue
                                          samples:samples];
    resolve([self successMap]);
  }];
}

RCT_EXPORT_METHOD(addAudioForTranscriber:(NSString *)transcriberId
                  sampleRate:(nonnull NSNumber *)sampleRate
                  samples:(NSArray *)samples
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withTranscriber:transcriberId rejecter:reject block:^(NSString *resolvedId, MoonshineTranscriberState *state) {
    [self addAudioToTrackedStreamForTranscriber:resolvedId
                                          state:state
                                     streamHandle:state.defaultStreamHandle
                                      sampleRate:sampleRate.intValue
                                          samples:samples];
    resolve([self successMap]);
  }];
}

RCT_EXPORT_METHOD(addAudioToStream:(NSString *)streamId
                  sampleRate:(nonnull NSNumber *)sampleRate
                  samples:(NSArray *)samples
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    MoonshineParsedStreamId *parsedStreamId = [self parseStreamId:streamId];
    [self addAudioToStreamForTranscriber:parsedStreamId.transcriberId
                                streamId:streamId
                              sampleRate:sampleRate
                                 samples:samples
                                resolver:resolve
                                rejecter:reject];
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

RCT_EXPORT_METHOD(addAudioToStreamForTranscriber:(NSString *)transcriberId
                  streamId:(NSString *)streamId
                  sampleRate:(nonnull NSNumber *)sampleRate
                  samples:(NSArray *)samples
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withTranscriber:transcriberId rejecter:reject block:^(NSString *resolvedId, MoonshineTranscriberState *state) {
    int32_t streamHandle = [self parseStreamHandleForTranscriber:resolvedId streamId:streamId];
    [self addAudioToTrackedStreamForTranscriber:resolvedId
                                          state:state
                                     streamHandle:streamHandle
                                      sampleRate:sampleRate.intValue
                                          samples:samples];
    resolve([self successMap]);
  }];
}

RCT_EXPORT_METHOD(clearIntents:(NSString *)intentRecognizerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    int32_t handle = [self parseIntentRecognizerId:intentRecognizerId];
    ThrowIfMoonshineError(moonshine_clear_intents(handle), @"clear intents");
    ClearIntentMatch(handle);
    resolve([self successMap]);
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

RCT_EXPORT_METHOD(createIntentRecognizer:(NSDictionary *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    NSString *modelPath = ResolvedLocalPathString(StringFromValue(config[@"modelPath"]));
    if (modelPath.length == 0) {
      ThrowNSError(@"Moonshine intent modelPath is required");
    }
    if (![[NSFileManager defaultManager] fileExistsAtPath:modelPath]) {
      ThrowNSError([NSString stringWithFormat:@"Moonshine intent model path does not exist: %@", modelPath]);
    }
    int32_t modelArch = [self resolveIntentModelArch:config];
    NSString *modelVariant = StringFromValue(config[@"modelVariant"]);
    float threshold = NumberFromValue(config[@"threshold"]) != nil ? NumberFromValue(config[@"threshold"]).floatValue : 0.7f;

    int32_t handle = moonshine_create_intent_recognizer(
        modelPath.UTF8String,
        static_cast<uint32_t>(modelArch),
        modelVariant.length > 0 ? modelVariant.UTF8String : nullptr,
        threshold);
    ThrowIfNegativeHandle(handle, @"create intent recognizer");

    NSString *intentRecognizerId = [self intentRecognizerIdForHandle:handle];
    self.intentRecognizerHandles[intentRecognizerId] = @(handle);

    NSMutableDictionary *result = [self successMap];
    result[@"intentRecognizerId"] = intentRecognizerId;
    resolve(result);
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

RCT_EXPORT_METHOD(createStream:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withDefaultTranscriberRejecter:reject block:^(NSString *transcriberId, MoonshineTranscriberState *state) {
    NSString *streamId = [self createStreamForTranscriberState:transcriberId state:state];
    NSMutableDictionary *result = [self successMap];
    result[@"streamId"] = streamId;
    resolve(result);
  }];
}

RCT_EXPORT_METHOD(createStreamForTranscriber:(NSString *)transcriberId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withTranscriber:transcriberId rejecter:reject block:^(NSString *resolvedId, MoonshineTranscriberState *state) {
    NSString *streamId = [self createStreamForTranscriberState:resolvedId state:state];
    NSMutableDictionary *result = [self successMap];
    result[@"streamId"] = streamId;
    resolve(result);
  }];
}

RCT_EXPORT_METHOD(createTranscriberFromAssets:(NSDictionary *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self createTranscriber:config resolver:resolve assignAsDefault:NO loader:^int32_t(std::vector<transcriber_option_t> &options) {
    NSString *assetPath = StringFromValue(config[@"assetPath"]);
    NSString *resolvedAssetPath = [self resolveAssetModelPath:assetPath];
    return moonshine_load_transcriber_from_files(
        resolvedAssetPath.UTF8String,
        static_cast<uint32_t>([self resolveModelArch:config]),
        options.empty() ? nullptr : options.data(),
        static_cast<uint64_t>(options.size()),
        MOONSHINE_HEADER_VERSION);
  }];
}

RCT_EXPORT_METHOD(createTranscriberFromFiles:(NSDictionary *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self createTranscriber:config resolver:resolve assignAsDefault:NO loader:^int32_t(std::vector<transcriber_option_t> &options) {
    NSString *modelPath = ResolvedLocalPathString(StringFromValue(config[@"modelPath"]));
    if (modelPath.length == 0) {
      ThrowNSError(@"Moonshine modelPath is required");
    }
    if (![[NSFileManager defaultManager] fileExistsAtPath:modelPath]) {
      ThrowNSError([NSString stringWithFormat:@"Moonshine model path does not exist: %@", modelPath]);
    }
    return moonshine_load_transcriber_from_files(
        modelPath.UTF8String,
        static_cast<uint32_t>([self resolveModelArch:config]),
        options.empty() ? nullptr : options.data(),
        static_cast<uint64_t>(options.size()),
        MOONSHINE_HEADER_VERSION);
  }];
}

RCT_EXPORT_METHOD(createTranscriberFromMemory:(NSDictionary *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self createTranscriber:config resolver:resolve assignAsDefault:NO loader:^int32_t(std::vector<transcriber_option_t> &options) {
    NSArray *modelData = config[@"modelData"];
    if (![modelData isKindOfClass:NSArray.class] || modelData.count != 3) {
      ThrowNSError(@"Moonshine modelData must contain exactly 3 binary parts");
    }
    auto encoderData = ByteVectorFromArray(modelData[0]);
    auto decoderData = ByteVectorFromArray(modelData[1]);
    auto tokenizerData = ByteVectorFromArray(modelData[2]);
    int32_t modelArch = [self resolveModelArch:config];
    return moonshine_load_transcriber_from_memory(
        encoderData.data(),
        encoderData.size(),
        decoderData.data(),
        decoderData.size(),
        tokenizerData.data(),
        tokenizerData.size(),
        static_cast<uint32_t>(modelArch),
        options.empty() ? nullptr : options.data(),
        static_cast<uint64_t>(options.size()),
        MOONSHINE_HEADER_VERSION);
  }];
}

RCT_EXPORT_METHOD(errorToString:(nonnull NSNumber *)code
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(StringFromCString(moonshine_error_to_string(code.intValue)));
}

RCT_EXPORT_METHOD(getIntentCount:(NSString *)intentRecognizerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    int32_t handle = [self parseIntentRecognizerId:intentRecognizerId];
    int32_t count = moonshine_get_intent_count(handle);
    if (count < 0) {
      ThrowNSError([NSString stringWithFormat:@"Failed to get Moonshine intent count: %@", StringFromCString(moonshine_error_to_string(count))], count);
    }
    resolve(@(count));
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

RCT_EXPORT_METHOD(getIntentThreshold:(NSString *)intentRecognizerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    int32_t handle = [self parseIntentRecognizerId:intentRecognizerId];
    float threshold = moonshine_get_intent_threshold(handle);
    if (threshold < 0) {
      ThrowNSError([NSString stringWithFormat:@"Failed to get Moonshine intent threshold: %@", StringFromCString(moonshine_error_to_string((int32_t)threshold))], (NSInteger)threshold);
    }
    resolve(@(threshold));
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

RCT_EXPORT_METHOD(getVersion:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(@(MOONSHINE_HEADER_VERSION));
}

RCT_EXPORT_METHOD(initialize:(NSDictionary *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self loadFromFiles:config resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(loadFromAssets:(NSDictionary *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self createTranscriber:config resolver:resolve assignAsDefault:YES loader:^int32_t(std::vector<transcriber_option_t> &options) {
    NSString *assetPath = StringFromValue(config[@"assetPath"]);
    NSString *resolvedAssetPath = [self resolveAssetModelPath:assetPath];
    return moonshine_load_transcriber_from_files(
        resolvedAssetPath.UTF8String,
        static_cast<uint32_t>([self resolveModelArch:config]),
        options.empty() ? nullptr : options.data(),
        static_cast<uint64_t>(options.size()),
        MOONSHINE_HEADER_VERSION);
  }];
}

RCT_EXPORT_METHOD(loadFromFiles:(NSDictionary *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self createTranscriber:config resolver:resolve assignAsDefault:YES loader:^int32_t(std::vector<transcriber_option_t> &options) {
    NSString *modelPath = ResolvedLocalPathString(StringFromValue(config[@"modelPath"]));
    if (modelPath.length == 0) {
      ThrowNSError(@"Moonshine modelPath is required");
    }
    if (![[NSFileManager defaultManager] fileExistsAtPath:modelPath]) {
      ThrowNSError([NSString stringWithFormat:@"Moonshine model path does not exist: %@", modelPath]);
    }
    return moonshine_load_transcriber_from_files(
        modelPath.UTF8String,
        static_cast<uint32_t>([self resolveModelArch:config]),
        options.empty() ? nullptr : options.data(),
        static_cast<uint64_t>(options.size()),
        MOONSHINE_HEADER_VERSION);
  }];
}

RCT_EXPORT_METHOD(loadFromMemory:(NSDictionary *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self createTranscriber:config resolver:resolve assignAsDefault:YES loader:^int32_t(std::vector<transcriber_option_t> &options) {
    NSArray *modelData = config[@"modelData"];
    if (![modelData isKindOfClass:NSArray.class] || modelData.count != 3) {
      ThrowNSError(@"Moonshine modelData must contain exactly 3 binary parts");
    }
    auto encoderData = ByteVectorFromArray(modelData[0]);
    auto decoderData = ByteVectorFromArray(modelData[1]);
    auto tokenizerData = ByteVectorFromArray(modelData[2]);
    int32_t modelArch = [self resolveModelArch:config];
    return moonshine_load_transcriber_from_memory(
        encoderData.data(),
        encoderData.size(),
        decoderData.data(),
        decoderData.size(),
        tokenizerData.data(),
        tokenizerData.size(),
        static_cast<uint32_t>(modelArch),
        options.empty() ? nullptr : options.data(),
        static_cast<uint64_t>(options.size()),
        MOONSHINE_HEADER_VERSION);
  }];
}

RCT_EXPORT_METHOD(processUtterance:(NSString *)intentRecognizerId
                  utterance:(NSString *)utterance
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    if (utterance.length == 0) {
      ThrowNSError(@"Moonshine utterance is required");
    }
    int32_t handle = [self parseIntentRecognizerId:intentRecognizerId];
    ClearIntentMatch(handle);
    int32_t resultCode = moonshine_process_utterance(handle, utterance.UTF8String);
    if (resultCode < 0) {
      ThrowNSError([NSString stringWithFormat:@"Failed to process Moonshine utterance: %@", StringFromCString(moonshine_error_to_string(resultCode))], resultCode);
    }

    NSMutableDictionary *result = [self successMap];
    result[@"matched"] = @(resultCode > 0);
    if (resultCode > 0) {
      auto match = TakeIntentMatch(handle);
      if (match.has_value()) {
        result[@"match"] = @{
          @"triggerPhrase": [NSString stringWithUTF8String:match->triggerPhrase.c_str()],
          @"utterance": [NSString stringWithUTF8String:match->utterance.c_str()],
          @"similarity": @(match->similarity),
        };
      }
    }
    resolve(result);
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

RCT_EXPORT_METHOD(registerIntent:(NSString *)intentRecognizerId
                  triggerPhrase:(NSString *)triggerPhrase
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    if (triggerPhrase.length == 0) {
      ThrowNSError(@"Moonshine intent triggerPhrase is required");
    }
    int32_t handle = [self parseIntentRecognizerId:intentRecognizerId];
    ThrowIfMoonshineError(
        moonshine_register_intent(
            handle,
            triggerPhrase.UTF8String,
            MoonshineIntentCallback,
            reinterpret_cast<void *>(static_cast<intptr_t>(handle))),
        @"register intent");
    resolve([self successMap]);
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

RCT_EXPORT_METHOD(release:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  if (self.defaultTranscriberId != nil) {
    [self releaseTranscriberInternal:self.defaultTranscriberId];
  }
  resolve(@{@"released": @YES});
}

RCT_EXPORT_METHOD(releaseIntentRecognizer:(NSString *)intentRecognizerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    int32_t handle = [self parseIntentRecognizerId:intentRecognizerId];
    moonshine_free_intent_recognizer(handle);
    ClearIntentMatch(handle);
    [self.intentRecognizerHandles removeObjectForKey:intentRecognizerId];
    resolve([self successMap]);
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

RCT_EXPORT_METHOD(releaseTranscriber:(NSString *)transcriberId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    BOOL released = [self releaseTranscriberInternal:transcriberId];
    resolve(@{@"released": @(released)});
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

RCT_EXPORT_METHOD(removeStream:(NSString *)streamId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    MoonshineParsedStreamId *parsedStreamId = [self parseStreamId:streamId];
    [self removeStreamForTranscriber:parsedStreamId.transcriberId
                            streamId:streamId
                            resolver:resolve
                            rejecter:reject];
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

RCT_EXPORT_METHOD(removeStreamForTranscriber:(NSString *)transcriberId
                  streamId:(NSString *)streamId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withTranscriber:transcriberId rejecter:reject block:^(NSString *resolvedId, MoonshineTranscriberState *state) {
    int32_t streamHandle = [self parseStreamHandleForTranscriber:resolvedId streamId:streamId];
    if (streamHandle == state.defaultStreamHandle) {
      ThrowNSError(@"Moonshine default stream cannot be removed");
    }
    ThrowIfMoonshineError(moonshine_free_stream(state.handle, streamHandle), @"remove stream");
    [state.activeStreamHandles removeObject:@(streamHandle)];
    [state.streamStates removeObjectForKey:@(streamHandle)];
    resolve([self successMap]);
  }];
}

RCT_EXPORT_METHOD(setIntentThreshold:(NSString *)intentRecognizerId
                  threshold:(nonnull NSNumber *)threshold
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    int32_t handle = [self parseIntentRecognizerId:intentRecognizerId];
    ThrowIfMoonshineError(
        moonshine_set_intent_threshold(handle, threshold.floatValue),
        @"set intent threshold");
    resolve([self successMap]);
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

RCT_EXPORT_METHOD(start:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withDefaultTranscriberRejecter:reject block:^(NSString *transcriberId, MoonshineTranscriberState *state) {
    ThrowIfMoonshineError(moonshine_start_stream(state.handle, state.defaultStreamHandle), @"start stream");
    resolve([self successMap]);
  }];
}

RCT_EXPORT_METHOD(startStream:(NSString *)streamId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    MoonshineParsedStreamId *parsedStreamId = [self parseStreamId:streamId];
    [self startStreamForTranscriber:parsedStreamId.transcriberId
                           streamId:streamId
                           resolver:resolve
                           rejecter:reject];
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

RCT_EXPORT_METHOD(startStreamForTranscriber:(NSString *)transcriberId
                  streamId:(NSString *)streamId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withTranscriber:transcriberId rejecter:reject block:^(NSString *resolvedId, MoonshineTranscriberState *state) {
    int32_t streamHandle = [self parseStreamHandleForTranscriber:resolvedId streamId:streamId];
    ThrowIfMoonshineError(moonshine_start_stream(state.handle, streamHandle), @"start stream");
    resolve([self successMap]);
  }];
}

RCT_EXPORT_METHOD(startTranscriber:(NSString *)transcriberId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withTranscriber:transcriberId rejecter:reject block:^(NSString *resolvedId, MoonshineTranscriberState *state) {
    ThrowIfMoonshineError(moonshine_start_stream(state.handle, state.defaultStreamHandle), @"start stream");
    resolve([self successMap]);
  }];
}

RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withDefaultTranscriberRejecter:reject block:^(NSString *transcriberId, MoonshineTranscriberState *state) {
    [self stopAndFlushStreamForTranscriber:transcriberId state:state streamHandle:state.defaultStreamHandle];
    resolve([self successMap]);
  }];
}

RCT_EXPORT_METHOD(stopStream:(NSString *)streamId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    MoonshineParsedStreamId *parsedStreamId = [self parseStreamId:streamId];
    [self stopStreamForTranscriber:parsedStreamId.transcriberId
                          streamId:streamId
                          resolver:resolve
                          rejecter:reject];
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

RCT_EXPORT_METHOD(stopStreamForTranscriber:(NSString *)transcriberId
                  streamId:(NSString *)streamId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withTranscriber:transcriberId rejecter:reject block:^(NSString *resolvedId, MoonshineTranscriberState *state) {
    int32_t streamHandle = [self parseStreamHandleForTranscriber:resolvedId streamId:streamId];
    [self stopAndFlushStreamForTranscriber:resolvedId state:state streamHandle:streamHandle];
    resolve([self successMap]);
  }];
}

RCT_EXPORT_METHOD(stopTranscriber:(NSString *)transcriberId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withTranscriber:transcriberId rejecter:reject block:^(NSString *resolvedId, MoonshineTranscriberState *state) {
    [self stopAndFlushStreamForTranscriber:resolvedId state:state streamHandle:state.defaultStreamHandle];
    resolve([self successMap]);
  }];
}

RCT_EXPORT_METHOD(transcribeFromSamples:(nonnull NSNumber *)sampleRate
                  samples:(NSArray *)samples
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withDefaultTranscriberRejecter:reject block:^(NSString *transcriberId, MoonshineTranscriberState *state) {
    [self transcribeFromSamplesInternalForTranscriber:transcriberId
                                                state:state
                                           sampleRate:sampleRate.intValue
                                              samples:samples
                                              options:options
                                             resolver:resolve
                                             rejecter:reject];
  }];
}

RCT_EXPORT_METHOD(transcribeFromSamplesForTranscriber:(NSString *)transcriberId
                  sampleRate:(nonnull NSNumber *)sampleRate
                  samples:(NSArray *)samples
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withTranscriber:transcriberId rejecter:reject block:^(NSString *resolvedId, MoonshineTranscriberState *state) {
    [self transcribeFromSamplesInternalForTranscriber:resolvedId
                                                state:state
                                           sampleRate:sampleRate.intValue
                                              samples:samples
                                              options:options
                                             resolver:resolve
                                             rejecter:reject];
  }];
}

RCT_EXPORT_METHOD(transcribeWithoutStreaming:(nonnull NSNumber *)sampleRate
                  samples:(NSArray *)samples
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withDefaultTranscriberRejecter:reject block:^(NSString *transcriberId, MoonshineTranscriberState *state) {
    [self transcribeWithoutStreamingInternalForTranscriber:transcriberId
                                                     state:state
                                                sampleRate:sampleRate.intValue
                                                   samples:samples
                                                   options:options
                                                  resolver:resolve
                                                  rejecter:reject];
  }];
}

RCT_EXPORT_METHOD(transcribeWithoutStreamingForTranscriber:(NSString *)transcriberId
                  sampleRate:(nonnull NSNumber *)sampleRate
                  samples:(NSArray *)samples
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  [self withTranscriber:transcriberId rejecter:reject block:^(NSString *resolvedId, MoonshineTranscriberState *state) {
    [self transcribeWithoutStreamingInternalForTranscriber:resolvedId
                                                     state:state
                                                sampleRate:sampleRate.intValue
                                                   samples:samples
                                                   options:options
                                                  resolver:resolve
                                                  rejecter:reject];
  }];
}

RCT_EXPORT_METHOD(unregisterIntent:(NSString *)intentRecognizerId
                  triggerPhrase:(NSString *)triggerPhrase
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  @try {
    int32_t handle = [self parseIntentRecognizerId:intentRecognizerId];
    ThrowIfMoonshineError(
        moonshine_unregister_intent(handle, triggerPhrase.UTF8String),
        @"unregister intent");
    resolve([self successMap]);
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

- (void)addAudioToTrackedStreamForTranscriber:(NSString *)transcriberId
                                        state:(MoonshineTranscriberState *)state
                                   streamHandle:(int32_t)streamHandle
                                    sampleRate:(int32_t)sampleRate
                                        samples:(NSArray *)samples {
  auto audio = FloatVectorFromArray(samples);
  ThrowIfMoonshineError(
      moonshine_transcribe_add_audio_to_stream(
          state.handle,
          streamHandle,
          audio.data(),
          audio.size(),
          sampleRate,
          0),
      @"add audio to stream");

  transcript_t *transcript = nullptr;
  ThrowIfMoonshineError(
      moonshine_transcribe_stream(state.handle, streamHandle, 0, &transcript),
      @"transcribe stream");
  if (transcript == nullptr) {
    ThrowNSError(@"Moonshine stream transcription returned no transcript");
  }
  [self notifyFromTranscript:transcript
               transcriberId:transcriberId
                       state:state
                  streamHandle:streamHandle];
}

- (void)createTranscriber:(NSDictionary *)config
                 resolver:(RCTPromiseResolveBlock)resolve
          assignAsDefault:(BOOL)assignAsDefault
                   loader:(int32_t (^)(std::vector<transcriber_option_t> &options))loader {
  @try {
    if (assignAsDefault && self.defaultTranscriberId != nil) {
      [self releaseTranscriberInternal:self.defaultTranscriberId];
    }

    BOOL includeAudioData = BoolFromValue(config[@"includeAudioData"]);
    auto optionBuffer = [self buildTranscriberOptions:config];
    int32_t handle = loader(optionBuffer.options);
    ThrowIfNegativeHandle(handle, @"load transcriber");

    int32_t defaultStreamHandle = moonshine_create_stream(handle, 0);
    ThrowIfNegativeHandle(defaultStreamHandle, @"create default stream");

    NSString *transcriberId = [self nextTranscriberId];
    MoonshineTranscriberState *state = [[MoonshineTranscriberState alloc] init];
    state.handle = handle;
    state.defaultStreamHandle = defaultStreamHandle;
    state.includeAudioDataInLines = includeAudioData;
    [self registerStreamStateForTranscriberState:state streamHandle:defaultStreamHandle];
    self.transcriberStates[transcriberId] = state;
    if (assignAsDefault) {
      self.defaultTranscriberId = transcriberId;
    }

    NSMutableDictionary *result = [self successMap];
    result[@"transcriberId"] = transcriberId;
    resolve(result);
  } @catch (id exception) {
    NSError *error = MoonshineNSErrorFromException(exception);
    resolve([self errorResult:error.localizedDescription ?: @"Moonshine load failed"]);
  }
}

- (NSDictionary *)buildLineMapFromTranscriptLine:(const transcript_line_t &)line
                                       includeAudioData:(BOOL)includeAudioData {
  return LineDictionaryFromTranscriptLine(line, includeAudioData);
}

- (NSDictionary *)buildTranscriptionResultForState:(MoonshineTranscriberState *)state
                                       streamHandle:(int32_t)streamHandle {
  MoonshineStreamState *streamState = state.streamStates[@(streamHandle)];
  NSMutableArray<NSDictionary *> *lineMaps = [NSMutableArray array];
  for (NSString *lineId in streamState.orderedLineIds) {
    NSDictionary *line = streamState.linesById[lineId];
    if (line != nil) {
      [lineMaps addObject:line];
    }
  }
  return @{
    @"text": TranscriptTextFromLineMaps(lineMaps),
    @"lines": lineMaps,
  };
}

- (void)emitEventWithType:(NSString *)type
             transcriberId:(NSString *)transcriberId
                streamHandle:(int32_t)streamHandle
                       state:(MoonshineTranscriberState *)state
                        line:(NSDictionary *)line
                       error:(NSString *)error {
  if (!self.hasListeners) {
    return;
  }
  NSMutableDictionary *params = [@{
    @"type": type,
    @"transcriberId": transcriberId,
    @"streamId": [self streamIdForHandle:streamHandle transcriberId:transcriberId],
  } mutableCopy];
  if (line != nil) {
    params[@"line"] = line;
  }
  if (error.length > 0) {
    params[@"error"] = error;
  }
  [self sendEventWithName:MoonshineEventName body:params];
}

- (NSString *)nextTranscriberId {
  NSString *result = [NSString stringWithFormat:@"transcriber-%ld", (long)self.transcriberCounter];
  self.transcriberCounter += 1;
  return result;
}

- (void)notifyFromTranscript:(transcript_t *)transcript
                transcriberId:(NSString *)transcriberId
                        state:(MoonshineTranscriberState *)state
                   streamHandle:(int32_t)streamHandle {
  MoonshineStreamState *streamState = [self streamStateForTranscriberState:state streamHandle:streamHandle];
  for (uint64_t index = 0; index < transcript->line_count; index += 1) {
    const transcript_line_t &line = transcript->lines[index];
    NSDictionary *lineMap = [self buildLineMapFromTranscriptLine:line includeAudioData:state.includeAudioDataInLines];
    NSString *lineId = StringFromValue(lineMap[@"lineId"]);
    if (lineId.length == 0) {
      continue;
    }

    if (streamState.linesById[lineId] == nil) {
      [streamState.orderedLineIds addObject:lineId];
    }
    streamState.linesById[lineId] = lineMap;

    if (line.is_new != 0) {
      [self emitEventWithType:@"lineStarted"
                 transcriberId:transcriberId
                    streamHandle:streamHandle
                           state:state
                            line:lineMap
                           error:nil];
    }
    if (line.is_updated != 0 && line.is_new == 0 && line.is_complete == 0) {
      [self emitEventWithType:@"lineUpdated"
                 transcriberId:transcriberId
                    streamHandle:streamHandle
                           state:state
                            line:lineMap
                           error:nil];
    }
    if (line.has_text_changed != 0) {
      [self emitEventWithType:@"lineTextChanged"
                 transcriberId:transcriberId
                    streamHandle:streamHandle
                           state:state
                            line:lineMap
                           error:nil];
    }
    if (line.is_complete != 0 && line.is_updated != 0 &&
        ![streamState.completedLineIds containsObject:lineId]) {
      [streamState.completedLineIds addObject:lineId];
      [self emitEventWithType:@"lineCompleted"
                 transcriberId:transcriberId
                    streamHandle:streamHandle
                           state:state
                            line:lineMap
                           error:nil];
    }
  }
}

- (int32_t)parseIntentRecognizerId:(NSString *)intentRecognizerId {
  NSNumber *handle = self.intentRecognizerHandles[intentRecognizerId];
  if (handle == nil) {
    ThrowNSError([NSString stringWithFormat:@"Moonshine intent recognizer is not active: %@", intentRecognizerId]);
  }
  return handle.intValue;
}

- (int32_t)parseStreamHandleForTranscriber:(NSString *)transcriberId
                                   streamId:(NSString *)streamId {
  MoonshineParsedStreamId *parsedStreamId = [self parseStreamId:streamId];
  if (![parsedStreamId.transcriberId isEqualToString:transcriberId]) {
    ThrowNSError([NSString stringWithFormat:@"Moonshine stream %@ does not belong to transcriber %@", streamId, transcriberId]);
  }
  MoonshineTranscriberState *state = self.transcriberStates[transcriberId];
  if (state == nil) {
    ThrowNSError([NSString stringWithFormat:@"Moonshine transcriber is not initialized: %@", transcriberId]);
  }
  BOOL isKnownStream =
      parsedStreamId.handle == state.defaultStreamHandle ||
      [state.activeStreamHandles containsObject:@(parsedStreamId.handle)];
  if (!isKnownStream) {
    ThrowNSError([NSString stringWithFormat:@"Moonshine stream is not active: %@", streamId]);
  }
  return parsedStreamId.handle;
}

- (MoonshineParsedStreamId *)parseStreamId:(NSString *)streamId {
  NSRange range = [streamId rangeOfString:@":stream-"];
  MoonshineParsedStreamId *parsedStreamId = [[MoonshineParsedStreamId alloc] init];
  if (range.location != NSNotFound) {
    NSString *transcriberId = [streamId substringToIndex:range.location];
    NSString *handleString = [streamId substringFromIndex:range.location + range.length];
    if (transcriberId.length == 0 || !IsStrictIntegerString(handleString)) {
      ThrowNSError([NSString stringWithFormat:@"Invalid Moonshine stream id: %@", streamId]);
    }
    parsedStreamId.transcriberId = transcriberId;
    parsedStreamId.handle = (int32_t)handleString.intValue;
    return parsedStreamId;
  }

  if (self.defaultTranscriberId.length == 0) {
    ThrowNSError(@"Moonshine default transcriber is not initialized");
  }
  NSString *handleString = [streamId hasPrefix:@"stream-"] ? [streamId substringFromIndex:@"stream-".length] : nil;
  if (!IsStrictIntegerString(handleString)) {
    ThrowNSError([NSString stringWithFormat:@"Invalid Moonshine stream id: %@", streamId]);
  }
  parsedStreamId.transcriberId = self.defaultTranscriberId;
  parsedStreamId.handle = (int32_t)handleString.integerValue;
  return parsedStreamId;
}

- (NSString *)resolveAssetModelPath:(NSString *)assetPath {
  NSString *trimmedAssetPath = TrimmedPathString(assetPath);
  if (trimmedAssetPath.length == 0) {
    ThrowNSError(@"Moonshine assetPath is required");
  }
  NSFileManager *fileManager = [NSFileManager defaultManager];
  if ([fileManager fileExistsAtPath:trimmedAssetPath]) {
    return trimmedAssetPath;
  }

  NSArray<NSBundle *> *bundles = @[
    NSBundle.mainBundle,
    [NSBundle bundleForClass:Moonshine.class],
  ];
  NSString *directory = [trimmedAssetPath stringByDeletingLastPathComponent];
  NSString *resourceName = [trimmedAssetPath lastPathComponent];
  for (NSBundle *bundle in bundles) {
    NSString *resourceRoot = bundle.resourcePath;
    if (resourceRoot.length > 0) {
      NSString *candidate = [resourceRoot stringByAppendingPathComponent:trimmedAssetPath];
      if ([fileManager fileExistsAtPath:candidate]) {
        return candidate;
      }
    }
    NSString *resourceCandidate = [bundle pathForResource:resourceName
                                                   ofType:nil
                                              inDirectory:directory.length > 0 ? directory : nil];
    if (resourceCandidate.length > 0 && [fileManager fileExistsAtPath:resourceCandidate]) {
      return resourceCandidate;
    }
  }
  ThrowNSError([NSString stringWithFormat:@"Moonshine asset path does not exist: %@", assetPath]);
  return nil;
}

- (TranscriberOptionBuffer)buildTranscriberOptions:(NSDictionary *)config {
  TranscriberOptionBuffer buffer;
  auto addOption = [&](NSString *name, NSString *value) {
    if (name.length == 0 || value == nil) {
      return;
    }
    buffer.names.emplace_back(name.UTF8String);
    buffer.values.emplace_back(value.UTF8String);
    buffer.options.push_back(transcriber_option_t{
      buffer.names.back().c_str(),
      buffer.values.back().c_str(),
    });
  };

  NSDictionary *nativeOptions = [config[@"options"] isKindOfClass:NSDictionary.class] ? config[@"options"] : nil;
  if (nativeOptions != nil) {
    if (nativeOptions[@"identifySpeakers"] != nil && nativeOptions[@"identifySpeakers"] != (id)kCFNull) {
      addOption(@"identify_speakers", BoolFromValue(nativeOptions[@"identifySpeakers"]) ? @"true" : @"false");
    }
    if (nativeOptions[@"logApiCalls"] != nil && nativeOptions[@"logApiCalls"] != (id)kCFNull) {
      addOption(@"log_api_calls", BoolFromValue(nativeOptions[@"logApiCalls"]) ? @"true" : @"false");
    }
    if (nativeOptions[@"logOrtRuns"] != nil && nativeOptions[@"logOrtRuns"] != (id)kCFNull) {
      addOption(@"log_ort_run", BoolFromValue(nativeOptions[@"logOrtRuns"]) ? @"true" : @"false");
    }
    if (nativeOptions[@"logOutputText"] != nil && nativeOptions[@"logOutputText"] != (id)kCFNull) {
      addOption(@"log_output_text", BoolFromValue(nativeOptions[@"logOutputText"]) ? @"true" : @"false");
    }
    if (NumberFromValue(nativeOptions[@"maxTokensPerSecond"]) != nil) {
      addOption(@"max_tokens_per_second", [NumberFromValue(nativeOptions[@"maxTokensPerSecond"]) stringValue]);
    }
    if (StringFromValue(nativeOptions[@"saveInputWavPath"]).length > 0) {
      addOption(@"save_input_wav_path", StringFromValue(nativeOptions[@"saveInputWavPath"]));
    }
    if (NumberFromValue(nativeOptions[@"speakerIdClusterThreshold"]) != nil) {
      addOption(@"speaker_id_cluster_threshold", [NumberFromValue(nativeOptions[@"speakerIdClusterThreshold"]) stringValue]);
    }
    if (NumberFromValue(nativeOptions[@"vadThreshold"]) != nil) {
      addOption(@"vad_threshold", [NumberFromValue(nativeOptions[@"vadThreshold"]) stringValue]);
    }
    if (NumberFromValue(nativeOptions[@"vadHopSize"]) != nil) {
      addOption(@"vad_hop_size", [NSString stringWithFormat:@"%d", NumberFromValue(nativeOptions[@"vadHopSize"]).intValue]);
    }
    if (NumberFromValue(nativeOptions[@"vadMaxSegmentDurationMs"]) != nil) {
      addOption(@"vad_max_segment_duration", [NSString stringWithFormat:@"%g", NumberFromValue(nativeOptions[@"vadMaxSegmentDurationMs"]).doubleValue / 1000.0]);
    }
    if (NumberFromValue(nativeOptions[@"vadLookBehindSampleCount"]) != nil) {
      addOption(@"vad_look_behind_sample_count", [NSString stringWithFormat:@"%d", NumberFromValue(nativeOptions[@"vadLookBehindSampleCount"]).intValue]);
    }
    if (NumberFromValue(nativeOptions[@"vadWindowDurationMs"]) != nil) {
      addOption(@"vad_window_duration", [NSString stringWithFormat:@"%g", NumberFromValue(nativeOptions[@"vadWindowDurationMs"]).doubleValue / 1000.0]);
    }
    if (nativeOptions[@"wordTimestamps"] != nil && nativeOptions[@"wordTimestamps"] != (id)kCFNull) {
      addOption(@"word_timestamps", BoolFromValue(nativeOptions[@"wordTimestamps"]) ? @"true" : @"false");
    }
  }

  if (NumberFromValue(config[@"updateIntervalMs"]) != nil) {
    addOption(@"transcription_interval", [NSString stringWithFormat:@"%g", NumberFromValue(config[@"updateIntervalMs"]).doubleValue / 1000.0]);
  }

  NSArray *extraOptions = [config[@"transcriberOptions"] isKindOfClass:NSArray.class] ? config[@"transcriberOptions"] : nil;
  for (NSDictionary *option in extraOptions) {
    if (![option isKindOfClass:NSDictionary.class]) {
      continue;
    }
    NSString *name = StringFromValue(option[@"name"]);
    if (name.length == 0) {
      continue;
    }
    id value = option[@"value"];
    NSString *valueString = value == nil || value == (id)kCFNull ? @"" : StringFromValue(value);
    if (valueString == nil && [value isKindOfClass:NSNumber.class]) {
      valueString = [(NSNumber *)value stringValue];
    }
    addOption(name, valueString ?: @"");
  }

  return buffer;
}

- (NSString *)createStreamForTranscriberState:(NSString *)transcriberId
                                        state:(MoonshineTranscriberState *)state {
  int32_t streamHandle = moonshine_create_stream(state.handle, 0);
  ThrowIfNegativeHandle(streamHandle, @"create stream");
  [state.activeStreamHandles addObject:@(streamHandle)];
  [self registerStreamStateForTranscriberState:state streamHandle:streamHandle];
  return [self streamIdForHandle:streamHandle transcriberId:transcriberId];
}

- (void)registerStreamStateForTranscriberState:(MoonshineTranscriberState *)state
                                   streamHandle:(int32_t)streamHandle {
  state.streamStates[@(streamHandle)] = [[MoonshineStreamState alloc] init];
}

- (MoonshineStreamState *)streamStateForTranscriberState:(MoonshineTranscriberState *)state
                                             streamHandle:(int32_t)streamHandle {
  MoonshineStreamState *streamState = state.streamStates[@(streamHandle)];
  if (streamState == nil) {
    streamState = [[MoonshineStreamState alloc] init];
    state.streamStates[@(streamHandle)] = streamState;
  }
  return streamState;
}

- (void)releaseAllInternal {
  NSArray<NSString *> *transcriberIds = self.transcriberStates.allKeys.copy;
  for (NSString *transcriberId in transcriberIds) {
    [self releaseTranscriberInternal:transcriberId];
  }

  NSArray<NSNumber *> *intentHandles = self.intentRecognizerHandles.allValues.copy;
  for (NSNumber *handle in intentHandles) {
    @try {
      moonshine_free_intent_recognizer(handle.intValue);
      ClearIntentMatch(handle.intValue);
    } @catch (...) {
    }
  }
  [self.intentRecognizerHandles removeAllObjects];
}

- (BOOL)releaseTranscriberInternal:(NSString *)transcriberId {
  MoonshineTranscriberState *state = self.transcriberStates[transcriberId];
  if (state == nil) {
    return NO;
  }
  [self.transcriberStates removeObjectForKey:transcriberId];

  for (NSNumber *streamHandle in state.activeStreamHandles.allObjects) {
    @try {
      moonshine_free_stream(state.handle, streamHandle.intValue);
    } @catch (...) {
    }
  }
  [state.activeStreamHandles removeAllObjects];

  @try {
    moonshine_free_stream(state.handle, state.defaultStreamHandle);
  } @catch (...) {
  }

  @try {
    moonshine_free_transcriber(state.handle);
  } @catch (...) {
  }

  [state.streamStates removeAllObjects];
  if ([self.defaultTranscriberId isEqualToString:transcriberId]) {
    self.defaultTranscriberId = nil;
  }
  return YES;
}

- (int32_t)resolveIntentModelArch:(NSDictionary *)config {
  id rawValue = config[@"modelArch"];
  if (rawValue == nil || rawValue == (id)kCFNull) {
    return MOONSHINE_EMBEDDING_MODEL_ARCH_GEMMA_300M;
  }
  if ([rawValue isKindOfClass:NSNumber.class]) {
    return [(NSNumber *)rawValue intValue];
  }
  NSString *stringValue = StringFromValue(rawValue);
  if ([stringValue isEqualToString:@"gemma-300m"]) {
    return MOONSHINE_EMBEDDING_MODEL_ARCH_GEMMA_300M;
  }
  ThrowNSError([NSString stringWithFormat:@"Unsupported Moonshine intent modelArch: %@", stringValue ?: @"<null>"]);
  return MOONSHINE_EMBEDDING_MODEL_ARCH_GEMMA_300M;
}

- (int32_t)resolveModelArch:(NSDictionary *)config {
  id rawValue = config[@"modelArch"];
  if (rawValue == nil || rawValue == (id)kCFNull) {
    ThrowNSError(@"Moonshine modelArch is required");
  }
  if ([rawValue isKindOfClass:NSNumber.class]) {
    return [(NSNumber *)rawValue intValue];
  }
  NSString *stringValue = StringFromValue(rawValue);
  if ([stringValue isEqualToString:@"tiny"]) return MOONSHINE_MODEL_ARCH_TINY;
  if ([stringValue isEqualToString:@"base"]) return MOONSHINE_MODEL_ARCH_BASE;
  if ([stringValue isEqualToString:@"tiny-streaming"]) return MOONSHINE_MODEL_ARCH_TINY_STREAMING;
  if ([stringValue isEqualToString:@"base-streaming"]) return MOONSHINE_MODEL_ARCH_BASE_STREAMING;
  if ([stringValue isEqualToString:@"small-streaming"]) return MOONSHINE_MODEL_ARCH_SMALL_STREAMING;
  if ([stringValue isEqualToString:@"medium-streaming"]) return MOONSHINE_MODEL_ARCH_MEDIUM_STREAMING;
  ThrowNSError([NSString stringWithFormat:@"Unsupported Moonshine modelArch: %@", stringValue ?: @"<null>"]);
  return MOONSHINE_MODEL_ARCH_BASE;
}

- (void)stopAndFlushStreamForTranscriber:(NSString *)transcriberId
                                   state:(MoonshineTranscriberState *)state
                              streamHandle:(int32_t)streamHandle {
  ThrowIfMoonshineError(moonshine_stop_stream(state.handle, streamHandle), @"stop stream");
  transcript_t *transcript = nullptr;
  ThrowIfMoonshineError(
      moonshine_transcribe_stream(state.handle, streamHandle, MOONSHINE_FLAG_FORCE_UPDATE, &transcript),
      @"flush stream");
  if (transcript == nullptr) {
    ThrowNSError(@"Moonshine stream flush returned no transcript");
  }
  [self notifyFromTranscript:transcript
               transcriberId:transcriberId
                       state:state
                  streamHandle:streamHandle];
}

- (NSString *)streamIdForHandle:(int32_t)handle transcriberId:(NSString *)transcriberId {
  return [NSString stringWithFormat:@"%@:stream-%d", transcriberId, handle];
}

- (NSString *)intentRecognizerIdForHandle:(int32_t)handle {
  return [NSString stringWithFormat:@"intent-%d", handle];
}

- (NSMutableDictionary *)successMap {
  return [@{@"success": @YES} mutableCopy];
}

- (NSDictionary *)errorResult:(NSString *)message {
  return @{
    @"success": @NO,
    @"error": message ?: @"Moonshine load failed",
  };
}

- (void)transcribeFromSamplesInternalForTranscriber:(NSString *)transcriberId
                                              state:(MoonshineTranscriberState *)state
                                         sampleRate:(int32_t)sampleRate
                                            samples:(NSArray *)samples
                                            options:(NSDictionary *)options
                                           resolver:(RCTPromiseResolveBlock)resolve
                                           rejecter:(RCTPromiseRejectBlock)reject {
  NSNumber *chunkDurationValue = NumberFromValue(options[@"chunkDurationMs"]);
  int32_t temporaryStreamHandle = -1;
  @try {
    auto audio = FloatVectorFromArray(samples);
    int chunkDurationMs = chunkDurationValue != nil ? MAX(chunkDurationValue.intValue, 1) : 200;
    temporaryStreamHandle = moonshine_create_stream(state.handle, 0);
    ThrowIfNegativeHandle(temporaryStreamHandle, @"create stream");
    [state.activeStreamHandles addObject:@(temporaryStreamHandle)];
    [self registerStreamStateForTranscriberState:state streamHandle:temporaryStreamHandle];
    ThrowIfMoonshineError(moonshine_start_stream(state.handle, temporaryStreamHandle), @"start stream");

    int samplesPerChunk = MAX((int)((sampleRate * chunkDurationMs) / 1000.0), 1);
    for (size_t startIndex = 0; startIndex < audio.size(); startIndex += samplesPerChunk) {
      size_t endIndex = MIN(startIndex + (size_t)samplesPerChunk, audio.size());
      NSMutableArray<NSNumber *> *chunkArray = [NSMutableArray arrayWithCapacity:endIndex - startIndex];
      for (size_t index = startIndex; index < endIndex; index += 1) {
        [chunkArray addObject:@(audio[index])];
      }
      [self addAudioToTrackedStreamForTranscriber:transcriberId
                                            state:state
                                       streamHandle:temporaryStreamHandle
                                        sampleRate:sampleRate
                                            samples:chunkArray];
    }
    [self stopAndFlushStreamForTranscriber:transcriberId state:state streamHandle:temporaryStreamHandle];
    resolve([self buildTranscriptionResultForState:state streamHandle:temporaryStreamHandle]);
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception), @"MOONSHINE_TRANSCRIBE_ERROR");
  } @finally {
    if (temporaryStreamHandle >= 0) {
      @try {
        moonshine_free_stream(state.handle, temporaryStreamHandle);
      } @catch (...) {
      }
      [state.activeStreamHandles removeObject:@(temporaryStreamHandle)];
      [state.streamStates removeObjectForKey:@(temporaryStreamHandle)];
    }
  }
}

- (void)transcribeWithoutStreamingInternalForTranscriber:(NSString *)transcriberId
                                                     state:(MoonshineTranscriberState *)state
                                                sampleRate:(int32_t)sampleRate
                                                   samples:(NSArray *)samples
                                                   options:(NSDictionary *)options
                                                  resolver:(RCTPromiseResolveBlock)resolve
                                                  rejecter:(RCTPromiseRejectBlock)reject {
  [self transcribeFromSamplesInternalForTranscriber:transcriberId
                                              state:state
                                         sampleRate:sampleRate
                                            samples:samples
                                            options:options
                                           resolver:resolve
                                           rejecter:reject];
}

- (void)withDefaultTranscriberRejecter:(RCTPromiseRejectBlock)reject
                                 block:(void (^)(NSString *transcriberId, MoonshineTranscriberState *state))block {
  if (self.defaultTranscriberId.length == 0) {
    reject(@"MOONSHINE_NOT_INITIALIZED", @"Moonshine is not initialized", nil);
    return;
  }
  [self withTranscriber:self.defaultTranscriberId rejecter:reject block:block];
}

- (void)withTranscriber:(NSString *)transcriberId
               rejecter:(RCTPromiseRejectBlock)reject
                  block:(void (^)(NSString *transcriberId, MoonshineTranscriberState *state))block {
  MoonshineTranscriberState *state = self.transcriberStates[transcriberId];
  if (state == nil) {
    reject(@"MOONSHINE_NOT_INITIALIZED",
           [NSString stringWithFormat:@"Moonshine transcriber is not initialized: %@", transcriberId],
           nil);
    return;
  }

  @try {
    block(transcriberId, state);
  } @catch (id exception) {
    RejectPromiseWithError(reject, MoonshineNSErrorFromException(exception));
  }
}

@end
