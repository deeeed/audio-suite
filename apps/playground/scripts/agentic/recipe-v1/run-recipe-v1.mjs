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

const OFFICIAL_ACTIONS = new Set([
  'command', 'wait', 'assert_file', 'assert_json', 'assert_exit_code', 'assert_output',
  'state_read', 'watch_logs', 'index_artifacts', 'call', 'switch', 'manual', 'end',
  'ui.navigate', 'ui.press', 'ui.key_press', 'ui.set_input', 'ui.scroll', 'ui.gesture',
  'ui.wait_for', 'ui.screenshot', 'app.status', 'app.lifecycle', 'app.hud', 'app.trace',
  'cdp.target', 'cdp.storage', 'cdp.network', 'cdp.emulation', 'cdp.metrics', 'cdp.trace',
]);

function usage() {
  console.log(`${APP_NAME} Recipe v1 runner\n\nUsage:\n  node scripts/agentic/recipe-v1/run-recipe-v1.mjs manifest\n  node scripts/agentic/recipe-v1/run-recipe-v1.mjs validate <recipe>\n  node scripts/agentic/recipe-v1/run-recipe-v1.mjs run <recipe> [--dry-run] [--device <name>] [--artifacts-dir <dir>]\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function slug(value) {
  return String(value || 'recipe').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'recipe';
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

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
  const result = spawnSync(args[0], args.slice(1), {
    cwd: APP_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
  });
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
  try {
    return JSON.parse(raw.slice(start));
  } catch {
    // Bridge commands may print warnings before/after JSON; raw text is the expected fallback.
    return raw;
  }
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

function valueAt(root, selector) {
  if (!selector) return root;
  const raw = String(selector).trim();
  let normalized = raw;
  if (raw === '$') normalized = '';
  else if (raw.startsWith('$.')) normalized = raw.slice(2);
  if (!normalized) return root;
  return normalized.split('.').reduce((value, part) => {
    if (value == null) return undefined;
    const match = /^(.*)\[(\d+)\]$/.exec(part);
    if (match) return value[match[1]]?.[Number(match[2])];
    return value[part];
  }, root);
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

const ASSERTION_OPERATORS = {
  exists: (actual) => actual !== undefined,
  not_null: (actual) => actual !== null && actual !== undefined,
  truthy: (actual) => Boolean(actual),
  falsy: (actual) => !actual,
  eq: (actual, expected) => actual === expected,
  neq: (actual, expected) => actual !== expected,
  deep_eq: (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected),
  contains: (actual, expected) => String(actual ?? '').includes(String(expected)),
  not_contains: (actual, expected) => !String(actual ?? '').includes(String(expected)),
  matches: (actual, expected) => new RegExp(String(expected)).test(String(actual ?? '')),
  one_of: (actual, expected) => Array.isArray(expected) && expected.includes(actual),
  gt: (actual, expected) => Number(actual) > Number(expected),
  gte: (actual, expected) => Number(actual) >= Number(expected),
  lt: (actual, expected) => Number(actual) < Number(expected),
  lte: (actual, expected) => Number(actual) <= Number(expected),
  length_eq: (actual, expected) => hasLength(actual) && actual.length === Number(expected),
  length_gt: (actual, expected) => hasLength(actual) && actual.length > Number(expected),
  length_gte: (actual, expected) => hasLength(actual) && actual.length >= Number(expected),
  length_lt: (actual, expected) => hasLength(actual) && actual.length < Number(expected),
  length_lte: (actual, expected) => hasLength(actual) && actual.length <= Number(expected),
};

function hasLength(value) {
  return Array.isArray(value) || typeof value === 'string';
}

function compareAssertion(actual, assertion) {
  const op = assertion.operator || 'truthy';
  const compare = ASSERTION_OPERATORS[op];
  if (!compare) throw new Error(`Unsupported assertion operator: ${op}`);
  return compare(actual, assertion.value);
}
function evaluateAssertion(output, assertion) {
  try {
    assertValue(output, assertion);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function assertValue(output, assertion) {
  if (!assertion) return;
  if (Array.isArray(assertion.all)) {
    for (const child of assertion.all) assertValue(output, child);
    return;
  }
  if (Array.isArray(assertion.any)) {
    const results = assertion.any.map((child) => evaluateAssertion(output, child));
    if (results.some((result) => result.ok)) return;
    throw new Error(`Assertion any failed: ${results.map((result) => result.error).join('; ')}`);
  }
  if (Array.isArray(assertion.none)) {
    const passingIndex = assertion.none.findIndex((child) => evaluateAssertion(output, child).ok);
    if (passingIndex >= 0) throw new Error(`Assertion none failed: child ${passingIndex} passed`);
    return;
  }
  const selector = assertion.path || assertion.source || '';
  const actual = valueAt(output, selector);
  const ok = compareAssertion(actual, assertion);
  if (!ok) {
    throw new Error(`Assertion failed (${assertion.operator || 'truthy'}) at ${selector || '<output>'}: expected ${JSON.stringify(assertion.value)}, got ${JSON.stringify(actual)}`);
  }
}

function validateOfficialActions(manifest, declared) {
  const errors = [];
  const actions = manifest.supported_official_actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    errors.push('manifest.supported_official_actions must be non-empty');
    return errors;
  }
  for (const action of actions) {
    if (!OFFICIAL_ACTIONS.has(action)) errors.push(`manifest declares unknown official action: ${action}`);
    if (declared.has(action)) errors.push(`manifest declares duplicate action: ${action}`);
    declared.add(action);
  }
  return errors;
}

function validateCustomAction(entry, declared) {
  const errors = [];
  if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name) {
    return ['manifest.custom_actions entries must have name'];
  }
  if (OFFICIAL_ACTIONS.has(entry.name)) errors.push(`custom action overlaps official action: ${entry.name}`);
  if (declared.has(entry.name)) errors.push(`manifest declares duplicate action: ${entry.name}`);
  if (typeof entry.owner !== 'string' || !entry.owner) errors.push(`custom action missing owner: ${entry.name}`);
  if (typeof entry.description !== 'string' || !entry.description) errors.push(`custom action missing description: ${entry.name}`);
  if (!entry.schema || typeof entry.schema !== 'object' || Array.isArray(entry.schema)) errors.push(`custom action missing schema: ${entry.name}`);
  if (!Array.isArray(entry.examples) || entry.examples.length === 0) errors.push(`custom action missing examples: ${entry.name}`);
  declared.add(entry.name);
  return errors;
}

function validateCustomActions(manifest, declared) {
  if (manifest.custom_actions == null) return [];
  if (!Array.isArray(manifest.custom_actions)) return ['manifest.custom_actions must be an array'];
  return manifest.custom_actions.flatMap((entry) => validateCustomAction(entry, declared));
}

function validateActionMetadata(manifest, declared) {
  return Object.keys(manifest.action_metadata || {})
    .filter((action) => !declared.has(action))
    .map((action) => `action_metadata references undeclared action: ${action}`);
}

function validateManifest(manifest) {
  const declared = new Set();
  const errors = [
    ...(manifest.runner_protocol_version === 1 ? [] : ['manifest.runner_protocol_version must be 1']),
    ...(manifest.action_registry_version === 1 ? [] : ['manifest.action_registry_version must be 1']),
    ...validateOfficialActions(manifest, declared),
    ...validateCustomActions(manifest, declared),
    ...validateActionMetadata(manifest, declared),
  ];
  return { errors, declared };
}
function validateLifecycleArray(value, pathName, declared) {
  const errors = [];
  if (value == null) return errors;
  if (!Array.isArray(value)) return [`${pathName} must be an array when present`];
  value.forEach((node, index) => validateNode(`${pathName}[${index}]`, node, {}, declared, { lifecycle: true }).forEach((error) => errors.push(error)));
  return errors;
}

function validateNode(id, node, nodes, declared, { lifecycle = false } = {}) {
  const errors = [];
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [`${id}: node must be an object`];
  if (!node.action) errors.push(`${id}: action is required`);
  else if (!declared.has(node.action)) errors.push(`${id}: action is not declared by manifest: ${node.action}`);
  if (!lifecycle && node.action !== 'end' && typeof node.intent !== 'string') errors.push(`${id}: intent is required for non-terminal executable nodes`);
  else if (!lifecycle && node.action !== 'end' && node.intent.trim().length === 0) errors.push(`${id}: intent is required for non-terminal executable nodes`);
  if (node.when || node.unless) errors.push(`${id}: when/unless predicates are not supported by this reference runner yet`);
  if (node.params && node.action !== 'call') errors.push(`${id}: params is reserved for call nodes in Recipe v1`);
  if (!lifecycle && node.action !== 'end' && node.action !== 'switch' && !node.next) errors.push(`${id}: next is required for non-terminal nodes`);
  if (node.action === 'end' && !['pass', 'fail', 'unknown'].includes(node.status || '')) errors.push(`${id}: end.status must be pass, fail, or unknown`);
  if (!lifecycle && node.next && !nodes[node.next]) errors.push(`${id}: next target not found: ${node.next}`);
  return errors;
}

function validateRecipe(recipe, manifest) {
  const { errors: manifestErrors, declared } = validateManifest(manifest);
  const workflow = recipe.validate?.workflow;
  const nodes = workflow?.nodes || {};
  const recipeErrors = [
    ...(recipe.schema_version === 1 ? [] : ['schema_version must be 1']),
    ...(recipe.title ? [] : ['title is required']),
    ...(recipe.description ? [] : ['description is required']),
    ...(recipe.startState ? ['startState/call flow execution is not supported by this reference runner yet'] : []),
    ...(recipe.uses ? ['uses/call flow catalogs are not supported by this reference runner yet'] : []),
    ...(workflow?.entry ? [] : ['validate.workflow.entry is required']),
    ...(!workflow?.nodes || typeof workflow.nodes !== 'object' || Array.isArray(workflow.nodes)
      ? ['validate.workflow.nodes is required']
      : []),
    ...(workflow?.pre_conditions?.length ? ['pre_conditions are not supported by this reference runner yet'] : []),
    ...(workflow?.entry && !nodes[workflow.entry] ? [`entry node not found: ${workflow.entry}`] : []),
    ...validateLifecycleArray(workflow?.setup, 'validate.workflow.setup', declared),
    ...validateLifecycleArray(workflow?.teardown, 'validate.workflow.teardown', declared),
    ...Object.entries(nodes).flatMap(([id, node]) => validateNode(id, node, nodes, declared)),
  ];
  return [...manifestErrors, ...recipeErrors];
}
function relativeArtifactPath(absolutePath, artifactsDir) {
  return path.relative(artifactsDir, absolutePath).split(path.sep).join('/');
}

function copyArtifactIntoRun(ctx, sourcePath, type, { nodeId, proofTarget, label, mimeType, category = 'evidence' } = {}) {
  const source = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(APP_ROOT, sourcePath);
  if (!fs.existsSync(source)) throw new Error(`Artifact source does not exist: ${sourcePath}`);
  const subdir = type === 'screenshot' ? 'screenshots' : 'artifacts';
  const dest = path.join(ctx.artifactsDir, subdir, path.basename(source));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
  ctx.artifacts.push({ path: relativeArtifactPath(dest, ctx.artifactsDir), type, category, label, nodeId, proofTarget, mimeType, createdAt: new Date().toISOString() });
}

function addPackageArtifact(ctx, fileName, type, label) {
  ctx.artifacts.push({ path: fileName, type, category: 'system', label, createdAt: new Date().toISOString() });
}

function assertCdpTarget(output, ctx) {
  const devices = Array.isArray(output?.devices) ? output.devices : [];
  if (devices.length === 0) throw new Error('cdp.target found no ready agentic devices');
  if (!ctx.device) return;
  const filter = ctx.device.toLowerCase();
  const matching = devices.filter((device) => [device.deviceName, device.name, device.platform, device.serial]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(filter)));
  if (matching.length === 0) throw new Error(`cdp.target found devices, but none matched --device ${ctx.device}: ${JSON.stringify(devices)}`);
}

async function pollLastResult(ctx, expectedOp, timeoutMs, previousResult, options = {}) {
  const deadline = Date.now() + timeoutMs;
  const previousSerialized = previousResult == null ? '' : JSON.stringify(previousResult);
  const acceptSameFinalResult = options.acceptSameFinalResult === true;
  let last = null;
  while (Date.now() < deadline) {
    const result = cdp(['eval', `(() => { const bridge = globalThis.__AGENTIC__; if (typeof bridge?.getLastResult !== 'function') throw new Error('getLastResult unsupported by this target'); return bridge.getLastResult(); })()`], ctx, { timeoutMs: 10000 }).parsed;
    last = result;
    const isFresh = previousSerialized === '' || JSON.stringify(result) !== previousSerialized;
    if ((isFresh || acceptSameFinalResult) && result && typeof result === 'object' && result.status && result.status !== 'pending') {
      if (expectedOp && result.op && result.op !== expectedOp) throw new Error(`Unexpected async result op: expected ${expectedOp}, got ${result.op}`);
      if (result.status === 'error') throw new Error(result.error || `${expectedOp} failed`);
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${expectedOp}; last=${JSON.stringify(last)}`);
}

