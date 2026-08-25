#!/usr/bin/env python3
"""Run an upstream Pyannote diarization pipeline on a WAV and emit benchmark JSON."""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import platform
import resource
import time
from pathlib import Path

import soundfile as sf
import torch
from pyannote.audio import Pipeline


REPO_ROOT = Path(__file__).resolve().parents[3]


def allowed_roots() -> list[Path]:
    configured = os.environ.get("BENCHMARK_ALLOWED_ROOTS", "")
    roots = [REPO_ROOT]
    roots.extend(Path(value) for value in configured.split(os.pathsep) if value)
    return [root.resolve(strict=True) for root in roots if root.exists()]


def within(candidate: Path, root: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def require_allowed(candidate: Path, roots: list[Path]) -> Path:
    if not any(within(candidate, root) for root in roots):
        raise ValueError(
            f"Path is outside benchmark roots: {candidate}. "
            "Set BENCHMARK_ALLOWED_ROOTS to an explicit trusted directory."
        )
    return candidate


def resolve_input(value: str, roots: list[Path]) -> Path:
    candidate = Path(value).resolve(strict=True)
    require_allowed(candidate, roots)
    if not candidate.is_file():
        raise ValueError(f"Expected an input file: {candidate}")
    return candidate


def resolve_output(value: str, roots: list[Path]) -> Path:
    candidate = Path(value).expanduser().absolute()
    parent = candidate.parent.resolve(strict=True)
    require_allowed(parent, roots)
    return parent / candidate.name


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wav", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument(
        "--pipeline", default="pyannote/speaker-diarization-community-1"
    )
    parser.add_argument("--device", choices=("auto", "cpu", "mps"), default="auto")
    parser.add_argument("--num-speakers", type=int)
    parser.add_argument("--min-speakers", type=int)
    parser.add_argument("--max-speakers", type=int)
    return parser.parse_args()


def resolve_device(requested: str) -> torch.device:
    if requested == "mps":
        if not torch.backends.mps.is_available():
            raise RuntimeError("MPS requested but unavailable")
        return torch.device("mps")
    if requested == "cpu":
        return torch.device("cpu")
    return torch.device("mps" if torch.backends.mps.is_available() else "cpu")


def package_version(name: str) -> str:
    return importlib.metadata.version(name)


def peak_rss_bytes() -> int:
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if platform.system() == "Darwin" else value * 1024)


def speaker_count_mode(args: argparse.Namespace) -> str:
    if args.num_speakers is not None:
        return "exact"
    if args.min_speakers is not None or args.max_speakers is not None:
        return "bounded"
    return "automatic"


def main() -> None:
    args = parse_args()
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if not token:
        raise RuntimeError(
            "HF_TOKEN is required. Accept the Community-1 model terms first; the token is never written to the report."
        )
    device = resolve_device(args.device)
    roots = allowed_roots()
    wav = resolve_input(args.wav, roots)
    out = resolve_output(args.out, roots)
    audio_info = sf.info(wav)

    init_started = time.perf_counter()
    pipeline = Pipeline.from_pretrained(args.pipeline, token=token)
    pipeline.to(device)
    init_seconds = time.perf_counter() - init_started

    kwargs: dict[str, int] = {}
    if args.num_speakers is not None:
        kwargs["num_speakers"] = args.num_speakers
    if args.min_speakers is not None:
        kwargs["min_speakers"] = args.min_speakers
    if args.max_speakers is not None:
        kwargs["max_speakers"] = args.max_speakers

    process_started = time.perf_counter()
    result = pipeline(str(wav), **kwargs)
    process_seconds = time.perf_counter() - process_started
    annotation = getattr(result, "speaker_diarization", result)
    segments = [
        {
            "start": float(turn.start),
            "end": float(turn.end),
            "speaker": str(speaker),
        }
        for turn, _, speaker in annotation.itertracks(yield_label=True)
    ]
    output = {
        "runtime": "pyannote.audio",
        "pipeline": args.pipeline,
        "versions": {
            "pyannoteAudio": package_version("pyannote.audio"),
            "torch": package_version("torch"),
        },
        "device": str(device),
        "host": {
            "machine": platform.machine(),
            "platform": platform.platform(),
        },
        "filePath": str(wav),
        "audioDurationSeconds": float(audio_info.duration),
        "speakerCountMode": speaker_count_mode(args),
        "numSpeakers": len({segment["speaker"] for segment in segments}),
        "segmentCount": len(segments),
        "timing": {
            "initSeconds": init_seconds,
            "processSeconds": process_seconds,
            "rtfx": audio_info.duration / process_seconds,
        },
        "peakRssBytes": peak_rss_bytes(),
        "segments": segments,
    }
    # resolve_output validated the canonical parent against the allowed roots.
    out.write_text(  # NOSONAR
        json.dumps(output, indent=2) + "\n"
    )
    print(json.dumps({"out": str(out), **output["timing"]}, indent=2))


if __name__ == "__main__":
    main()
