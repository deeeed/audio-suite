#!/usr/bin/env python3
"""Score diarization JSON with pyannote.metrics.

Inputs mirror scripts/diarization-score.mjs:
- array of {start, end, speaker}
- object with .segments
- agentic benchmark object with .result.segments
- sweep object with .result.results[].result.segments

Run with the EchoBridge Python env, e.g.:
  /opt/homebrew/Caskroom/miniconda/base/envs/echobridge/bin/python \
    apps/sherpa-voice/scripts/diarization-score-pyannote.py \
    --reference ref.json --hypothesis hyp.json --out score.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from pyannote.core import Annotation, Segment, Timeline
from pyannote.metrics.diarization import DiarizationErrorRate, JaccardErrorRate


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", required=True, help="Reference segments JSON")
    parser.add_argument("--hypothesis", required=True, help="Hypothesis segments JSON")
    parser.add_argument("--out", help="Output JSON path")
    parser.add_argument("--collar", type=float, default=0.0, help="Collar in seconds")
    parser.add_argument(
        "--skip-overlap",
        action="store_true",
        help="Ignore overlapped speech regions, matching pyannote.metrics option",
    )
    parser.add_argument(
        "--uem",
        choices=("union", "full"),
        default="union",
        help="Evaluation map: union lets pyannote approximate; full uses 0..max segment end",
    )
    return parser.parse_args()


def read_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text())


def normalize_segment(raw: dict[str, Any], index: int) -> dict[str, Any] | None:
    try:
        start = float(raw["start"])
        end = float(raw["end"])
    except (KeyError, TypeError, ValueError):
        return None
    if end <= start:
        return None
    speaker = str(
        raw.get("speaker")
        or raw.get("label")
        or raw.get("speaker_id")
        or raw.get("name")
        or "UNKNOWN"
    )
    return {"index": index, "start": start, "end": end, "speaker": speaker}


def normalize_segments(value: Any, label: str) -> list[dict[str, Any]]:
    arr = value
    if not isinstance(arr, list):
        arr = value.get("segments") if isinstance(value, dict) else None
    if not isinstance(arr, list) and isinstance(value, dict):
        result = value.get("result")
        if isinstance(result, dict):
            arr = result.get("segments")
    if not isinstance(arr, list):
        raise ValueError(f"{label} does not contain a segment array")
    segments = [normalize_segment(raw, i) for i, raw in enumerate(arr)]
    return sorted([s for s in segments if s], key=lambda s: (s["start"], s["end"]))


def extract_hypotheses(value: Any) -> list[dict[str, Any]]:
    sweep = None
    if isinstance(value, dict):
        result = value.get("result")
        if isinstance(result, dict):
            sweep = result.get("results")
    if isinstance(sweep, list):
        out = []
        for index, entry in enumerate(sweep):
            result = entry.get("result") if isinstance(entry, dict) else None
            if not isinstance(result, dict) or not result.get("segments"):
                continue
            case = entry.get("case") if isinstance(entry.get("case"), dict) else {}
            out.append(
                {
                    "label": result.get("label") or case.get("label") or f"case-{index}",
                    "metadata": {
                        "status": entry.get("status"),
                        "embeddingModelId": result.get("embeddingModelId"),
                        "numClusters": result.get("numClusters"),
                        "threshold": result.get("threshold"),
                        "durationMs": result.get("durationMs"),
                        "segmentCount": result.get("segmentCount"),
                        "numSpeakers": result.get("numSpeakers"),
                    },
                    "segments": normalize_segments(result, f"hypothesis {index}"),
                }
            )
        return out
    label = "hypothesis"
    if isinstance(value, dict):
        result = value.get("result") if isinstance(value.get("result"), dict) else {}
        label = result.get("label") or value.get("label") or label
    return [{"label": label, "metadata": {}, "segments": normalize_segments(value, "hypothesis")}]


def to_annotation(segments: list[dict[str, Any]], uri: str) -> Annotation:
    ann = Annotation(uri=uri)
    for i, seg in enumerate(segments):
        # Include index in track so adjacent same-speaker turns remain distinct.
        ann[Segment(seg["start"], seg["end"]), f"track_{i}"] = seg["speaker"]
    return ann


def speaker_count(segments: list[dict[str, Any]]) -> int:
    return len({s["speaker"] for s in segments})


def max_end(*segment_lists: list[dict[str, Any]]) -> float:
    end = 0.0
    for segments in segment_lists:
        for seg in segments:
            end = max(end, float(seg["end"]))
    return end


def score_one(
    reference_segments: list[dict[str, Any]],
    hypothesis_segments: list[dict[str, Any]],
    label: str,
    metadata: dict[str, Any],
    collar: float,
    skip_overlap: bool,
    uem_mode: str,
) -> dict[str, Any]:
    uri = "diarization-fixture"
    reference = to_annotation(reference_segments, uri)
    hypothesis = to_annotation(hypothesis_segments, uri)
    uem = None
    if uem_mode == "full":
        uem = Timeline([Segment(0.0, max_end(reference_segments, hypothesis_segments))], uri=uri)

    der_metric = DiarizationErrorRate(collar=collar, skip_overlap=skip_overlap)
    jer_metric = JaccardErrorRate(collar=collar, skip_overlap=skip_overlap)
    der = der_metric(reference, hypothesis, uem=uem, detailed=True)
    jer = jer_metric(reference, hypothesis, uem=uem, detailed=True)

    return {
        "label": label,
        "metadata": metadata,
        "score": {
            "collar": collar,
            "skipOverlap": skip_overlap,
            "uem": uem_mode,
            "refSpeakerCount": speaker_count(reference_segments),
            "hypSpeakerCount": speaker_count(hypothesis_segments),
            "refSegmentCount": len(reference_segments),
            "hypSegmentCount": len(hypothesis_segments),
            "diarizationErrorRate": der["diarization error rate"],
            "diarizationErrorRatePercent": 100.0 * der["diarization error rate"],
            "jaccardErrorRate": jer["jaccard error rate"],
            "jaccardErrorRatePercent": 100.0 * jer["jaccard error rate"],
            "components": {
                "falseAlarm": der["false alarm"],
                "missedDetection": der["missed detection"],
                "confusion": der["confusion"],
                "correct": der["correct"],
                "total": der["total"],
                "speakerCount": jer["speaker count"],
                "speakerError": jer["speaker error"],
            },
        },
    }


def main() -> None:
    args = parse_args()
    reference_segments = normalize_segments(read_json(args.reference), "reference")
    hypotheses = extract_hypotheses(read_json(args.hypothesis))
    results = [
        score_one(
            reference_segments,
            h["segments"],
            h["label"],
            h["metadata"],
            args.collar,
            args.skip_overlap,
            args.uem,
        )
        for h in hypotheses
    ]
    output = {
        "reference": str(Path(args.reference).resolve()),
        "hypothesis": str(Path(args.hypothesis).resolve()),
        "metric": "pyannote.metrics",
        "results": results,
    }
    rendered = json.dumps(output, indent=2)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(rendered + "\n")
    print(rendered)


if __name__ == "__main__":
    main()