function requireNativeTarget(ctx, action) {
  if (!ctx.device || ctx.device.toLowerCase() === 'web') {
    throw new Error(`${action} requires a native target; pass --device with an Android/iOS device name`);
  }
}

function startNativeProbe(ctx, methodName) {
  const expression = `(() => { const bridge = globalThis.__AGENTIC__; const fn = bridge?.${methodName}; const getLastResult = bridge?.getLastResult; if (typeof fn !== 'function') throw new Error('${methodName} unsupported by this target'); if (typeof getLastResult !== 'function') throw new Error('getLastResult unsupported by this target'); const previous = getLastResult.call(bridge); const started = fn.call(bridge); return { ok: true, previous, started }; })()`;
  return cdp(['eval', expression], ctx, { timeoutMs: 10000 }).parsed;
}

function hudPayload(id, node, status, error) {
  return {
    id,
    status,
    intent: node.intent || node.description || id,
    detail: node.detail || node.description || '',
    error,
  };
}

function publishHud(ctx, id, node, status, error) {
  if (ctx.dryRun || !ctx.declaredActions.has('app.hud')) return null;
  const payload = hudPayload(id, node, status, error);
  const command = { command: 'hud', nodeId: id, payload };
  const legacyStep = { ...payload, nodeId: id };
  const expression = `(async () => {
    const farmslotBridge = globalThis.__FARMSLOT_RECIPE_BRIDGE__;
    if (typeof farmslotBridge?.handleCommand === 'function') {
      return await farmslotBridge.handleCommand(${JSON.stringify(command)});
    }
    const agenticBridge = globalThis.__AGENTIC__;
    if (typeof agenticBridge?.setStepHud === 'function') {
      return agenticBridge.setStepHud(${JSON.stringify(legacyStep)});
    }
    return { ok: false, supported: false };
  })()`;
  return cdp(['eval', expression], ctx, { timeoutMs: 10000 }).parsed;
}

