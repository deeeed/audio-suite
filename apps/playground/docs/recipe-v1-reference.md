# AudioLab Recipe v1 reference

AudioLab playground is the Expo/React Native native-module reference
implementation for Farmslot Recipe Protocol v1. The app keeps its existing CDP
bridge and HUD; Recipe v1 adds a manifest, portable recipes, and standardized
summary/trace/artifact output.

## Migration matrix

| Area | Current evidence | V1 alignment | Follow-up |
| --- | --- | --- | --- |
| App bridge | `src/agentic-bridge.ts`, `scripts/agentic/cdp-bridge.mjs` expose navigation, state, HUD, screenshots, and native audio probes. | Reused as the project adapter behind Recipe v1 actions. | Keep bridge probes stable or version them in the manifest. |
| Official actions | `scripts/agentic/recipe-v1/manifests/audiolab.action-manifest.json` declares `ui.*`, `app.*`, `device.*`, `cdp.target`. | Aligned with Recipe Protocol v1 official vocabulary. | Add official actions only when the bridge can prove them live. |
| Domain actions | Manifest declares `audiolab.audio.*`, `audiolab.native.*`, `audiolab.asr.*`, `audiolab.device.*`. | Native-module behavior is namespaced and discoverable. | Prefer parameterized native probes over one file per task. |
| Recipes | `smoke.navigation.recipe.json`, `audio.native.lifecycle.recipe.json`. | Recipes use `schema_version: 1` and emit `summary.json`, `trace.json`, and `artifact-manifest.json`. | Add ASR long-run recipes separately when model fixtures are available. |
| Evidence | Runner writes `.agent/recipe-v1-runs/<timestamp>-<recipe>/`. | Reviewer-facing artifacts are separate from app state. | Attach selected artifacts to release/PR evidence. |

## Commands

```bash
cd apps/playground
yarn recipe:v1 manifest
yarn recipe:v1 validate scripts/agentic/recipe-v1/recipes/smoke.navigation.recipe.json
yarn recipe:v1 run scripts/agentic/recipe-v1/recipes/smoke.navigation.recipe.json --dry-run
yarn recipe:v1 run scripts/agentic/recipe-v1/recipes/audio.native.lifecycle.recipe.json --device <name>
```

Live runs require an existing development runtime with `globalThis.__AGENTIC__`
installed. Start it with the normal app commands before running recipes.

## Current validation evidence

Static validation completed on branch `codex/recipe-v1-reference`:

```bash
node --check scripts/agentic/recipe-v1/run-recipe-v1.mjs
for f in scripts/agentic/recipe-v1/recipes/*.recipe.json; do
  yarn recipe:v1 validate "$f"
  yarn recipe:v1 run "$f" --dry-run --artifacts-dir ".agent/recipe-v1-runs/dry-run-$(basename "$f" .recipe.json)"
done
```

Dry-run artifacts prove the runner emits the Recipe v1 evidence package shape:
`summary.json`, `trace.json`, and `artifact-manifest.json`.

Live validation still requires a running AudioLab playground development runtime.
The last local probe returned no agentic targets. Use the same recipes without
`--dry-run` once `yarn ios`, `yarn android`, or `yarn web` has a ready
`globalThis.__AGENTIC__` target.
