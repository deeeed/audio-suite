#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');

const { checkAssert, evaluateAssert, parseRaw } = require('./lib/assert');
const {
  comparePngFiles,
  ensureParentDir,
  sanitizeFileSegment,
} = require('./lib/screenshot');
const {
  EXECUTABLE_ACTIONS,
  deepClone,
  normalizeWorkflowDocument,
  renderWorkflowMermaid,
} = require('./lib/workflow');
const {
  getAppRoot,
  getTeamsDir,
  inferTeamFromPath,
  listEvalRefs,
  loadAgenticConfig,
  loadPreConditionRegistry,
  parsePreConditionSpec,
  renderTemplate,
  renderTemplateString,
  resolveEvalRef,
  resolveFlowRef,
} = require('./lib/catalog');

const DEFAULT_MATRIX_PLATFORMS = ['ios', 'android', 'web'];
const DEFAULT_LOG_LINES = 400;

function timestampSlug() {
  return new Date()
    .toISOString()
    .replaceAll(/[:.]/g, '-')
    .replaceAll('T', '_')
    .slice(0, 19);
}

function parseArgs(argv) {
  const options = {
    artifactsDir: '',
    dryRun: false,
    hud: true,
    matrix: '',
    recipe: '',
    singleStep: '',
    skipManual: false,
    updateBaselines: false,
    device: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--artifacts-dir':
        options.artifactsDir = argv[i + 1] || '';
        i += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--matrix': {
        const next = argv[i + 1] || '';
        if (next && !next.startsWith('-')) {
          options.matrix = next;
          i += 1;
        } else {
          options.matrix = DEFAULT_MATRIX_PLATFORMS.join(',');
        }
        break;
      }
      case '--no-hud':
        options.hud = false;
        break;
      case '--skip-manual':
        options.skipManual = true;
        break;
      case '--step':
        options.singleStep = argv[i + 1] || '';
        i += 1;
        break;
      case '--device':
        options.device = argv[i + 1] || '';
        i += 1;
        break;
      case '--update-baselines':
        options.updateBaselines = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown flag: ${arg}`);
        }
        if (options.recipe) {
          throw new Error(`Unexpected extra argument: ${arg}`);
        }
        options.recipe = arg;
        break;
    }
  }

  if (!options.recipe) {
    printHelp();
    process.exit(1);
  }

  if (options.device === 'all' && !options.matrix) {
    options.matrix = DEFAULT_MATRIX_PLATFORMS.join(',');
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  validate-recipe.sh <workflow-folder-or-json>
    [--device <name>]
    [--matrix [ios,android,web]]
    [--step <id>]
    [--skip-manual]
    [--no-hud]
    [--update-baselines]
    [--artifacts-dir <path>]
    [--dry-run]

The runner executes app-local workflow files stored under:
  <app>/scripts/agentic/teams/<team>/{flows,recipes,evals,pre-conditions.js}

Runtime features:
  - HUD is enabled by default during live execution. Use --no-hud to disable it.
  - --matrix runs the same recipe sequentially on ios/android/web and prints one summary.
  - Scenarios use validate.workflow with explicit nodes, transitions, switch branches, and end nodes.
  - setup / teardown hooks live under validate.workflow.setup / validate.workflow.teardown.
  - failures automatically capture screenshots, route/state snapshots, eval refs, and recent logs.
  - successful live runs also emit workflow.json, workflow.mmd, and trace.json artifacts.
  - screenshot steps can assert against a baseline image and refresh it with --update-baselines.`);
}

function resolveRecipeInput(appRoot, inputPath) {
  const absolute = path.resolve(inputPath);
  if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
    const recipeFile = path.join(absolute, 'recipe.json');
    if (!fs.existsSync(recipeFile)) {
      throw new Error(`recipe.json not found in directory: ${absolute}`);
    }
    return {
      inputPath: absolute,
      recipePath: recipeFile,
      recipeDir: absolute,
    };
  }

  if (!fs.existsSync(absolute)) {
    throw new Error(`Recipe not found: ${inputPath}`);
  }

  return {
    inputPath: absolute,
    recipePath: absolute,
    recipeDir: path.dirname(absolute),
  };
}

function collectDefaultInputs(document) {
  return Object.fromEntries(
    Object.entries(document.inputs || {})
      .filter(([, value]) => value && Object.prototype.hasOwnProperty.call(value, 'default'))
      .map(([key, value]) => [key, value.default])
  );
}

function renderDocument(recipePath, inputParams = {}) {
  const source = fs.readFileSync(recipePath, 'utf8');
  const parsed = JSON.parse(source);
  const defaults = collectDefaultInputs(parsed);
  const params = { ...defaults, ...inputParams };

  let rendered = renderTemplateString(source, params);
  rendered = rendered.replace(/\{\{[^|}]+\|([^}]+)\}\}/g, '$1');

  if (/\{\{[^}]+\}\}/.test(rendered)) {
    throw new Error(
      `Unresolved template values remain in ${recipePath}. Provide inputs or defaults for every {{param}} token.`
    );
  }

  return {
    document: JSON.parse(rendered),
    params,
  };
}

function formatResultPreview(result) {
  if (result == null) {
    return '';
  }

  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function rawResultString(result) {
  if (typeof result === 'string') {
    return result;
  }
  return JSON.stringify(result);
}

function spawnBridge(appRoot, bridgeArgs, options = {}) {
  const bridgePath = path.join(appRoot, '..', '..', 'scripts', 'agentic', 'cdp-bridge.mjs');
  const absoluteBridgePath = path.resolve(appRoot, '../../scripts/agentic/cdp-bridge.mjs');
  const finalBridgePath = fs.existsSync(absoluteBridgePath) ? absoluteBridgePath : bridgePath;

  const args = [finalBridgePath];
  if (options.device) {
    args.push('--device', options.device);
  }
  args.push(...bridgeArgs);

  const result = spawnSync('node', args, {
    cwd: appRoot,
    env: {
      ...process.env,
      APP_ROOT: appRoot,
    },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Bridge command failed').trim());
  }

  const stdout = (result.stdout || '').trim();
  if (!stdout) {
    return '';
  }

  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}

function trySpawnBridge(appRoot, bridgeArgs, options = {}) {
  try {
    return {
      ok: true,
      result: spawnBridge(appRoot, bridgeArgs, options),
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error.message || error),
    };
  }
}

let hudWarningPrinted = false;

function publishHudStep(appRoot, step, options = {}) {
  if (options.hud === false) {
    return;
  }

  try {
    spawnBridge(appRoot, ['set-step-hud', JSON.stringify(step)], {
      device: options.device,
    });
  } catch (error) {
    if (!hudWarningPrinted) {
      hudWarningPrinted = true;
      console.warn(`HUD warning: ${String(error.message || error)}`);
    }
  }
}

function clearHudStep(appRoot, options = {}) {
  if (options.hud === false) {
    return;
  }

  try {
    spawnBridge(appRoot, ['clear-step-hud'], {
      device: options.device,
    });
  } catch (error) {
    if (!hudWarningPrinted) {
      hudWarningPrinted = true;
      console.warn(`HUD warning: ${String(error.message || error)}`);
    }
  }
}

function readRecentLines(filePath, maxLines = DEFAULT_LOG_LINES) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs.readFileSync(filePath, 'utf8').split('\n').slice(-maxLines);
}