function publishHudBestEffort(ctx, id, node, status, error) {
  try {
    return publishHud(ctx, id, node, status, error);
  } catch (hudError) {
    const rawMessage = hudError instanceof Error ? hudError.message : String(hudError);
    const message = rawMessage.split('\n').find((line) => line.includes('ERROR:')) || rawMessage;
    process.stderr.write(`[recipe-v1] app.hud ${status} update failed for ${id}: ${message}\n`);
    return null;
  }
}

async function executeNode(id, rawNode, ctx) {
  const node = interpolate(rawNode, ctx);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  if (ctx.dryRun) {
    const output = { dryRun: true, action: node.action, intent: node.intent || '', description: node.description || '' };
    ctx.outputs[id] = output;
    const endedAtMs = Date.now();
    ctx.trace.push({ nodeId: id, action: node.action, ok: true, status: 'skipped', dryRun: true, startedAt, endedAt: new Date(endedAtMs).toISOString(), durationMs: endedAtMs - startedAtMs, next: node.next, intent: node.intent || '', description: node.description || '', output });
    return { next: node.next, terminal: node.action === 'end', status: node.status || 'unknown' };
  }
  try {
    let output;
    if (node.action !== 'app.hud' && node.action !== 'end' && node.action !== 'cdp.target') {
      publishHudBestEffort(ctx, id, node, 'running');
    }
    switch (node.action) {
      case 'cdp.target':
        output = cdp(['list-devices'], ctx).parsed;
        assertCdpTarget(output, ctx);
        break;
      case 'app.status': output = cdp(['get-state'], ctx).parsed; break;
      case 'app.hud': {
        output = publishHud(ctx, id, node, node.status || 'running');
        if (output?.supported === false || output?.ok === false) throw new Error(`app.hud failed: ${JSON.stringify(output)}`);
        break;
      }
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
        for (const shot of screenshots) {
          if (shot.screenshot) copyArtifactIntoRun(ctx, shot.screenshot, 'screenshot', { nodeId: id, proofTarget: node.proofTarget, label: node.label || id, mimeType: 'image/png' });
        }
        break;
      }
      case 'wait': await new Promise((resolve) => setTimeout(resolve, Number(node.duration_ms || 1000))); output = { waitedMs: Number(node.duration_ms || 1000) }; break;
      case 'audiolab.audio.state': output = cdp(['get-state'], ctx).parsed; break;
      case 'audiolab.native.extract_preview': {
        requireNativeTarget(ctx, node.action);
        const start = startNativeProbe(ctx, 'testExtractPreview');
        await new Promise((resolve) => setTimeout(resolve, Number(node.poll_settle_ms || 1500)));
        output = await pollLastResult(ctx, 'extractPreview', node.timeout_ms || 30000, start.previous, { acceptSameFinalResult: start.started?.status === 'pending' });
        break;
      }
      case 'audiolab.native.extract_audio_data': {
        requireNativeTarget(ctx, node.action);
        const start = startNativeProbe(ctx, 'testExtractAudioData');
        await new Promise((resolve) => setTimeout(resolve, Number(node.poll_settle_ms || 1500)));
        output = await pollLastResult(ctx, 'extractAudioData', node.timeout_ms || 30000, start.previous, { acceptSameFinalResult: start.started?.status === 'pending' });
        break;
      }
      case 'audiolab.native.trim_audio': {
        requireNativeTarget(ctx, node.action);
        const start = startNativeProbe(ctx, 'testTrimAudio');
        await new Promise((resolve) => setTimeout(resolve, Number(node.poll_settle_ms || 1500)));
        output = await pollLastResult(ctx, 'trimAudio', node.timeout_ms || 45000, start.previous, { acceptSameFinalResult: start.started?.status === 'pending' });
        break;
      }
      case 'audiolab.asr.last_result': output = cdp(['eval', `(() => { const bridge = globalThis.__AGENTIC__; if (typeof bridge?.getLastResult !== 'function') throw new Error('getLastResult unsupported by this target'); return bridge.getLastResult(); })()`], ctx).parsed; break;
      case 'end': output = { status: node.status || 'pass' }; break;
      default: throw new Error(`Unsupported action: ${node.action}`);
    }
    assertValue(output, node.assert);
    ctx.outputs[id] = output;
    const endedAtMs = Date.now();
    ctx.trace.push({ nodeId: id, action: node.action, ok: true, startedAt, endedAt: new Date(endedAtMs).toISOString(), durationMs: endedAtMs - startedAtMs, next: node.next, intent: node.intent || '', description: node.description || '', output });
    if (node.action !== 'app.hud' && node.action !== 'end' && node.action !== 'cdp.target') {
      publishHudBestEffort(ctx, id, node, 'pass');
    }
    return { next: node.next, terminal: node.action === 'end', status: node.status || 'pass' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.outputs[id] = { error: message };
    const endedAtMs = Date.now();
    ctx.trace.push({ nodeId: id, action: node.action, ok: false, startedAt, endedAt: new Date(endedAtMs).toISOString(), durationMs: endedAtMs - startedAtMs, next: node.next, intent: node.intent || '', description: node.description || '', error: message });
    if (node.action !== 'app.hud' && node.action !== 'cdp.target') {
      publishHudBestEffort(ctx, id, node, 'fail', message);
    }
    throw error;
  }
}

