#!/usr/bin/env python3
"""Generate an EchoBridge Whisper transcript reference for ASR quality checks.

This local validation helper imports EchoBridge's server WhisperService so the
reference transcript is produced with the same backend model loading/device
selection used by the server codebase.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", required=True, help="Input audio file")
    parser.add_argument("--out-prefix", required=True, help="Output prefix without extension")
    parser.add_argument(
        "--server-dir",
        default="/Users/deeeed/dev/echobridge/echobridge_monorepo/services/server",
        help="EchoBridge services/server directory",
    )
    parser.add_argument(
        "--model",
        default="medium",
        choices=["base", "medium", "large"],
        help="EchoBridge WhisperService model alias",
    )
    parser.add_argument("--language", default="en")
    return parser.parse_args()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def segment_to_json(segment: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": segment.get("id"),
        "start": float(segment.get("start", 0.0)),
        "end": float(segment.get("end", 0.0)),
        "text": str(segment.get("text", "")).strip(),
    }


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
    from services.whisper_service import WhisperService  # noqa: PLC0415
    from utils.device_utils import get_device  # noqa: PLC0415

    started = time.time()
    device = str(get_device())
    print(json.dumps({"event": "device", "device": device}), flush=True)

    load_started = time.time()
    service = WhisperService()
    load_elapsed = time.time() - load_started
    print(json.dumps({"event": "service_loaded", "elapsed_s": round(load_elapsed, 3)}), flush=True)

    run_started = time.time()
    result = service.transcribe(
        str(audio),
        model=args.model,
        language=args.language,
        verbose=False,
        fp16=False,
    )
    run_elapsed = time.time() - run_started
    if result is None:
        raise SystemExit("EchoBridge WhisperService returned no result")

    transcript = str(result.get("text", "")).strip()
    segments = [segment_to_json(seg) for seg in result.get("segments", [])]
    summary = {
        "source": "EchoBridge WhisperService",
        "server_path": str(server),
        "audio_path": str(audio),
        "audio_sha256": sha256(audio),
        "model": args.model,
        "language": args.language,
        "device": device,
        "elapsed_s": round(run_elapsed, 3),
        "load_elapsed_s": round(load_elapsed, 3),
        "total_elapsed_s": round(time.time() - started, 3),
        "transcript_char_count": len(transcript),
        "segment_count": len(segments),
        "first_segments": segments[:5],
        "last_segments": segments[-5:],
    }

    out_prefix.with_suffix(".summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    out_prefix.with_suffix(".segments.json").write_text(json.dumps(segments, indent=2) + "\n")
    out_prefix.with_suffix(".transcript.txt").write_text(transcript + "\n")
    print(json.dumps({"event": "saved", "out_prefix": str(out_prefix), **summary}, indent=2), flush=True)


if __name__ == "__main__":
    main()
