//
//  DecodingConfig.swift
//  Pods
//
//  Created by Arthur Breton on 24/2/2025.
//

import AVFoundation

public struct DecodingConfig {
    public let targetSampleRate: Double?
    public let targetChannels: Int?
    public let targetBitDepth: Int?
    public let normalizeAudio: Bool
    
    public init(
        targetSampleRate: Double?,
        targetChannels: Int?,
        targetBitDepth: Int?,
        normalizeAudio: Bool = false
    ) {
        self.targetSampleRate = targetSampleRate
        self.targetChannels = targetChannels
        self.targetBitDepth = targetBitDepth
        self.normalizeAudio = normalizeAudio
    }
    
    public static func fromDictionary(_ dict: [String: Any]?) -> DecodingConfig {
        guard let dict = dict else {
            return DecodingConfig.default
        }
        
        return DecodingConfig(
            targetSampleRate: bridgedDouble(dict, "targetSampleRate"),
            targetChannels: bridgedInt(dict, "targetChannels"),
            targetBitDepth: bridgedInt(dict, "targetBitDepth"),
            normalizeAudio: dict["normalizeAudio"] as? Bool ?? false
        )
    }
    
    public static var `default`: DecodingConfig {
        return DecodingConfig(
            targetSampleRate: nil,
            targetChannels: nil,
            targetBitDepth: nil,
            normalizeAudio: false
        )
    }
    
    public func toAudioFormat(baseFormat: AVAudioFormat) -> AVAudioFormat {
        let sampleRate = targetSampleRate ?? baseFormat.sampleRate
        let channels = targetChannels ?? Int(baseFormat.channelCount)
        
        return AVAudioFormat(
            standardFormatWithSampleRate: sampleRate,
            channels: AVAudioChannelCount(channels)
        )!
    }
}