async function executeOrdered(nodes, phase, ctx) {
  if (!Array.isArray(nodes)) return;
  for (let index = 0; index < nodes.length; index += 1) {
    await executeNode(`${phase}[${index}]`, nodes[index], ctx);
  }
}

async function runRecipe(recipePath, options) {
  const recipe = readJson(recipePath);
  const manifest = readJson(MANIFEST_PATH);
  const validationErrors = validateRecipe(recipe, manifest);
  if (validationErrors.length) throw new Error(`Recipe validation failed:\n- ${validationErrors.join('\n- ')}`);
  const artifactsDir = path.resolve(options.artifactsDir || path.join(DEFAULT_ARTIFACT_ROOT, `${nowStamp()}-${slug(path.basename(recipePath, path.extname(recipePath)))}`));
  fs.mkdirSync(artifactsDir, { recursive: true });
  const { declared } = validateManifest(manifest);
  const ctx = { device: options.device, dryRun: options.dryRun, artifactsDir, trace: [], outputs: {}, artifacts: [], declaredActions: declared };
  const runStartedAt = new Date().toISOString();
  let status = 'pass';
  let errorMessage = '';
  try {
    await executeOrdered(recipe.validate.workflow.setup, 'setup', ctx);
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
  } finally {
    try {
      await executeOrdered(recipe.validate.workflow.teardown, 'teardown', ctx);
    } catch (error) {
      status = 'fail';
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  const passed = ctx.trace.filter((entry) => entry.ok === true).length;
  const failed = ctx.trace.filter((entry) => entry.ok === false).length;
  const summary = {
    schema_version: 1,
    runner: `${APP_NAME}-recipe-v1-reference`,
    recipe: { path: path.relative(APP_ROOT, recipePath), title: recipe.title, description: recipe.description },
    status,
    passed,
    failed,
    dryRun: options.dryRun,
    startedAt: runStartedAt,
    endedAt: new Date().toISOString(),
    nodeCount: ctx.trace.length,
    error: errorMessage || undefined,
    artifactsDir,
  };

  writeJson(path.join(artifactsDir, 'recipe.json'), recipe);
  writeJson(path.join(artifactsDir, 'summary.json'), summary);
  writeJson(path.join(artifactsDir, 'trace.json'), ctx.trace);
  addPackageArtifact(ctx, 'recipe.json', 'recipe', 'Executed recipe');
  addPackageArtifact(ctx, 'summary.json', 'summary', 'Run summary');
  addPackageArtifact(ctx, 'trace.json', 'trace', 'Run trace');
  const artifactManifest = { version: 1, runStatus: status, artifacts: ctx.artifacts };
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
  const errors = validateRecipe(readJson(recipePath), readJson(MANIFEST_PATH));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ ok: true, recipe: path.relative(APP_ROOT, recipePath) }, null, 2));
} else if (options.command === 'run') {
  if (!options.recipeArg) throw new Error('run requires a recipe path');
  await runRecipe(path.resolve(APP_ROOT, options.recipeArg), options);
} else {
  throw new Error(`Unknown command: ${options.command}`);
}
