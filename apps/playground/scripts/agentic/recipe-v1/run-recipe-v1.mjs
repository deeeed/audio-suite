#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_ARTIFACT_ROOT = path.join(APP_ROOT, '.agent', 'recipe-v1-runs');
const APP_NAME = 'audiolab-playground';
const MANIFEST_PATH = path.join(__dirname, 'manifests', 'audiolab.action-manifest.json');

function usage() {
  console.log(`AudioLab Recipe v1 runner\n\nUsage:\n  node scripts/agentic/recipe-v1/run-recipe-v1.mjs manifest\n  node scripts/agentic/recipe-v1/run-recipe-v1.mjs validate <recipe>\n  node scripts/agentic/recipe-v1/run-recipe-v1.mjs run <recipe> [--dry-run] [--device <name>] [--artifacts-dir <dir>]\n`);
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function slug(value) { return String(value || 'recipe').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'recipe'; }
function nowStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

function parseArgs(argv) {
  const [command, recipeArg, ...rest] = argv;
  const options = { command, recipeArg, dryRun: false, device: '', artifactsDir: '' };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--device') options.device = rest[++i] || '';
    else if (arg === '--artifacts-dir') options.artifactsDir = rest[++i] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function runProcess(args, { timeoutMs = 60000, allowFailure = false } = {}) {
  const result = spawnSync(args[0], args.slice(1), { cwd: APP_ROOT, encoding: 'utf8', timeout: timeoutMs, env: process.env });
  const output = { command: args, exitCode: result.status ?? 0, stdout: result.stdout || '', stderr: result.stderr || '' };
  if (result.error) output.error = result.error.message;
  if (!allowFailure && (result.error || output.exitCode !== 0)) {
    const detail = output.stderr || output.stdout || output.error || `exit ${output.exitCode}`;
    throw new Error(`${args.join(' ')} failed: ${detail}`);
  }
  return output;
}

function parseMaybeJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const starts = [raw.indexOf('['), raw.indexOf('{')].filter((index) => index >= 0);
  if (starts.length === 0) return raw;
  const start = Math.min(...starts);
  try { return JSON.parse(raw.slice(start)); } catch { return raw; }
}

function cdp(args, ctx, options = {}) {
  const command = ['node', 'scripts/agentic/cdp-bridge.mjs'];
  if (ctx.device) command.push('--device', ctx.device);
  command.push(...args);
  const out = runProcess(command, options);
  return { ...out, parsed: parseMaybeJson(out.stdout) };
}

function script(scriptPath, args, ctx, options = {}) {
  const command = ['bash', scriptPath];
  if (ctx.device) command.push('--device', ctx.device);
  command.push(...args);
  const out = runProcess(command, options);
  return { ...out, parsed: parseMaybeJson(out.stdout) };
}

function valueAt(root, dottedPath) {
  if (!dottedPath) return root;
  return String(dottedPath).split('.').reduce((value, part) => value == null ? undefined : value[part], root);
}

function interpolate(value, ctx) {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*outputs\.([^.}]+)(?:\.([^}]+))?\s*\}\}/g, (_m, nodeId, outputPath) => {
      const resolved = valueAt(ctx.outputs[nodeId], outputPath || '');
      return resolved == null ? '' : String(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, ctx));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, ctx)]));
  return value;
}