function scanLog(step, metroLogPath) {
  const recentLines = readRecentLines(metroLogPath, 500);
  const mustNotAppear = step.must_not_appear || [];
  const watchFor = step.watch_for || [];

  const mustNotFound = mustNotAppear.filter((needle) =>
    recentLines.some((line) => line.toLowerCase().includes(String(needle).toLowerCase()))
  );
  const watchCounts = Object.fromEntries(
    watchFor.map((needle) => [
      needle,
      recentLines.filter((line) =>
        line.toLowerCase().includes(String(needle).toLowerCase())
      ).length,
    ])
  );

  return {
    pass: mustNotFound.length === 0,
    must_not_found: mustNotFound,
    watch_counts: watchCounts,
  };
}

function describeStep(step) {
  if (step.description) {
    return step.description;
  }

  switch (step.action) {
    case 'navigate':
      return `navigate to ${step.target}`;
    case 'wait':
      return `wait ${step.ms || 1000}ms`;
    case 'wait_for':
      return `wait for ${step.test_id || step.route || step.not_route || 'condition'}`;
    case 'press':
      return typeof step.value === 'boolean'
        ? `set ${step.test_id} to ${step.value}`
        : `press ${step.test_id}`;
    case 'scroll':
      return `scroll ${step.test_id || 'first scrollable view'}`;
    case 'set_input':
      return `set ${step.test_id}`;
    case 'screenshot':
      return `capture screenshot ${step.id || step.filename || ''}`.trim();
    case 'call':
      return `call ${step.ref}`;
    case 'eval_ref':
      return `eval ref ${step.ref}`;
    case 'eval_sync':
    case 'eval_async':
      return step.action;
    case 'switch':
      return step.description || 'evaluate branch';
    case 'end':
      return `${step.status || 'pass'} end`;
    default:
      return step.action;
  }
}

async function promptManual(note) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  if (note) {
    console.log(`  note: ${note}`);
  }

  const answer = await new Promise((resolve) => {
    rl.question('  Press ENTER when done, or type "s" to skip: ', resolve);
  });
  rl.close();
  return String(answer || '').trim().toLowerCase() !== 's';
}

function buildWaitForSpec(step) {
  if (step.route) {
    return {
      expression: 'JSON.stringify(globalThis.__AGENTIC__?.getRoute() || null)',
      assert: { operator: 'eq', field: 'pathname', value: step.route },
      failWhen: step.fail_when || null,
      label: `route=${step.route}`,
      async: false,
    };
  }

  if (step.not_route) {
    return {
      expression: 'JSON.stringify(globalThis.__AGENTIC__?.getRoute() || null)',
      assert: { operator: 'neq', field: 'pathname', value: step.not_route },
      failWhen: step.fail_when || null,
      label: `not_route=${step.not_route}`,
      async: false,
    };
  }

  if (step.test_id) {
    return {
      expression: `JSON.stringify({ visible: !!globalThis.__AGENTIC__?.findFiberByTestId?.(${JSON.stringify(
        step.test_id
      )}) })`,
      assert: {
        operator: 'eq',
        field: 'visible',
        value: step.visible !== false,
      },
      failWhen: step.fail_when || null,
      label: `test_id=${step.test_id}`,
      async: false,
    };
  }

  return {
    expression: step.expression || '',
    assert: step.assert || null,
    failWhen: step.fail_when || null,
    label: 'expression',
    async: step.async === true || String(step.expression || '').includes('.then('),
  };
}

