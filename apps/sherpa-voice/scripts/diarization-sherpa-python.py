#!/usr/bin/env python3
"""Run Python sherpa-onnx offline speaker diarization on local WAV/models."""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

import numpy as np
import sherpa_onnx
import soundfile as sf

try:
    import librosa
except Exception:  # pragma: no cover - only needed when input is not 16 kHz
    librosa = None


EMBEDDING_FILES = {
    "speaker-id-en-voxceleb": "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx",
    "speaker-id-zh-en-advanced": "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
    "speaker-id-nemo-titanet-small": "nemo_en_titanet_small.onnx",
    "speaker-id-3dspeaker-eres2net-en": "3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx",
    "speaker-id-wespeaker-resnet34-lm-en": "wespeaker_en_voxceleb_resnet34_LM.onnx",
    "speaker-id-wespeaker-campp-en": "wespeaker_en_voxceleb_CAM++.onnx",
    "speaker-id-wespeaker-campp-lm-en": "wespeaker_en_voxceleb_CAM++_LM.onnx",
    "speaker-id-nemo-speakernet-en": "nemo_en_speakerverification_speakernet.onnx",
    "speaker-id-nemo-titanet-large": "nemo_en_titanet_large.onnx",
    "speaker-id-3dspeaker-eres2net-base-zh": "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
}

SEGMENTATION_DIRS = {
    "pyannote-segmentation-3-0": "sherpa-onnx-pyannote-segmentation-3-0",
    "reverb-diarization-v1": "sherpa-onnx-reverb-diarization-v1",
}

DEFAULT_CASES = [
    {"label": "python-auto-en-t0.5", "embeddingModelId": "speaker-id-en-voxceleb", "numClusters": -1, "threshold": 0.5},
    {"label": "python-fixed2-en", "embeddingModelId": "speaker-id-en-voxceleb", "numClusters": 2, "threshold": 0.5},
    {"label": "python-fixed3-en", "embeddingModelId": "speaker-id-en-voxceleb", "numClusters": 3, "threshold": 0.5},
    {"label": "python-fixed2-zh-en", "embeddingModelId": "speaker-id-zh-en-advanced", "numClusters": 2, "threshold": 0.5},
    {"label": "python-fixed2-nemo-titanet", "embeddingModelId": "speaker-id-nemo-titanet-small", "numClusters": 2, "threshold": 0.5},
    {"label": "python-auto-nemo-t0.5", "embeddingModelId": "speaker-id-nemo-titanet-small", "numClusters": -1, "threshold": 0.5},
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wav", required=True)
    parser.add_argument("--models-dir", default=".agent/models/sherpa-diarization")
    parser.add_argument("--out", required=True)
    parser.add_argument("--segmentation-model", choices=("model.onnx", "model.int8.onnx"), default="model.onnx")
    parser.add_argument("--segmentation-id", choices=tuple(SEGMENTATION_DIRS), default="pyannote-segmentation-3-0")
    parser.add_argument("--num-threads", type=int, default=2)
    parser.add_argument("--cases-json", help="Optional JSON array of cases")
    return parser.parse_args()


def load_audio(path: Path, target_sample_rate: int) -> tuple[np.ndarray, int]:
    audio, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    audio = audio[:, 0]
    if sample_rate != target_sample_rate:
        if librosa is None:
            raise RuntimeError(f"Need librosa to resample {sample_rate} -> {target_sample_rate}")
        audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=target_sample_rate)
        sample_rate = target_sample_rate
    return np.asarray(audio, dtype=np.float32), sample_rate


def make_config(
    segmentation_model: Path,
    embedding_model: Path,
    num_clusters: int,
    threshold: float,
    num_threads: int,
) -> sherpa_onnx.OfflineSpeakerDiarizationConfig:
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=str(segmentation_model)
            ),
            num_threads=num_threads,
            debug=False,
            provider="cpu",
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(embedding_model),
            num_threads=num_threads,
            debug=False,
            provider="cpu",
        ),
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=num_clusters,
            threshold=threshold,
        ),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    if not config.validate():
        raise RuntimeError(f"Invalid sherpa-onnx diarization config: {config}")
    return config


