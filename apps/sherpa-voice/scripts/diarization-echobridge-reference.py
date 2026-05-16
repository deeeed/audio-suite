#!/usr/bin/env python3
"""Generate EchoBridge/WhisperX/PyAnnote diarization reference segments.

This is a local validation helper. It imports the EchoBridge server config so it
uses the same Hugging Face token and device selection as the backend.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", required=True, help="Input audio file")
    parser.add_argument("--out-prefix", required=True, help="Output prefix without extension")
    parser.add_argument(
        "--server-dir",
        default="/Users/deeeed/dev/echobridge/echobridge_monorepo/services/server",
        help="EchoBridge services/server directory",
    )
    parser.add_argument("--min-speakers", type=int)
    parser.add_argument("--max-speakers", type=int)
    parser.add_argument("--num-speakers", type=int)
    return parser.parse_args()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    args = parse_args()
    audio = Path(args.audio).resolve()
    out_prefix = Path(args.out_prefix).resolve()
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    server = Path(args.server_dir).resolve()
    if not audio.exists():
        raise SystemExit(f"Missing audio: {audio}")
    if not server.exists():
        raise SystemExit(f"Missing EchoBridge server dir: {server}")

    sys.path.insert(0, str(server / "src"))
    from api.config import HF_TOKEN  # noqa: PLC0415
    from services.diarization_service import DiarizationService  # noqa: PLC0415
    import torch  # noqa: PLC0415
    from whisperx.diarize import DiarizationPipeline  # noqa: PLC0415

    if not HF_TOKEN:
        raise SystemExit("Missing HF_TOKEN from EchoBridge config")

    started = time.time()
    device = DiarizationService._setup_device()
    print(json.dumps({"event": "device", "device": str(device), "torch": torch.__version__}), flush=True)

    load_started = time.time()
    pipeline = DiarizationPipeline(token=HF_TOKEN, device=device)
    print(json.dumps({"event": "pipeline_loaded", "elapsed_s": round(time.time() - load_started, 3)}), flush=True)

    run_started = time.time()
    df = pipeline(
        str(audio),
        min_speakers=args.min_speakers,
        max_speakers=args.max_speakers,
        num_speakers=args.num_speakers,
    )
    run_elapsed = time.time() - run_started
    print(json.dumps({"event": "diarization_done", "elapsed_s": round(run_elapsed, 3), "rows": int(len(df))}), flush=True)

    segments = []
    for i, row in enumerate(df.to_dict(orient="records")):
        start = float(row.get("start"))
        end = float(row.get("end"))
        speaker = str(row.get("speaker"))
        segments.append(
            {
                "index": i,
                "start": start,
                "end": end,
                "speaker": speaker,
                "duration": max(0.0, end - start),
            }
        )

    speaker_durations: dict[str, float] = {}
    for seg in segments:
        speaker_durations[seg["speaker"]] = speaker_durations.get(seg["speaker"], 0.0) + seg["duration"]

    summary = {
        "source": "EchoBridge direct WhisperX DiarizationPipeline",
        "server_path": str(server),
        "audio_path": str(audio),
        "audio_sha256": sha256(audio),
        "pipeline_model": "pyannote/speaker-diarization-community-1 via whisperx.diarize.DiarizationPipeline",
        "device": str(device),
        "torch": torch.__version__,
        "params": {
            "min_speakers": args.min_speakers,
            "max_speakers": args.max_speakers,
            "num_speakers": args.num_speakers,
        },
        "elapsed_s": round(run_elapsed, 3),
        "total_elapsed_s": round(time.time() - started, 3),
        "segment_count": len(segments),
        "speaker_count": len(speaker_durations),
        "speakers": sorted(speaker_durations),
        "speaker_durations": {k: round(v, 6) for k, v in sorted(speaker_durations.items())},
        "first_segments": segments[:10],
        "last_segments": segments[-10:],
    }

    (out_prefix.with_suffix(".summary.json")).write_text(json.dumps(summary, indent=2) + "\n")
    (out_prefix.with_suffix(".segments.json")).write_text(json.dumps(segments, indent=2) + "\n")
    df.to_csv(out_prefix.with_suffix(".csv"), index=False)
    print(json.dumps({"event": "saved", "out_prefix": str(out_prefix), **summary}, indent=2), flush=True)


if __name__ == "__main__":
    main()
