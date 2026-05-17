# Sherpa Zipformer Streaming Investigation

## Current conclusion

Do **not** recommend the current Zipformer streaming rows as product defaults, and do not include them in the practical recommendation matrix. The validated text quality is not acceptable enough for Audio Playground live transcription, and official Python parity suggests this is not primarily an RN bridge bug.

## Evidence: official sherpa-onnx vs RN wrapper

A local official `sherpa-onnx==1.13.2` Python check was run against the same Zipformer model artifacts and the same Audio Playground WAV fixtures used by the RN benchmark.

Environment:

```bash
python3 -m venv apps/playground/.agent/sherpa-onnx-venv
apps/playground/.agent/sherpa-onnx-venv/bin/python -m pip install sherpa-onnx==1.13.2 soundfile
curl -L -o apps/playground/.agent/model-cache/zipformer-official/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17-mobile.tar.bz2 \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17-mobile.tar.bz2
curl -L -o apps/playground/.agent/model-cache/zipformer-official/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2 \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2
```

Official Python results:

| Model                     | Clip                         | Official transcript                                                                                         | RN benchmark comparison           | Conclusion                                           |
| ------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------- |
| 20M mobile Zipformer      | `jfk.wav`                    | `UL AMERICANS ASK NOT WHAT YOUR COUNTRY CAN DO FOR YOU ASK WHAT YOU CAN DO FOR YOUR COUNTRY`                | RN produced the same text         | Unsuitable, not primarily an RN bug                  |
| Bilingual zh/en Zipformer | `jfk.wav`                    | `AND SAW MY FELLOW AMERICANS ASK NOT WHAT YOUR COUNTRY CAN DO FOR YOU ASK WHAT YOU CAN DO FOR YOUR COUNTRY` | RN produced the same text         | RN parity is good, but product quality is still weak |
| 20M mobile Zipformer      | `recorder_jre_lex_watch.wav` | Starts with `'S YOURS NOW THAT AS NOMAGA...`                                                                | RN exact reference was not scored | Not product-usable                                   |
| Bilingual zh/en Zipformer | `recorder_jre_lex_watch.wav` | Starts with `THAT THATS IT OMEGA...`                                                                        | RN exact reference was not scored | Not product-usable                                   |

This means the tested Zipformer quality issue is not primarily an RN bridge/config bug. The official runtime produces the same JFK failure modes for both Zipformer rows, and the longer recorder fixture is also rough.

## Remaining uncertainty

Beam-search / hotword / punctuation experiments may still improve specific outputs, but the current greedy-search model artifacts should stay default-off until those experiments produce real-audio WER/CER gains without breaking latency.

## RN diagnostic artifacts

The RN diagnostic preset was used during investigation, but the active direct-runner practical matrix and model registry no longer include Zipformer. Recreate this only by restoring/re-adding the Zipformer rows to both `apps/playground/src/utils/asrBenchmarkModels.ts` and `apps/playground/scripts/agentic/direct-asr-benchmark.mjs` on a throwaway diagnostic branch if newer Zipformer artifacts need to be re-evaluated.

## Latest RN evidence

Latest Pixel 6a RN diagnostic artifact:

- `apps/playground/.agent/reports/direct-asr-benchmark-2026-05-17T14-52-33-860Z.md`
- Bilingual row: 4.5% WER on JFK, first partial 1.09s, wall RTF 1.00x, transcript starts `AND SAW...`
- 20M row: 18.2% WER on JFK, first partial 2.09s, wall RTF 1.00x, transcript starts `UL AMERICANS...`

## Follow-up gate

A Zipformer streaming row can only return to the active recommendation workflow if it passes all of these:

1. official sherpa-onnx Python/CLI and RN wrapper produce comparable output on the same WAV;
2. WER/CER is acceptable on real meeting/audio fixtures, not only JFK;
3. processing RTF stays below `1.0×` with bounded backlog on Pixel 6a-class devices; simulated wall RTF alone is not enough because the replay clock is paced;
4. endpoint/final-commit behavior is usable enough for the UI.