function assertValue(output, assertion) {
  if (!assertion) return;
  const actual = valueAt(output, assertion.path || assertion.source || '');
  const op = assertion.operator || 'truthy';
  const expected = assertion.value;
  const ok = (() => {
    if (op === 'exists') return actual !== undefined;
    if (op === 'not_null') return actual !== null && actual !== undefined;
    if (op === 'truthy') return Boolean(actual);
    if (op === 'falsy') return !actual;
    if (op === 'eq') return actual === expected;
    if (op === 'contains') return String(actual ?? '').includes(String(expected));
    if (op === 'one_of') return Array.isArray(expected) && expected.includes(actual);
    if (op === 'length_gt') return (Array.isArray(actual) || typeof actual === 'string') && actual.length > Number(expected);
    if (op === 'gte') return Number(actual) >= Number(expected);
    return false;
  })();
  if (!ok) throw new Error(`Assertion failed (${op}) at ${assertion.path || assertion.source || '<output>'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function validateRecipe(recipe) {
  const errors = [];
  if (recipe.schema_version !== 1) errors.push('schema_version must be 1');
  if (!recipe.title) errors.push('title is required');
  if (!recipe.description) errors.push('description is required');
  const workflow = recipe.validate?.workflow;
  if (!workflow?.entry) errors.push('validate.workflow.entry is required');
  if (!workflow?.nodes || typeof workflow.nodes !== 'object') errors.push('validate.workflow.nodes is required');
  const nodes = workflow?.nodes || {};
  if (workflow?.entry && !nodes[workflow.entry]) errors.push(`entry node not found: ${workflow.entry}`);
  for (const [id, node] of Object.entries(nodes)) {
    if (!node.action) errors.push(`${id}: action is required`);
    if (node.action !== 'end' && !node.next) errors.push(`${id}: next is required for non-terminal nodes`);
    if (node.next && !nodes[node.next]) errors.push(`${id}: next target not found: ${node.next}`);
  }
  return errors;
}

function recordArtifact(ctx, artifact) { ctx.artifacts.push({ ...artifact, createdAt: new Date().toISOString() }); }

async function pollLastResult(ctx, expectedOp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const result = cdp(['eval', 'globalThis.__AGENTIC__?.getLastResult?.()'], ctx, { allowFailure: true, timeoutMs: 10000 }).parsed;
    last = result;
    if (result && typeof result === 'object' && result.status && result.status !== 'pending') {
      if (expectedOp && result.op && result.op !== expectedOp) {
        throw new Error(`Unexpected async result op: expected ${expectedOp}, got ${result.op}`);
      }
      if (result.status === 'error') throw new Error(result.error || `${expectedOp} failed`);
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${expectedOp}; last=${JSON.stringify(last)}`);
}