def run_case(
    wav: Path,
    models_dir: Path,
    case: dict[str, Any],
    default_segmentation_id: str,
    default_segmentation_file: str,
    num_threads: int,
) -> dict[str, Any]:
    embedding_id = case["embeddingModelId"]
    embedding_file = EMBEDDING_FILES[embedding_id]
    segmentation_id = case.get("segmentationModelId", default_segmentation_id)
    segmentation_file = case.get("segmentationModelFile", default_segmentation_file)
    segmentation_dir = SEGMENTATION_DIRS[segmentation_id]
    segmentation_model = models_dir / segmentation_dir / segmentation_file
    embedding_model = models_dir / embedding_file
    num_clusters = int(case.get("numClusters", -1))
    threshold = float(case.get("threshold", 0.5))
    timing: dict[str, float] = {}

    t0 = time.perf_counter()
    config = make_config(segmentation_model, embedding_model, num_clusters, threshold, num_threads)
    sd = sherpa_onnx.OfflineSpeakerDiarization(config)
    timing["initMs"] = (time.perf_counter() - t0) * 1000.0

    t1 = time.perf_counter()
    audio, sample_rate = load_audio(wav, sd.sample_rate)
    timing["loadAudioMs"] = (time.perf_counter() - t1) * 1000.0
    if sample_rate != sd.sample_rate:
        raise RuntimeError(f"Expected sample rate {sd.sample_rate}, got {sample_rate}")

    t2 = time.perf_counter()
    result = sd.process(audio).sort_by_start_time()
    process_ms = (time.perf_counter() - t2) * 1000.0
    timing["processMs"] = process_ms

    segments = [
        {"start": float(seg.start), "end": float(seg.end), "speaker": int(seg.speaker)}
        for seg in result
    ]
    speaker_durations: dict[str, float] = {}
    for seg in segments:
        speaker = str(seg["speaker"])
        speaker_durations[speaker] = speaker_durations.get(speaker, 0.0) + max(0.0, seg["end"] - seg["start"])

    return {
        "label": case.get("label") or f"python-{embedding_id}-k{num_clusters}-t{threshold}",
        "platform": "python-macos",
        "sherpaOnnxVersion": getattr(sherpa_onnx, "__version__", None),
        "filePath": str(wav),
        "segmentationModelId": segmentation_id,
        "segmentationModelFile": str(segmentation_model),
        "embeddingModelId": embedding_id,
        "embeddingModelFile": str(embedding_model),
        "numClusters": num_clusters,
        "threshold": threshold,
        "numThreads": num_threads,
        "initSampleRate": sd.sample_rate,
        "timing": timing,
        "numSpeakers": len({s["speaker"] for s in segments}),
        "segmentCount": len(segments),
        "durationMs": process_ms,
        "speakerDurations": speaker_durations,
        "segments": segments,
        "firstSegments": segments[:8],
        "lastSegments": segments[-8:],
    }


def main() -> None:
    args = parse_args()
    wav = Path(args.wav)
    models_dir = Path(args.models_dir)
    cases = json.loads(Path(args.cases_json).read_text()) if args.cases_json else DEFAULT_CASES
    started = time.time()
    results = []
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    def write_output() -> None:
        output = {
            "op": "benchmarkPythonSherpaDiarizationSweep",
            "status": "success" if all(r["status"] == "success" for r in results) else "error",
            "result": {
                "filePath": str(wav),
                "segmentationModelId": args.segmentation_id,
                "segmentationModel": args.segmentation_model,
                "numThreads": args.num_threads,
                "startedAt": started,
                "totalDurationMs": (time.time() - started) * 1000.0,
                "completedCases": len(results),
                "requestedCases": len(cases),
                "results": results,
            },
        }
        out.write_text(json.dumps(output, indent=2) + "\n")

    for case in cases:
        try:
            result = run_case(
                wav,
                models_dir,
                case,
                args.segmentation_id,
                args.segmentation_model,
                args.num_threads,
            )
            results.append({"case": case, "status": "success", "result": result})
            print(f"{result['label']}: speakers={result['numSpeakers']} segments={result['segmentCount']} processMs={result['durationMs']:.0f}", flush=True)
        except Exception as exc:
            results.append({"case": case, "status": "error", "error": str(exc)})
            print(f"{case.get('label')}: ERROR {exc}", flush=True)
        write_output()


if __name__ == "__main__":
    main()