async function waitForCondition(step, appRoot, options) {
  const waitSpec = buildWaitForSpec(step);
  const timeoutMs = Number(step.timeout_ms || 10000);
  const pollMs = Number(step.poll_ms || 500);
  const deadline = Date.now() + timeoutMs;
  let lastResult = '';

  while (Date.now() < deadline) {
    try {
      const bridgeResult = spawnBridge(
        appRoot,
        [waitSpec.async ? 'eval-async' : 'eval', waitSpec.expression],
        { device: options.device }
      );
      lastResult = rawResultString(bridgeResult);
      if (waitSpec.failWhen && checkAssert(lastResult, waitSpec.failWhen)) {
        return {
          ok: false,
          immediateFailure: true,
          result: bridgeResult,
          label: waitSpec.label,
        };
      }
      if (checkAssert(lastResult, waitSpec.assert)) {
        return {
          ok: true,
          result: bridgeResult,
          label: waitSpec.label,
        };
      }
    } catch (error) {
      lastResult = String(error.message || error);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return {
    ok: false,
    result: lastResult,
    label: waitSpec.label,
  };
}

function evaluatePreConditions(document, appRoot, options = {}) {
  const registry = loadPreConditionRegistry(appRoot);
  const normalized = normalizeWorkflowDocument(document);
  const preConditions = normalized.hooks.pre_conditions || [];
  const failures = [];
  const passed = [];

  preConditions.forEach((spec) => {
    const parsed = parsePreConditionSpec(spec);
    const name = typeof parsed === 'string' ? parsed : parsed?.name;
    const params =
      typeof parsed === 'string'
        ? {}
        : Object.fromEntries(
            Object.entries(parsed).filter(([key]) => key !== 'name')
          );

    const entry = registry[name];
    if (!entry) {
      failures.push({
        name,
        error: `Unknown pre-condition "${name}"`,
      });
      return;
    }

    const expression =
      typeof entry.expression === 'function'
        ? entry.expression(params)
        : renderTemplate(entry.expression, params);
    const assertSpec = renderTemplate(entry.assert, params);

    try {
      const bridgeResult = spawnBridge(
        appRoot,
        [entry.async ? 'eval-async' : 'eval', expression],
        { device: options.device }
      );
      const raw = rawResultString(bridgeResult);
      if (checkAssert(raw, assertSpec)) {
        passed.push(name);
        return;
      }

      failures.push({
        name,
        description: entry.description || '',
        got: formatResultPreview(bridgeResult),
        hint: entry.hint || '',
      });
    } catch (error) {
      failures.push({
        name,
        description: entry.description || '',
        error: String(error.message || error),
        hint: entry.hint || '',
      });
    }
  });

  return {
    ok: failures.length === 0,
    passed,
    failures,
  };
}

function ensureExecutionState(runOptions) {
  if (!runOptions.executionState) {
    runOptions.executionState = {
      artifacts: null,
      failureArtifacts: [],
      referencedEvalRefs: new Set(),
    };
  }
  return runOptions.executionState;
}

function ensureRunArtifacts(runOptions, recipePath) {
  const state = ensureExecutionState(runOptions);
  if (state.artifacts || runOptions.dryRun) {
    return state.artifacts;
  }

  const baseDir =
    runOptions.artifactsDir ||
    path.join(runOptions.appRoot, '.agent', 'recipe-runs');
  const recipeLabel = sanitizeFileSegment(path.basename(recipePath, path.extname(recipePath)));
  const targetLabel = sanitizeFileSegment(
    runOptions.device || runOptions.matrixPlatform || 'default'
  );
  const rootDir = path.resolve(
    runOptions.artifactRunDir ||
      path.join(baseDir, `${timestampSlug()}_${recipeLabel}_${targetLabel}`)
  );

  const artifacts = {
    rootDir,
    screenshotsDir: path.join(rootDir, 'screenshots'),
    diffsDir: path.join(rootDir, 'diffs'),
    failuresDir: path.join(rootDir, 'failures'),
    logsDir: path.join(rootDir, 'logs'),
    tracePath: path.join(rootDir, 'trace.json'),
    workflowPath: path.join(rootDir, 'workflow.json'),
    workflowMermaidPath: path.join(rootDir, 'workflow.mmd'),
    summaryPath: path.join(rootDir, 'summary.json'),
  };

  [
    artifacts.rootDir,
    artifacts.screenshotsDir,
    artifacts.diffsDir,
    artifacts.failuresDir,
    artifacts.logsDir,
  ].forEach((dirPath) => fs.mkdirSync(dirPath, { recursive: true }));

  state.artifacts = artifacts;
  return artifacts;
}

function writeRunSummary(runOptions, summary) {
  const state = ensureExecutionState(runOptions);
  if (!state.artifacts) {
    return;
  }

  fs.writeFileSync(state.artifacts.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
}

function serializeExecutionContext(executionContext) {
  if (!executionContext) {
    return null;
  }

  return {
    env: deepClone(executionContext.env || {}),
    inputs: deepClone(executionContext.inputs || {}),
    last: deepClone(executionContext.last ?? null),
    nodes: deepClone(executionContext.nodes || {}),
    trace: deepClone(executionContext.trace || []),
    vars: deepClone(executionContext.vars || {}),
  };
}

function writeWorkflowArtifacts(context) {
  if (context.runOptions.dryRun || context.depth !== 0) {
    return;
  }

  const artifacts = ensureRunArtifacts(context.runOptions, context.recipePath);
  if (!artifacts) {
    return;
  }

  fs.writeFileSync(
    artifacts.workflowPath,
    `${JSON.stringify(
      {
        title: context.normalizedDocument.title || '',
        description: context.normalizedDocument.description || '',
        sourcePath: context.normalizedDocument.sourcePath,
        hooks: context.hooks,
        workflow: context.workflow,
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    artifacts.workflowMermaidPath,
    renderWorkflowMermaid(context.normalizedDocument)
  );
}

function writeTraceArtifacts(context) {
  if (context.runOptions.dryRun || context.depth !== 0) {
    return;
  }

  const artifacts = ensureRunArtifacts(context.runOptions, context.recipePath);
  if (!artifacts) {
    return;
  }

  fs.writeFileSync(
    artifacts.tracePath,
    `${JSON.stringify(serializeExecutionContext(context.executionContext), null, 2)}\n`
  );
}

function resolveScenarioPath(inputPath, recipeDir, appRoot) {
  if (!inputPath) {
    return '';
  }
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(recipeDir || appRoot, inputPath);
}

function copyIntoDir(sourcePath, targetDir) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return '';
  }

  const destination = path.join(targetDir, path.basename(sourcePath));
  if (path.resolve(destination) !== path.resolve(sourcePath)) {
    ensureParentDir(destination);
    fs.copyFileSync(sourcePath, destination);
  }
  return path.resolve(destination);
}

function trackEvalRef(runOptions, ref) {
  ensureExecutionState(runOptions).referencedEvalRefs.add(ref);
}

function collectRelevantEvalRefs(step, appRoot, defaultTeam, runOptions) {
  const refs = Array.from(ensureExecutionState(runOptions).referencedEvalRefs);
  if (step?.action === 'eval_ref' && step.ref) {
    try {
      const resolved = resolveEvalRef(step.ref, {
        appRoot,
        defaultTeam,
      });
      if (!refs.includes(resolved.ref)) {
        refs.push(resolved.ref);
      }
    } catch {
      // Ignore ref resolution failures while collecting diagnostics.
    }
  }

  return refs.slice(-8);
}

function snapshotEvalRefs(appRoot, refs, runOptions) {
  const snapshots = {};
  refs.forEach((ref) => {
    const response = trySpawnBridge(appRoot, ['eval-ref', ref], {
      device: runOptions.device,
    });
    snapshots[ref] = response.ok ? response.result : { error: response.error };
  });
  return snapshots;
}

function captureRecentLogs(appRoot, targetDir) {
  const logs = [
    path.join(appRoot, '.agent', 'metro.log'),
    path.join(appRoot, '.agent', 'web-browser.log'),
  ];

  const captured = [];
  logs.forEach((logPath) => {
    if (!fs.existsSync(logPath)) {
      return;
    }

    const filename = sanitizeFileSegment(path.basename(logPath));
    const destination = path.join(targetDir, filename);
    const excerpt = readRecentLines(logPath, DEFAULT_LOG_LINES).join('\n');
    fs.writeFileSync(destination, `${excerpt}\n`);
    captured.push({
      source: path.resolve(logPath),
      excerpt: path.resolve(destination),
    });
  });

  return captured;
}

function captureFailureArtifacts(context) {
  const {
    appRoot,
    runOptions,
    recipePath,
    document,
    normalizedDocument,
    defaultTeam,
    step,
    depth,
    error,
    executionContext,
  } = context;

  const artifacts = ensureRunArtifacts(runOptions, recipePath);
  if (!artifacts) {
    return null;
  }

  const state = ensureExecutionState(runOptions);
  const failureIndex = state.failureArtifacts.length + 1;
  const failureLabel = sanitizeFileSegment(step?.id || step?.action || 'failure');
  const failureDir = path.join(
    artifacts.failuresDir,
    `${String(failureIndex).padStart(2, '0')}_${failureLabel}`
  );
  fs.mkdirSync(failureDir, { recursive: true });

  const route = trySpawnBridge(appRoot, ['get-route'], {
    device: runOptions.device,
  });
  const currentState = trySpawnBridge(appRoot, ['get-state'], {
    device: runOptions.device,
  });

  const screenshotResponse = trySpawnBridge(
    appRoot,
    ['screenshot', `failure-${failureLabel}`],
    {
      device: runOptions.device,
    }
  );
  const screenshotPath =
    screenshotResponse.ok && screenshotResponse.result?.screenshot
      ? copyIntoDir(screenshotResponse.result.screenshot, failureDir)
      : '';

  const evalRefs = snapshotEvalRefs(
    appRoot,
    collectRelevantEvalRefs(step, appRoot, defaultTeam, runOptions),
    runOptions
  );
  const logs = captureRecentLogs(appRoot, failureDir);

  const payload = {
    capturedAt: new Date().toISOString(),
    depth,
    device: runOptions.device || '',
    platform: runOptions.matrixPlatform || '',
    recipePath,
    recipeTitle: document.title || '',
    step: step || null,
    error: String(error.message || error),
    route: route.ok ? route.result : { error: route.error },
    state: currentState.ok ? currentState.result : { error: currentState.error },
    workflowState: serializeExecutionContext(executionContext),
    evalRefs,
    logs,
    screenshot: screenshotPath,
  };

  const payloadPath = path.join(failureDir, 'failure.json');
  fs.writeFileSync(payloadPath, `${JSON.stringify(payload, null, 2)}\n`);

  const record = {
    dir: failureDir,
    details: payloadPath,
    stepId: step?.id || '',
    error: payload.error,
  };
  state.failureArtifacts.push(record);
  return record;
}

function buildInteractionFailureMessage(step, result) {
  if (result && typeof result === 'object' && result.ok === false) {
    return result.error || `${step.action} returned ok=false`;
  }
  return '';
}

async function handleScreenshotStep(step, context) {
  const {
    appRoot,
    recipeDir,
    recipePath,
    runOptions,
  } = context;

  const artifacts = ensureRunArtifacts(runOptions, recipePath);
  const label = sanitizeFileSegment(step.filename || step.id || 'recipe');
  const result = spawnBridge(appRoot, ['screenshot', label], {
    device: runOptions.device,
  });
  const sourcePath = result?.screenshot || '';
  let actualPath = sourcePath;

  if (sourcePath && artifacts) {
    actualPath = copyIntoDir(sourcePath, artifacts.screenshotsDir) || sourcePath;
  }

  if (sourcePath && recipeDir) {
    const destination = path.join(recipeDir, path.basename(sourcePath));
    if (path.resolve(destination) !== path.resolve(sourcePath)) {
      fs.copyFileSync(sourcePath, destination);
    }
  }

  const resolved = {
    ...result,
    screenshot: actualPath || sourcePath,
  };

  if (!step.baseline) {
    return resolved;
  }

  const baselinePath = resolveScenarioPath(step.baseline, recipeDir, appRoot);
  const updateBaseline =
    runOptions.updateBaselines === true || step.update_baseline === true;

  if (!actualPath) {
    throw new Error(`Screenshot step "${step.id || label}" did not produce a screenshot`);
  }

  if (!fs.existsSync(baselinePath)) {
    if (!updateBaseline) {
      throw new Error(
        `Screenshot baseline not found for "${step.id || label}": ${baselinePath}\n` +
          'Re-run with --update-baselines to create it.'
      );
    }

    ensureParentDir(baselinePath);
    fs.copyFileSync(actualPath, baselinePath);
    return {
      ...resolved,
      comparison: {
        pass: true,
        updated: true,
        baseline: path.resolve(baselinePath),
      },
    };
  }

  if (updateBaseline) {
    ensureParentDir(baselinePath);
    fs.copyFileSync(actualPath, baselinePath);
    return {
      ...resolved,
      comparison: {
        pass: true,
        updated: true,
        baseline: path.resolve(baselinePath),
      },
    };
  }

  const diffPath = artifacts
    ? path.join(
        artifacts.diffsDir,
        `${sanitizeFileSegment(step.id || label)}.diff.png`
      )
    : '';
  const comparison = comparePngFiles({
    actualPath,
    baselinePath,
    diffPath,
    maxDiffPixels: Number(step.max_diff_pixels ?? 0),
    maxDiffRatio: Number(step.max_diff_ratio ?? 0),
    pixelThreshold: Number(step.pixel_threshold ?? 16),
  });

  const output = {
    ...resolved,
    comparison: {
      ...comparison,
      actual: path.resolve(actualPath),
      baseline: path.resolve(baselinePath),
    },
  };

  if (!comparison.pass) {
    const details = JSON.stringify(output.comparison);
    throw new Error(`Screenshot assertion failed for "${step.id || label}": ${details}`);
  }

  return output;
}

function buildRuntimeContext(recipePath, runOptions, flowParams, depth) {
  const rendered = renderDocument(recipePath, flowParams);
  const document = rendered.document;
  const resolvedInputs = rendered.params;
  const appRoot = runOptions.appRoot;
  const recipeDir = path.dirname(recipePath);
  const defaultTeam = inferTeamFromPath(recipePath, appRoot);
  const normalizedDocument = normalizeWorkflowDocument(document, {
    sourcePath: recipePath,
  });
  const stats = {
    total: 0,
    passed: 0,
    skipped: 0,
  };

  return {
    appRoot,
    defaultTeam,
    depth,
    document,
    executionContext: {
      env: {
        appRoot,
        device: runOptions.device || '',
        platform: runOptions.matrixPlatform || '',
        recipePath,
        team: defaultTeam || '',
      },
      inputs: deepClone(resolvedInputs),
      last: null,
      nodes: {},
      trace: [],
      vars: {},
    },
    hooks: normalizedDocument.hooks,
    normalizedDocument,
    recipeDir,
    recipePath,
    runOptions,
    stats,
    workflow: normalizedDocument.workflow,
    currentStepRef: {
      current: null,
    },
  };
}

function shouldCountNode(node) {
  return node.action !== 'end';
}

function shouldSkipForSingleStep(node, context, options = {}) {
  const { applySingleStep = false } = options;
  const { depth, runOptions } = context;

  return (
    applySingleStep &&
    runOptions.singleStep &&
    depth === 0 &&
    EXECUTABLE_ACTIONS.has(node.action) &&
    node.id !== runOptions.singleStep
  );
}

function buildConditionPayload(context) {
  return {
    env: context.executionContext.env,
    inputs: context.executionContext.inputs,
    last: context.executionContext.last,
    nodes: context.executionContext.nodes,
    trace: context.executionContext.trace,
    vars: context.executionContext.vars,
  };
}

function evaluateWorkflowCondition(condition, context) {
  if (!condition) {
    return true;
  }

  return evaluateAssert(buildConditionPayload(context), condition);
}

function finalizeNodeRecord(context, node, details = {}) {
  const finishedAt = new Date().toISOString();
  const entry = {
    action: node.action,
    description: describeStep(node),
    finishedAt,
    id: node.id,
    status: details.status || 'pass',
  };

  if (details.startedAt) {
    entry.startedAt = details.startedAt;
    entry.durationMs =
      new Date(finishedAt).getTime() - new Date(details.startedAt).getTime();
  }

  if (Object.prototype.hasOwnProperty.call(details, 'next')) {
    entry.next = details.next || '';
  }

  if (Object.prototype.hasOwnProperty.call(details, 'note')) {
    entry.note = details.note;
  }

  if (Object.prototype.hasOwnProperty.call(details, 'branch')) {
    entry.branch = deepClone(details.branch);
  }

  if (Object.prototype.hasOwnProperty.call(details, 'result')) {
    entry.result = deepClone(details.result);
    context.executionContext.last = deepClone(details.result);
    if (node.save_as) {
      context.executionContext.vars[node.save_as] = deepClone(details.result);
    }
  }

  context.executionContext.nodes[node.id] = entry;
  context.executionContext.trace.push(entry);
  return entry;
}

function markNodeSkipped(node, context, reason, details = {}) {
  if (shouldCountNode(node)) {
    context.stats.total += 1;
    context.stats.skipped += 1;
  }

  console.log(`[${node.id || '?'}] ${describeStep(node)}`);
  console.log(`  [SKIPPED - ${reason}]`);
  console.log('');

  finalizeNodeRecord(context, node, {
    ...details,
    note: reason,
    status: 'skipped',
  });
}

function printPassWithResult(result, prefix = 'result') {
  if (typeof result !== 'undefined') {
    console.log(`  ${prefix}: ${formatResultPreview(result)}`);
  }
  console.log('  PASS');
  console.log('');
}

async function runExecutableNode(node, context, options = {}) {
  const {
    appRoot,
    defaultTeam,
    depth,
    document,
    recipeDir,
    recipePath,
    runOptions,
    stats,
  } = context;
  const startedAt = new Date().toISOString();

  if (shouldSkipForSingleStep(node, context, options)) {
    markNodeSkipped(node, context, 'single-step mode', {
      next: node.next || '',
      startedAt,
    });
    return { next: node.next || '' };
  }

  context.currentStepRef.current = node;
  if (shouldCountNode(node)) {
    stats.total += 1;
  }
  console.log(`[${node.id || '?'}] ${describeStep(node)}`);

  if (node.when && !evaluateWorkflowCondition(node.when, context)) {
    if (shouldCountNode(node)) {
      stats.skipped += 1;
    }
    console.log('  [SKIPPED - when condition did not match]');
    console.log('');
    finalizeNodeRecord(context, node, {
      next: node.next || '',
      note: 'when condition did not match',
      startedAt,
      status: 'skipped',
    });
    context.currentStepRef.current = null;
    return { next: node.next || '' };
  }

  if (node.unless && evaluateWorkflowCondition(node.unless, context)) {
    if (shouldCountNode(node)) {
      stats.skipped += 1;
    }
    console.log('  [SKIPPED - unless condition matched]');
    console.log('');
    finalizeNodeRecord(context, node, {
      next: node.next || '',
      note: 'unless condition matched',
      startedAt,
      status: 'skipped',
    });
    context.currentStepRef.current = null;
    return { next: node.next || '' };
  }

  if (runOptions.dryRun) {
    stats.skipped += 1;
    console.log('  [DRY RUN - not executed]');
    console.log('');
    finalizeNodeRecord(context, node, {
      next: node.next || '',
      note: 'dry run',
      startedAt,
      status: 'dry_run',
    });
    context.currentStepRef.current = null;
    return { next: node.next || '' };
  }

  if (!(node.action === 'manual' && runOptions.skipManual)) {
    publishHudStep(
      appRoot,
      {
        id: String(node.id || '?'),
        action: String(node.action || ''),
        description: describeStep(node),
        recipe: document.title || '',
        depth,
      },
      runOptions
    );
  }

  if (node.action === 'manual') {
    if (runOptions.skipManual) {
      stats.skipped += 1;
      console.log('  [SKIPPED - manual step]');
      console.log('');
      finalizeNodeRecord(context, node, {
        next: node.next || '',
        note: 'manual step skipped by --skip-manual',
        startedAt,
        status: 'skipped',
      });
      context.currentStepRef.current = null;
      return { next: node.next || '' };
    }

    const accepted = await promptManual(node.note || '');
    if (!accepted) {
      stats.skipped += 1;
      console.log('  [SKIPPED]');
      finalizeNodeRecord(context, node, {
        next: node.next || '',
        note: 'manual step skipped by operator',
        result: {
          accepted: false,
          note: node.note || '',
        },
        startedAt,
        status: 'skipped',
      });
    } else {
      stats.passed += 1;
      console.log('  PASS');
      finalizeNodeRecord(context, node, {
        next: node.next || '',
        result: {
          accepted: true,
          note: node.note || '',
        },
        startedAt,
      });
    }
    console.log('');
    context.currentStepRef.current = null;
    return { next: node.next || '' };
  }

  if (node.action === 'wait') {
    const ms = Number(node.ms || 1000);
    await new Promise((resolve) => setTimeout(resolve, ms));
    stats.passed += 1;
    console.log(`  waited ${ms}ms`);
    console.log('  PASS');
    console.log('');
    finalizeNodeRecord(context, node, {
      next: node.next || '',
      result: { waitedMs: ms },
      startedAt,
    });
    context.currentStepRef.current = null;
    return { next: node.next || '' };
  }

  if (node.action === 'wait_for') {
    const waitResult = await waitForCondition(node, appRoot, runOptions);
    if (!waitResult.ok) {
      if (waitResult.immediateFailure) {
        throw new Error(
          `wait_for failed early (${waitResult.label})\n  result: ${formatResultPreview(
            waitResult.result
          )}`
        );
      }
      throw new Error(
        `wait_for timed out after ${node.timeout_ms || 10000}ms (${waitResult.label})\n  last result: ${formatResultPreview(
          waitResult.result
        )}`
      );
    }

    stats.passed += 1;
    printPassWithResult(waitResult.result);
    finalizeNodeRecord(context, node, {
      next: node.next || '',
      result: parseRaw(rawResultString(waitResult.result)),
      startedAt,
    });
    context.currentStepRef.current = null;
    return { next: node.next || '' };
  }

  if (node.action === 'log_watch') {
    const metroLogPath = process.env.METRO_LOG || path.join(appRoot, '.agent', 'metro.log');
    const result = scanLog(node, metroLogPath);
    if (!result.pass) {
      throw new Error(
        `must_not_appear strings were found: ${result.must_not_found.join(', ')}`
      );
    }
    stats.passed += 1;
    printPassWithResult(result.watch_counts, 'watch_for');
    finalizeNodeRecord(context, node, {
      next: node.next || '',
      result,
      startedAt,
    });
    context.currentStepRef.current = null;
    return { next: node.next || '' };
  }

  if (node.action === 'call') {
    const flow = resolveFlowRef(node.ref, {
      appRoot,
      defaultTeam,
    });
    const summary = await runRecipe(
      flow.filePath,
      { ...runOptions, singleStep: '' },
      node.params || {},
      depth + 1
    );
    stats.passed += 1;
    console.log(`  flow: ${flow.ref}`);
    console.log('  PASS');
    console.log('');
    finalizeNodeRecord(context, node, {
      next: node.next || '',
      result: {
        artifactDir: summary.artifactDir || '',
        counts: summary.counts,
        failures: summary.failures,
        ref: flow.ref,
        title: summary.title,
      },
      startedAt,
    });
    context.currentStepRef.current = null;
    return { next: node.next || '' };
  }

  if (node.action === 'screenshot') {
    const result = await handleScreenshotStep(node, context);
    stats.passed += 1;
    printPassWithResult(result, 'screenshot');
    finalizeNodeRecord(context, node, {
      next: node.next || '',
      result,
      startedAt,
    });
    context.currentStepRef.current = null;
    return { next: node.next || '' };
  }

  let bridgeResult;
  switch (node.action) {
    case 'navigate':
      bridgeResult = spawnBridge(appRoot, ['navigate', node.target], {
        device: runOptions.device,
      });
      break;
    case 'eval_sync':
      bridgeResult = spawnBridge(appRoot, ['eval', node.expression], {
        device: runOptions.device,
      });
      break;
    case 'eval_async':
      bridgeResult = spawnBridge(appRoot, ['eval-async', node.expression], {
        device: runOptions.device,
      });
      break;
    case 'eval_ref': {
      const evalRef = resolveEvalRef(node.ref, {
        appRoot,
        defaultTeam,
      });
      trackEvalRef(runOptions, evalRef.ref);
      bridgeResult = spawnBridge(appRoot, ['eval-ref', evalRef.ref], {
        device: runOptions.device,
      });
      break;
    }
    case 'press':
      bridgeResult = spawnBridge(
        appRoot,
        typeof node.value === 'boolean'
          ? ['press-test-id', node.test_id, '--value', String(node.value)]
          : ['press-test-id', node.test_id],
        {
        device: runOptions.device,
        }
      );
      break;
    case 'scroll': {
      const scrollArgs = ['scroll-view'];
      if (node.test_id) {
        scrollArgs.push('--test-id', node.test_id);
      }
      scrollArgs.push('--offset', String(node.offset ?? 300));
      scrollArgs.push(node.animated === true ? '--animated' : '--no-animated');
      bridgeResult = spawnBridge(appRoot, scrollArgs, {
        device: runOptions.device,
      });
      break;
    }
    case 'set_input':
      bridgeResult = spawnBridge(
        appRoot,
        ['set-input', node.test_id, String(node.value ?? '')],
        {
          device: runOptions.device,
        }
      );
      break;
    default:
      throw new Error(`Unknown action "${node.action}"`);
  }

  const failureMessage = buildInteractionFailureMessage(node, bridgeResult);
  if (failureMessage) {
    throw new Error(failureMessage);
  }

  const raw = rawResultString(bridgeResult);
  if (node.assert && !checkAssert(raw, node.assert)) {
    throw new Error(
      `Assertion failed for step "${node.id || '?'}"\n  result: ${formatResultPreview(
        parseRaw(raw)
      )}\n  assert: ${JSON.stringify(node.assert)}`
    );
  }

  stats.passed += 1;
  printPassWithResult(bridgeResult);
  finalizeNodeRecord(context, node, {
    next: node.next || '',
    result: parseRaw(raw),
    startedAt,
  });
  context.currentStepRef.current = null;
  return { next: node.next || '' };
}

async function executeSwitchNode(node, context) {
  const startedAt = new Date().toISOString();
  context.currentStepRef.current = node;
  context.stats.total += 1;
  console.log(`[${node.id || '?'}] ${describeStep(node)}`);

  const cases = Array.isArray(node.cases) ? node.cases : [];
  let selected = null;

  for (const entry of cases) {
    if (!entry.when || evaluateWorkflowCondition(entry.when, context)) {
      selected = {
        assumed: false,
        label: entry.label || '',
        next: entry.next,
      };
      break;
    }
  }

  if (!selected && context.runOptions.dryRun && cases[0]?.next) {
    selected = {
      assumed: true,
      label: cases[0].label || '',
      next: cases[0].next,
    };
  }

  if (!selected && node.default) {
    selected = {
      assumed: false,
      label: 'default',
      next: node.default,
    };
  }

  if (!selected?.next) {
    throw new Error(`Switch node "${node.id}" did not resolve a branch target`);
  }

  context.stats.passed += 1;
  const label = selected.label ? ` (${selected.label})` : '';
  if (selected.assumed) {
    console.log(`  [DRY RUN - assuming${label || ' first branch'} -> ${selected.next}]`);
  } else {
    console.log(`  branch -> ${selected.next}${label}`);
  }
  console.log('  PASS');
  console.log('');

  finalizeNodeRecord(context, node, {
    branch: selected,
    next: selected.next,
    note: selected.assumed ? 'dry run branch assumption' : '',
    startedAt,
    status: context.runOptions.dryRun ? 'dry_run' : 'pass',
  });
  context.currentStepRef.current = null;
  return {
    next: selected.next,
  };
}

async function executeEndNode(node, context) {
  context.currentStepRef.current = node;
  finalizeNodeRecord(context, node, {
    note: node.message || '',
    result: {
      message: node.message || '',
      status: node.status || 'pass',
    },
    status: node.status || 'pass',
  });

  context.currentStepRef.current = null;
  if (String(node.status || 'pass').toLowerCase() === 'fail') {
    throw new Error(node.message || `Workflow terminated at end node "${node.id}"`);
  }

  return {
    done: true,
  };
}

async function executeWorkflowNode(node, context, options = {}) {
  if (node.action === 'end') {
    return executeEndNode(node, context);
  }

  if (node.action === 'switch') {
    return executeSwitchNode(node, context);
  }

  return runExecutableNode(node, context, options);
}

async function executeLinearStepCollection(steps, context, options = {}) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return;
  }

  if (options.label) {
    console.log(`${options.label}:`);
  }

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const node = {
      ...step,
      action: String(step.action || step.type || ''),
      id: String(step.id || `${options.label || 'hook'}-${index + 1}`),
    };
    await runExecutableNode(node, context, {
      applySingleStep: false,
    });
  }
}

async function executeWorkflowGraph(context, options = {}) {
  const { workflow } = context;
  let currentNodeId = workflow.entry;
  let traversed = 0;
  const maxTraversals = Math.max(Object.keys(workflow.nodes || {}).length * 20, 20);

  while (currentNodeId) {
    traversed += 1;
    if (traversed > maxTraversals) {
      throw new Error(
        `Workflow traversal exceeded ${maxTraversals} nodes. Refusing to continue.`
      );
    }

    const node = workflow.nodes[currentNodeId];
    if (!node) {
      throw new Error(`Workflow references missing node "${currentNodeId}"`);
    }

    const resolution = await executeWorkflowNode(node, context, options);
    if (resolution?.done) {
      return;
    }

    if (!resolution?.next) {
      throw new Error(`Node "${node.id}" did not resolve a next transition`);
    }

    currentNodeId = resolution.next;
  }
}

async function runRecipe(recipePath, runOptions, flowParams = {}, depth = 0) {
  const context = buildRuntimeContext(recipePath, runOptions, flowParams, depth);
  const {
    appRoot,
    defaultTeam,
    document,
    executionContext,
    hooks,
    normalizedDocument,
    stats,
    workflow,
  } = context;
  const prefix = depth > 0 ? `${'  '.repeat(depth)}> ` : '';
  const state = ensureExecutionState(runOptions);
  let currentStep = null;
  let failureError = null;

  if (!runOptions.dryRun) {
    ensureRunArtifacts(runOptions, recipePath);
    writeWorkflowArtifacts(context);
  }

  console.log(`${prefix}Running recipe: ${document.title || 'Untitled'}`);
  if (defaultTeam) {
    console.log(`${prefix}Team: ${defaultTeam}`);
  }
  if (hooks.pre_conditions?.length) {
    console.log(`${prefix}Pre-conditions: ${hooks.pre_conditions.join(', ')}`);
  }
  if (hooks.setup?.length) {
    console.log(`${prefix}Setup: ${hooks.setup.length} step(s)`);
  }
  if (hooks.teardown?.length) {
    console.log(`${prefix}Teardown: ${hooks.teardown.length} step(s)`);
  }
  console.log(`${prefix}Workflow nodes: ${Object.keys(workflow.nodes || {}).length}`);
  console.log('');

  try {
    if (!runOptions.dryRun && hooks.pre_conditions?.length) {
      currentStep = {
        id: 'pre-conditions',
        action: 'pre_conditions',
        description: 'evaluate pre-conditions',
      };
      const preConditionsResult = evaluatePreConditions(document, appRoot, runOptions);
      if (!preConditionsResult.ok) {
        console.log('PRE-CONDITIONS FAILED');
        preConditionsResult.failures.forEach((failure) => {
          console.log(`  - ${failure.name}${failure.description ? `: ${failure.description}` : ''}`);
          if (failure.error) {
            console.log(`    error: ${failure.error}`);
          }
          if (failure.got) {
            console.log(`    got: ${failure.got}`);
          }
          if (failure.hint) {
            console.log(`    hint: ${failure.hint}`);
          }
        });
        throw new Error('Recipe pre-conditions failed');
      }

      console.log('Pre-conditions: PASS');
      console.log('');
      currentStep = null;
    }

    if (hooks.setup?.length) {
      currentStep = {
        id: 'setup',
        action: 'setup',
        description: 'run setup hooks',
      };
      await executeLinearStepCollection(hooks.setup, context, {
        label: 'Setup hooks',
      });
      currentStep = null;
    }

    await executeWorkflowGraph(context, {
      applySingleStep: true,
    });

    console.log('----------------------------------------');
    if (runOptions.dryRun) {
      console.log(`Results: ${stats.total} node(s) dry-run only`);
      console.log('Recipe: DRY RUN');
    } else {
      console.log(
        `Results: ${stats.passed}/${stats.total} passed${stats.skipped ? `, ${stats.skipped} skipped` : ''}`
      );
      console.log('Recipe: PASS');
    }
    console.log('');
  } catch (error) {
    failureError = error;
    if (!runOptions.dryRun) {
      captureFailureArtifacts({
        appRoot,
        defaultTeam,
        depth,
        document,
        error,
        executionContext,
        normalizedDocument,
        recipePath,
        runOptions,
        step: context.currentStepRef.current || currentStep,
      });
    }
    throw error;
  } finally {
    try {
      if (!runOptions.dryRun && hooks.teardown?.length) {
        currentStep = {
          id: 'teardown',
          action: 'teardown',
          description: 'run teardown hooks',
        };
        await executeLinearStepCollection(hooks.teardown, context, {
          label: 'Teardown hooks',
        });
      }
    } catch (teardownError) {
      if (!runOptions.dryRun) {
        captureFailureArtifacts({
          appRoot,
          defaultTeam,
          depth,
          document,
          error: teardownError,
          executionContext,
          normalizedDocument,
          recipePath,
          runOptions,
          step: context.currentStepRef.current || currentStep,
        });
      }
      if (!failureError) {
        throw teardownError;
      }
      console.error(`Teardown warning: ${String(teardownError.message || teardownError)}`);
    } finally {
      if (depth === 0 && !runOptions.dryRun) {
        clearHudStep(appRoot, runOptions);
        writeTraceArtifacts(context);
        writeRunSummary(runOptions, {
          status: failureError ? 'FAIL' : 'PASS',
          title: document.title || '',
          recipePath,
          device: runOptions.device || '',
          platform: runOptions.matrixPlatform || '',
          counts: stats,
          failures: state.failureArtifacts,
          tracePath: state.artifacts?.tracePath || '',
          workflowMermaidPath: state.artifacts?.workflowMermaidPath || '',
          workflowPath: state.artifacts?.workflowPath || '',
          availableEvalRefs: listEvalRefs(appRoot).map((entry) => entry.ref),
        });
      }
    }
  }

  return {
    title: document.title || '',
    counts: stats,
    artifactDir: state.artifacts?.rootDir || '',
    failures: state.failureArtifacts,
  };
}

function parseMatrixPlatforms(value) {
  return (value || DEFAULT_MATRIX_PLATFORMS.join(','))
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function listConnectedDevices(appRoot) {
  const result = spawnBridge(appRoot, ['list-devices']);
  return Array.isArray(result.devices) ? result.devices : [];
}

function chooseMatrixDevice(platform, devices, config) {
  const candidates = devices.filter((device) => device.platform === platform);
  if (candidates.length === 0) {
    return null;
  }

  if (platform === 'web') {
    return candidates[0];
  }

  if (platform === 'ios') {
    const preferredName = config.AGENTIC_DEFAULT_SIMULATOR || '';
    return (
      candidates.find(
        (device) =>
          device.targetType === 'simulator' &&
          device.name === preferredName
      ) ||
      candidates.find((device) => device.targetType === 'simulator') ||
      candidates[0]
    );
  }

  if (platform === 'android') {
    return (
      candidates.find((device) => device.targetType === 'emulator') ||
      candidates.find((device) => String(device.name || '').includes('sdk_')) ||
      candidates[0]
    );
  }

  return candidates[0];
}

async function runMatrixRecipe(recipePath, runOptions) {
  const platforms = parseMatrixPlatforms(runOptions.matrix);
  const config = loadAgenticConfig(runOptions.appRoot);
  const devices = listConnectedDevices(runOptions.appRoot);
  const selectedTargets = [];
  const missingPlatforms = [];

  platforms.forEach((platform) => {
    const target = chooseMatrixDevice(platform, devices, config);
    if (!target) {
      missingPlatforms.push(platform);
      return;
    }
    selectedTargets.push({
      name: target.name,
      platform,
      targetType: target.targetType || '',
    });
  });

  if (missingPlatforms.length > 0) {
    throw new Error(
      `Matrix run missing device(s) for: ${missingPlatforms.join(', ')}\n` +
        `Available devices:\n${devices
          .map((device) => `  - ${device.platform || 'unknown'}: ${device.name}`)
          .join('\n')}`
    );
  }

  const baseDir =
    runOptions.artifactsDir ||
    path.join(runOptions.appRoot, '.agent', 'recipe-runs');
  const matrixDir = path.resolve(
    path.join(
      baseDir,
      `${timestampSlug()}_${sanitizeFileSegment(
        path.basename(recipePath, path.extname(recipePath))
      )}_matrix`
    )
  );
  fs.mkdirSync(matrixDir, { recursive: true });

  const results = [];
  for (const target of selectedTargets) {
    console.log('========================================');
    console.log(`Matrix target: ${target.platform} -> ${target.name}`);
    console.log('');

    const targetOptions = {
      ...runOptions,
      artifactRunDir: path.join(
        matrixDir,
        `${target.platform}_${sanitizeFileSegment(target.name)}`
      ),
      device: target.name,
      executionState: {
        artifacts: null,
        failureArtifacts: [],
        referencedEvalRefs: new Set(),
      },
      matrix: '',
      matrixPlatform: target.platform,
    };

    try {
      const summary = await runRecipe(recipePath, targetOptions);
      results.push({
        artifactDir: summary.artifactDir,
        counts: summary.counts,
        device: target.name,
        ok: true,
        platform: target.platform,
      });
    } catch (error) {
      const artifactDir =
        targetOptions.executionState?.artifacts?.rootDir || targetOptions.artifactRunDir;
      results.push({
        artifactDir,
        device: target.name,
        error: String(error.message || error),
        ok: false,
        platform: target.platform,
      });
    }
  }

  const summaryPath = path.join(matrixDir, 'matrix-summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify({ results }, null, 2)}\n`);

  console.log('========================================');
  console.log('Matrix Summary');
  results.forEach((result) => {
    const status = result.ok ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${result.platform} -> ${result.device}`);
    if (!result.ok) {
      console.log(`    error: ${result.error}`);
    }
    if (result.artifactDir) {
      console.log(`    artifacts: ${result.artifactDir}`);
    }
  });
  console.log(`  summary: ${summaryPath}`);
  console.log('');

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    throw new Error(`Matrix run failed on ${failed.map((entry) => entry.platform).join(', ')}`);
  }

  return {
    results,
    summaryPath,
  };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const appRoot = getAppRoot();
    const recipeInput = resolveRecipeInput(appRoot, options.recipe);
    const teamsDir = getTeamsDir(appRoot);

    if (!fs.existsSync(teamsDir)) {
      throw new Error(`No recipe teams directory found for app: ${teamsDir}`);
    }

    if (options.matrix) {
      await runMatrixRecipe(recipeInput.recipePath, {
        appRoot,
        artifactsDir: options.artifactsDir,
        device: options.device,
        dryRun: options.dryRun,
        hud: options.hud,
        matrix: options.matrix,
        singleStep: options.singleStep,
        skipManual: options.skipManual,
        updateBaselines: options.updateBaselines,
      });
      return;
    }

    await runRecipe(recipeInput.recipePath, {
      appRoot,
      artifactsDir: options.artifactsDir,
      device: options.device,
      dryRun: options.dryRun,
      hud: options.hud,
      singleStep: options.singleStep,
      skipManual: options.skipManual,
      updateBaselines: options.updateBaselines,
    });
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

main();