async function executeNode(id, rawNode, ctx) {
  const node = interpolate(rawNode, ctx);
  const startedAt = new Date().toISOString();
  if (ctx.dryRun) {
    const output = { dryRun: true, action: node.action, description: node.description || '' };
    ctx.outputs[id] = output;
    ctx.trace.push({ nodeId: id, action: node.action, status: 'skipped', dryRun: true, startedAt, endedAt: new Date().toISOString(), description: node.description || '' });
    return { next: node.next, terminal: node.action === 'end', status: node.status || 'unknown' };
  }
  try {
    let output;
    switch (node.action) {
      case 'cdp.target': output = cdp(['list-devices'], ctx).parsed; break;
      case 'app.status': output = cdp(['get-state'], ctx).parsed; break;
      case 'app.hud': {
        const payload = { id, status: node.status || 'running', intent: node.intent || node.description || id, detail: node.detail || '' };
        output = cdp(['set-step-hud', JSON.stringify(payload)], ctx, { allowFailure: true }).parsed;
        break;
      }
      case 'device.reload': output = cdp(['reload'], ctx).parsed; break;
      case 'device.logs': output = runProcess(['bash', 'scripts/agentic/native-logs.sh', node.platform || 'ios'], { allowFailure: true, timeoutMs: node.timeout_ms || 30000 }); break;
      case 'ui.navigate': output = cdp(['navigate', node.path || node.route], ctx).parsed; break;
      case 'ui.press': output = cdp(['press-test-id', node.test_id || node.testId], ctx).parsed; break;
      case 'ui.set_input': output = cdp(['set-input', node.test_id || node.testId, node.value || ''], ctx).parsed; break;
      case 'ui.scroll': {
        const args = ['scroll-view', '--offset', String(node.delta_y ?? node.offset ?? 500)];
        if (node.test_id || node.testId) args.push('--test-id', node.test_id || node.testId);
        output = cdp(args, ctx).parsed;
        break;
      }
      case 'ui.screenshot': {
        output = script('scripts/agentic/screenshot.sh', [node.label || id], ctx).parsed;
        const screenshots = output?.devices || (output?.screenshot ? [output] : []);
        for (const shot of screenshots) if (shot.screenshot) recordArtifact(ctx, { kind: 'screenshot', nodeId: id, path: shot.screenshot, mimeType: 'image/png' });
        break;
      }
      case 'wait': await new Promise((resolve) => setTimeout(resolve, Number(node.duration_ms || 1000))); output = { waitedMs: Number(node.duration_ms || 1000) }; break;
      case 'audiolab.device.list': output = cdp(['list-devices'], ctx).parsed; break;
      case 'audiolab.audio.state': output = cdp(['get-state'], ctx).parsed; break;
      case 'audiolab.native.extract_preview': {
        cdp(['eval', 'globalThis.__AGENTIC__?.testExtractPreview?.()'], ctx, { timeoutMs: 10000 });
        output = await pollLastResult(ctx, 'extractPreview', node.timeout_ms || 30000);
        break;
      }
      case 'audiolab.native.extract_audio_data': {
        cdp(['eval', 'globalThis.__AGENTIC__?.testExtractAudioData?.()'], ctx, { timeoutMs: 10000 });
        output = await pollLastResult(ctx, 'extractAudioData', node.timeout_ms || 30000);
        break;
      }
      case 'audiolab.native.trim_audio': {
        cdp(['eval', 'globalThis.__AGENTIC__?.testTrimAudio?.()'], ctx, { timeoutMs: 10000 });
        output = await pollLastResult(ctx, 'trimAudio', node.timeout_ms || 45000);
        break;
      }
      case 'audiolab.asr.last_result': output = cdp(['eval', 'globalThis.__AGENTIC__?.getLastResult?.()'], ctx).parsed; break;
      case 'end': output = { status: node.status || 'pass' }; break;
      default: throw new Error(`Unsupported action: ${node.action}`);
    }
    assertValue(output, node.assert);
    ctx.outputs[id] = output;
    ctx.trace.push({ nodeId: id, action: node.action, status: 'pass', startedAt, endedAt: new Date().toISOString(), description: node.description || '', output });
    return { next: node.next, terminal: node.action === 'end', status: node.status || 'pass' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.outputs[id] = { error: message };
    ctx.trace.push({ nodeId: id, action: node.action, status: 'fail', startedAt, endedAt: new Date().toISOString(), description: node.description || '', error: message });
    throw error;
  }
}

async function runRecipe(recipePath, options) {
  const recipe = readJson(recipePath);
  const validationErrors = validateRecipe(recipe);
  if (validationErrors.length) throw new Error(`Recipe validation failed:\n- ${validationErrors.join('\n- ')}`);
  const artifactsDir = path.resolve(options.artifactsDir || path.join(DEFAULT_ARTIFACT_ROOT, `${nowStamp()}-${slug(path.basename(recipePath, path.extname(recipePath)))}`));
  fs.mkdirSync(artifactsDir, { recursive: true });
  const ctx = { device: options.device, dryRun: options.dryRun, artifactsDir, trace: [], outputs: {}, artifacts: [] };
  let status = 'pass';
  let errorMessage = '';
  try {
    let current = recipe.validate.workflow.entry;
    const nodes = recipe.validate.workflow.nodes;
    const visited = new Set();
    while (current) {
      if (visited.has(current)) throw new Error(`Cycle detected at node ${current}`);
      visited.add(current);
      const result = await executeNode(current, nodes[current], ctx);
      if (result.terminal) { status = result.status || 'pass'; break; }
      current = result.next;
    }
  } catch (error) {
    status = 'fail';
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  const summary = {
    schema_version: 1,
    runner: `${APP_NAME}-recipe-v1-reference`,
    recipe: { path: path.relative(APP_ROOT, recipePath), title: recipe.title, description: recipe.description },
    status,
    dryRun: options.dryRun,
    startedAt: ctx.trace[0]?.startedAt || new Date().toISOString(),
    endedAt: new Date().toISOString(),
    nodeCount: ctx.trace.length,
    error: errorMessage || undefined,
    artifactsDir,
  };
  const artifactManifest = { schema_version: 1, runner_protocol_version: 1, app: APP_NAME, runStatus: status, recipeTitle: recipe.title, artifacts: ctx.artifacts };
  writeJson(path.join(artifactsDir, 'summary.json'), summary);
  writeJson(path.join(artifactsDir, 'trace.json'), { schema_version: 1, entries: ctx.trace });
  writeJson(path.join(artifactsDir, 'artifact-manifest.json'), artifactManifest);
  console.log(JSON.stringify({ status, artifactsDir, summary: path.join(artifactsDir, 'summary.json'), trace: path.join(artifactsDir, 'trace.json'), artifactManifest: path.join(artifactsDir, 'artifact-manifest.json') }, null, 2));
  if (status !== 'pass') process.exitCode = 1;
}

const options = parseArgs(process.argv.slice(2));
if (!options.command || options.command === '--help' || options.command === '-h') usage();
else if (options.command === 'manifest') console.log(fs.readFileSync(MANIFEST_PATH, 'utf8'));
else if (options.command === 'validate') {
  if (!options.recipeArg) throw new Error('validate requires a recipe path');
  const recipePath = path.resolve(APP_ROOT, options.recipeArg);
  const errors = validateRecipe(readJson(recipePath));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ ok: true, recipe: path.relative(APP_ROOT, recipePath) }, null, 2));
} else if (options.command === 'run') {
  if (!options.recipeArg) throw new Error('run requires a recipe path');
  await runRecipe(path.resolve(APP_ROOT, options.recipeArg), options);
} else {
  throw new Error(`Unknown command: ${options.command}`);
}
