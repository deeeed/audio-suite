#!/usr/bin/env node
/**
 * CDP Bridge — unified entry point for interacting with the running
 * Expo Audio Studio playground app on ALL platforms (Android, iOS, Web)
 * via the Chrome DevTools Protocol.
 *
 * Native (Android/iOS) targets are discovered via Metro's /json/list.
 * Web (Chrome) targets are discovered via Chrome's --remote-debugging-port
 * (connection info read from .agent/web-browser.json).
 *
 * Usage:
 *   node scripts/agentic/cdp-bridge.mjs [--device <name>] <command> [args...]
 *
 * Commands:
 *   navigate <path>                    Navigate to a route (Expo Router path)
 *   get-route                          Get current route path
 *   get-state                          Get audio recorder state
 *   eval <expression>                  Evaluate arbitrary JS in app context
 *   can-go-back                        Check if navigation can go back
 *   go-back                            Navigate back
 *   reload                             Reload the JS bundle (Page.reload)
 *   screenshot [label]                 Take a screenshot (dispatches per-platform)
 *   list-devices                       List all connected agentic devices
 *
 * Device targeting:
 *   --device <name>   Filter by device name (case-insensitive substring match)
 *   0 devices → error
 *   1 device  → result directly
 *   2+ devices → all commands broadcast to every device; use --device to narrow
 *
 * Environment:
 *   WATCHER_PORT    Metro port (default: 7365)
 *   CDP_TIMEOUT     Connection timeout in ms (default: 5000)
 *   EVAL_TIMEOUT    eval-async wall-clock timeout in ms (default: 30000)
 *                   Bump for recipes whose evaluator does long-running
 *                   work like web ASR over slow CDN downloads.
 *   CDP_URL         External Chrome CDP URL (e.g. http://192.168.1.5:9222)
 *                   Bypasses .agent/web-browser.json — connects directly
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { checkAssert } = require('./lib/assert');
const {
  listEvalRefs,
  listTeamNames,
  loadPreConditionRegistry,
  parsePreConditionSpec,
  renderTemplate,
  resolveEvalRef,
} = require('./lib/catalog');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_PORT = 7365;
const DISCOVERY_RETRIES = 5;
const DISCOVERY_RETRY_DELAY_MS = 2000;

// APP_ROOT is set by thin wrappers; fall back to __dirname for direct invocation
const APP_ROOT = process.env.APP_ROOT || path.resolve(__dirname, '../..');
const AGENT_DIR = path.join(APP_ROOT, '.agent');
const WEB_CONNECTION_FILE = path.join(AGENT_DIR, 'web-browser.json');
const SCREENSHOT_DIR = path.join(AGENT_DIR, 'screenshots');
const AGENTIC_CONF_FILE = path.join(APP_ROOT, 'scripts', 'agentic', 'agentic.conf');
const PRE_CONDITIONS = loadPreConditionRegistry(APP_ROOT);

function loadConfiguredPort() {
  if (!fs.existsSync(AGENTIC_CONF_FILE)) {
    return null;
  }

  const conf = fs.readFileSync(AGENTIC_CONF_FILE, 'utf8');
  const match = conf.match(/^\s*AGENTIC_PORT=(\d+)\s*$/m);
  return match ? Number.parseInt(match[1], 10) : null;
}

function loadPort() {
  return Number.parseInt(
    process.env.WATCHER_PORT || String(loadConfiguredPort() || DEFAULT_PORT),
    10
  );
}

function getDefaultTeam() {
  const teams = listTeamNames(APP_ROOT);
  return teams.length === 1 ? teams[0] : null;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse CLI args, extracting --device <name> and returning the remaining args.
 */
function parseArgs(argv) {
  const raw = argv.slice(2);
  let deviceFilter = null;
  const rest = [];

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--device' && i + 1 < raw.length) {
      i += 1;
      deviceFilter = raw[i];
    } else {
      rest.push(raw[i]);
    }
  }

  return { deviceFilter, args: rest };
}

// ---------------------------------------------------------------------------
// Target discovery
// ---------------------------------------------------------------------------

/**
 * Fetch the list of debuggable targets from the Hermes inspector.
 * Expo/Metro exposes them at /json/list on the Metro port.
 */
function fetchTargets(port) {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:${port}/json/list`;
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(
              new Error(`Failed to parse /json/list response: ${e.message}`)
            );
          }
        });
      })
      .on('error', (err) => {
        reject(
          new Error(
            `Cannot reach Metro at localhost:${port}. Is the app running?\n` +
              `  Start it with: scripts/agentic/start-metro.sh\n` +
              `  Error: ${err.message}`
          )
        );
      });
  });
}

/**
 * Probe a WebSocket target to see if it has __AGENTIC__ installed.
 * Returns true if the bridge is available, false otherwise.
 */
async function probeTarget(wsUrl, WebSocketImpl) {
  try {
    const client = await createWSClient(wsUrl, 2000, WebSocketImpl);
    try {
      const result = await cdpEval(
        client,
        'typeof globalThis.__AGENTIC__ !== "undefined"',
        2000
      );
      return result === true;
    } finally {
      client.close();
    }
  } catch {
    return false;
  }
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Like fetchTargets but returns [] instead of throwing on network errors.
 */
async function fetchTargetsSafe(port) {
  try {
    const targets = await fetchTargets(port);
    return Array.isArray(targets) ? targets : [];
  } catch {
    return [];
  }
}

/**
 * Fetch targets from a full CDP URL (e.g. http://192.168.1.5:9222).
 * Calls /json/list on the given URL.
 */
function fetchTargetsFromUrl(urlString) {
  return new Promise((resolve, reject) => {
    const listUrl = `${urlString.replace(/\/$/, '')}/json/list`;
    http
      .get(listUrl, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Failed to parse ${listUrl}: ${e.message}`));
          }
        });
      })
      .on('error', (err) => {
        reject(new Error(`Cannot reach CDP at ${urlString}: ${err.message}`));
      });
  });
}

/**
 * Rewrite the host in a WebSocket URL to match the target CDP host.
 * Chrome returns ws://localhost:... even when accessed remotely.
 */
function rewriteWsHost(wsUrl, targetHost) {
  if (targetHost === 'localhost' || targetHost === '127.0.0.1') return wsUrl;
  try {
    const u = new URL(wsUrl);
    u.hostname = targetHost;
    return u.toString();
  } catch {
    return wsUrl;
  }
}

/**
 * Discover web Chrome targets by reading .agent/web-browser.json and
 * querying Chrome's /json/list on the CDP port.
 * Returns an array of { wsUrl, deviceName } (0 or 1 entries).
 *
 * When CDP_URL env var is set, connects directly to that URL instead of
 * reading .agent/web-browser.json. This supports connecting to any
 * Chrome/Chromium launched with --remote-debugging-port.
 */
async function discoverWebTargets(metroPort, WebSocketImpl) {
  const cdpUrl = process.env.CDP_URL;

  if (cdpUrl) {
    // External browser mode — connect directly to CDP_URL
    let targets;
    try {
      targets = await fetchTargetsFromUrl(cdpUrl);
    } catch {
      return [];
    }
    if (!Array.isArray(targets) || targets.length === 0) return [];

    // Extract host from CDP_URL for WebSocket URL rewriting
    let targetHost = 'localhost';
    try {
      targetHost = new URL(cdpUrl).hostname;
    } catch { /* keep localhost */ }

    // Filter to page targets with a WebSocket URL
    const pageTargets = targets.filter(
      (t) => t.type === 'page' && t.webSocketDebuggerUrl
    );

    // Probe each page for __AGENTIC__ (don't filter by metroPort URL
    // since the app URL may differ on external machines)
    for (const target of pageTargets) {
      const wsUrl = rewriteWsHost(target.webSocketDebuggerUrl, targetHost);
      const hasAgentic = await probeTarget(wsUrl, WebSocketImpl);
      if (hasAgentic) {
        return [{ wsUrl, deviceName: 'web (Chrome)' }];
      }
    }

    return [];
  }

  // Standard mode — read connection file
  if (!fs.existsSync(WEB_CONNECTION_FILE)) return [];

  let conn;
  try {
    conn = JSON.parse(fs.readFileSync(WEB_CONNECTION_FILE, 'utf8'));
  } catch {
    return [];
  }

  const cdpPort = conn.cdpPort;
  if (!cdpPort) return [];

  // Check if the browser process is still alive
  if (conn.pid) {
    try {
      process.kill(conn.pid, 0); // signal 0 = existence check
    } catch {
      return []; // process is dead, skip
    }
  }

  // Fetch targets from Chrome's CDP endpoint
  const targets = await fetchTargetsSafe(cdpPort);
  if (targets.length === 0) return [];

  // Find a page target whose URL contains localhost:{metroPort}
  const pageTargets = targets.filter(
    (t) =>
      t.type === 'page' &&
      t.webSocketDebuggerUrl &&
      (t.url || '').includes(`localhost:${metroPort}`)
  );

  if (pageTargets.length === 0) return [];

  // Probe the first matching page for __AGENTIC__
  for (const target of pageTargets) {
    const hasAgentic = await probeTarget(target.webSocketDebuggerUrl, WebSocketImpl);
    if (hasAgentic) {
      return [
        {
          wsUrl: target.webSocketDebuggerUrl,
          deviceName: 'web (Chrome)',
        },
      ];
    }
  }

  return [];
}

/**
 * Discover ALL WebSocket debug targets that have __AGENTIC__ installed.
 * Returns an array of { wsUrl, deviceName } objects, one per device.
 * Deduplicates by deviceName so we don't open multiple connections to the
 * same device (Hermes can expose several pages per device).
 *
 * Discovers both native (Metro/Hermes) and web (Chrome CDP) targets.
 *
 * No filtering is done here — filtering by --device happens in main().
 *
 * Retries discovery up to DISCOVERY_RETRIES times when no agentic targets
 * are found — handles the race condition where Android connects to Metro
 * but Hermes hasn't reported pages yet.
 */
async function discoverAllTargets(port, WebSocketImpl, deviceFilter) {
  // Fast-path: if the caller explicitly wants the web device, skip native
  // discovery entirely — native probes hang for 10s+ when the native app
  // doesn't have __AGENTIC__ installed.
  if (deviceFilter && deviceFilter.toLowerCase() === 'web') {
    const webTargets = await discoverWebTargets(port, WebSocketImpl);
    if (webTargets.length > 0) return webTargets;
    throw new Error(
      'No web device found. Start the browser with: yarn web\n' +
      '(or: node scripts/agentic/web-browser.mjs launch)'
    );
  }

  const targets = await fetchTargets(port);

  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error(
      'No debug targets found. Make sure the app is running and connected to Metro.'
    );
  }

  // Filter to targets that have a WebSocket debugger URL
  const candidates = targets.filter((t) => t.webSocketDebuggerUrl);

  if (candidates.length === 0) {
    throw new Error(
      `No suitable debug target found. Targets:\n${JSON.stringify(targets, null, 2)}`
    );
  }

  // Sort by page number descending (JS runtime has higher page number)
  candidates.sort((a, b) => {
    const aPage = Number.parseInt((a.id || '').split('-').pop() || '0', 10);
    const bPage = Number.parseInt((b.id || '').split('-').pop() || '0', 10);
    return bPage - aPage;
  });

  // Probe each candidate, collecting the first match per deviceName
  const results = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const resolvedCandidate = shouldAnnotateIOSTarget(candidate)
      ? annotateIOSTarget(candidate)
      : candidate;
    const name = resolvedCandidate.deviceName || '';
    if (seen.has(name)) continue; // already found agentic target for this device
    const hasAgentic = await probeTarget(resolvedCandidate.webSocketDebuggerUrl, WebSocketImpl);
    if (hasAgentic) {
      seen.add(name);
      results.push({
        ...resolvedCandidate,
        wsUrl: resolvedCandidate.webSocketDebuggerUrl,
        deviceName: name,
      });
    }
  }

  // Retry: if no agentic targets found, poll /json/list again.
  // This handles the race condition where Android just connected to Metro
  // but Hermes hasn't reported its pages yet.
  if (results.length === 0) {
    for (let attempt = 1; attempt <= DISCOVERY_RETRIES; attempt++) {
      process.stderr.write(
        `[cdp-bridge] No __AGENTIC__ targets found, retrying (${attempt}/${DISCOVERY_RETRIES})...\n`
      );
      await sleep(DISCOVERY_RETRY_DELAY_MS);

      const retryTargets = await fetchTargets(port);
      const retryCandidates = (retryTargets || []).filter(
        (t) => t.webSocketDebuggerUrl
      );

      // Sort by page number descending
      retryCandidates.sort((a, b) => {
        const aPage = Number.parseInt((a.id || '').split('-').pop() || '0', 10);
        const bPage = Number.parseInt((b.id || '').split('-').pop() || '0', 10);
        return bPage - aPage;
      });

      for (const candidate of retryCandidates) {
        const resolvedCandidate = shouldAnnotateIOSTarget(candidate)
          ? annotateIOSTarget(candidate)
          : candidate;
        const name = resolvedCandidate.deviceName || '';
        if (seen.has(name)) continue;
        const hasAgentic = await probeTarget(resolvedCandidate.webSocketDebuggerUrl, WebSocketImpl);
        if (hasAgentic) {
          seen.add(name);
          results.push({
            ...resolvedCandidate,
            wsUrl: resolvedCandidate.webSocketDebuggerUrl,
            deviceName: name,
          });
        }
      }

      if (results.length > 0) break;
    }
  }

  // Final fallback: if still no agentic target, use highest page number candidate
  if (results.length === 0) {
    const fallbackTarget = shouldAnnotateIOSTarget(candidates[0])
      ? annotateIOSTarget(candidates[0])
      : candidates[0];
    const fallbackName = fallbackTarget.deviceName || '(unnamed)';
    process.stderr.write(
      `[cdp-bridge] Warning: No __AGENTIC__ target found after ${DISCOVERY_RETRIES} retries ` +
      `(${DISCOVERY_RETRIES * DISCOVERY_RETRY_DELAY_MS / 1000}s). ` +
      `Falling back to best candidate: "${fallbackName}" (${fallbackTarget.webSocketDebuggerUrl})\n`
    );
    results.push({
      ...fallbackTarget,
      wsUrl: fallbackTarget.webSocketDebuggerUrl,
      deviceName: fallbackName,
    });
  }

  // Also discover web (Chrome) targets — these use a separate CDP port
  const webTargets = await discoverWebTargets(port, WebSocketImpl);
  for (const wt of webTargets) {
    if (!seen.has(wt.deviceName)) {
      seen.add(wt.deviceName);
      results.push(wt);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// WebSocket CDP client
// ---------------------------------------------------------------------------

/**
 * Resolve WebSocket implementation once.
 * Node 22+ has a built-in WebSocket; for older versions we use the ws package
 * that ships with React Native / Metro dev dependencies.
 */
async function resolveWebSocket() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  try {
    const { default: WS } = await import('ws');
    return WS;
  } catch {
    throw new Error(
      'WebSocket not available. Install "ws" package or use Node >= 22.'
    );
  }
}

/**
 * Minimal CDP client using WebSocket.
 */
function createWSClient(wsUrl, timeout, WebSocketImpl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(wsUrl);
    let msgId = 0;
    const pending = new Map();

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP connection timeout after ${timeout}ms`));
    }, timeout);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve({
        /** Send a CDP command and wait for the response */
        send(method, params, sendTimeout) {
          return new Promise((resolve, reject) => {
            const id = ++msgId;
            const sendTimer = sendTimeout
              ? setTimeout(() => {
                  pending.delete(id);
                  reject(new Error(`CDP send timeout after ${sendTimeout}ms`));
                }, sendTimeout)
              : null;
            pending.set(id, {
              resolve: (v) => {
                if (sendTimer) clearTimeout(sendTimer);
                resolve(v);
              },
              reject: (e) => {
                if (sendTimer) clearTimeout(sendTimer);
                reject(e);
              },
            });
            const msg = JSON.stringify({ id, method, params });
            ws.send(msg);
          });
        },
        close() {
          ws.close();
        },
      });
    };

    ws.onmessage = (evt) => {
      const data =
        typeof evt.data === 'string' ? evt.data : evt.data.toString();
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) {
          rej(new Error(`CDP error: ${JSON.stringify(msg.error)}`));
        } else {
          res(msg.result);
        }
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${err.message || err}`));
    };

    ws.onclose = () => {
      clearTimeout(timer);
      for (const [, { reject: rej }] of pending) {
        rej(new Error('WebSocket closed'));
      }
      pending.clear();
    };
  });
}

// ---------------------------------------------------------------------------
// CDP evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a JS expression in the app's Hermes runtime via CDP Runtime.evaluate.
 * Returns the evaluated value (primitives and JSON-serialisable objects).
 */
async function cdpEval(client, expression, evalTimeout) {
  const wrapped = `(function() { return (${expression}); })()`;
  const result = await client.send(
    'Runtime.evaluate',
    {
      expression: wrapped,
      returnByValue: true,
      awaitPromise: false,
      generatePreview: false,
    },
    evalTimeout
  );

  if (result.exceptionDetails) {
    const desc =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      JSON.stringify(result.exceptionDetails);
    throw new Error(`Evaluation error: ${desc}`);
  }

  return result.result?.value;
}

/**
 * Evaluate a JS expression that returns a Promise.
 * Hermes CDP does not support awaitPromise, so the result is stored on
 * globalThis and polled until it resolves or rejects.
 */
async function cdpEvalAsync(
  client,
  expression,
  timeoutMs = Number.parseInt(process.env.EVAL_TIMEOUT || '30000', 10)
) {
  const key = `__cdp_async_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
  const kickoff = `(function() {
    globalThis['${key}'] = { status: 'pending' };
    try {
      Promise.resolve(${expression})
        .then(function(value) {
          globalThis['${key}'] = { status: 'resolved', value: value };
        })
        .catch(function(error) {
          globalThis['${key}'] = { status: 'rejected', error: String(error) };
        });
    } catch (error) {
      globalThis['${key}'] = { status: 'rejected', error: String(error) };
    }
    return 'started';
  })()`;

  const kickoffResult = await client.send(
    'Runtime.evaluate',
    {
      expression: kickoff,
      returnByValue: true,
      awaitPromise: false,
      generatePreview: false,
    },
    timeoutMs
  );

  if (kickoffResult.exceptionDetails) {
    const desc =
      kickoffResult.exceptionDetails.exception?.description ||
      kickoffResult.exceptionDetails.text ||
      JSON.stringify(kickoffResult.exceptionDetails);
    throw new Error(`Async evaluation error: ${desc}`);
  }

  const cleanup = () =>
    client
      .send(
        'Runtime.evaluate',
        {
          expression: `delete globalThis['${key}']`,
          returnByValue: true,
          awaitPromise: false,
          generatePreview: false,
        },
        2000
      )
      .catch(() => {});

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      await sleep(200);
      const check = await client.send(
        'Runtime.evaluate',
        {
          expression: `(function() { return globalThis['${key}']; })()`,
          returnByValue: true,
          awaitPromise: false,
          generatePreview: false,
        },
        timeoutMs
      );

      const value = check.result?.value;
      if (value?.status === 'resolved') {
        return value.value;
      }
      if (value?.status === 'rejected') {
        throw new Error(`Async evaluation error: ${value.error}`);
      }
    }

    throw new Error(`Async evaluation timed out after ${timeoutMs}ms`);
  } finally {
    await cleanup();
  }
}

function normalizeRawResult(raw) {
  if (raw == null) {
    return 'null';
  }

  if (typeof raw === 'string') {
    return raw;
  }

  return JSON.stringify(raw);
}

async function evalSpec(client, entry, params = {}) {
  const expression =
    typeof entry.expression === 'function'
      ? entry.expression(params)
      : renderTemplate(entry.expression, params);
  return entry.async ? cdpEvalAsync(client, expression) : cdpEval(client, expression);
}

async function evaluatePreCondition(client, rawSpec) {
  const parsedSpec = parsePreConditionSpec(rawSpec);
  const name = typeof parsedSpec === 'string' ? parsedSpec : parsedSpec?.name;
  const params =
    typeof parsedSpec === 'string'
      ? {}
      : Object.fromEntries(
          Object.entries(parsedSpec).filter(([key]) => key !== 'name')
        );

  const entry = PRE_CONDITIONS[name];
  if (!entry) {
    return {
      ok: false,
      name,
      error: `Unknown pre-condition "${name}"`,
    };
  }

  const raw = normalizeRawResult(await evalSpec(client, entry, params));
  const assertSpec = renderTemplate(entry.assert, params);
  const ok = checkAssert(raw, assertSpec);

  return {
    ok,
    name,
    description: entry.description || '',
    hint: entry.hint || '',
    raw,
  };
}

// ---------------------------------------------------------------------------
// Commands — adapted for Expo Router (URL-based navigation)
// ---------------------------------------------------------------------------

const COMMANDS = {
  async navigate(client, args, { deviceName, platform } = {}) {
    const routePath = args[0];
    if (!routePath) {
      throw new Error('Usage: navigate <path>  (e.g. /(tabs)/record, /minimal)');
    }

    // Capture route before navigation
    const previousRoute = await cdpEval(client, 'globalThis.__AGENTIC__?.getRoute()');

    const expr = `globalThis.__AGENTIC__?.navigate(${JSON.stringify(routePath)})`;
    await cdpEval(client, expr);

    // Small delay for navigation to settle, then return current route
    await new Promise((resolve) => setTimeout(resolve, 500));
    const currentRoute = await cdpEval(client, 'globalThis.__AGENTIC__?.getRoute()');
    return { navigated: routePath, previousRoute, currentRoute, deviceName, platform };
  },

  async 'get-route'(client) {
    return await cdpEval(client, 'globalThis.__AGENTIC__?.getRoute()');
  },

  async 'get-state'(client) {
    return await cdpEval(client, 'globalThis.__AGENTIC__?.getState()');
  },

  async eval(client, args) {
    const expression = args.join(' ');
    if (!expression) {
      throw new Error('Usage: eval <expression>');
    }
    return await cdpEval(client, expression);
  },

  async 'eval-async'(client, args) {
    const expression = args.join(' ');
    if (!expression) {
      throw new Error('Usage: eval-async <expression>');
    }
    return await cdpEvalAsync(client, expression);
  },

  async 'eval-ref'(client, args) {
    if (args[0] === '--list') {
      return {
        refs: listEvalRefs(APP_ROOT),
      };
    }

    const ref = args[0];
    if (!ref) {
      throw new Error('Usage: eval-ref <team/ref> or eval-ref --list');
    }

    const resolved = resolveEvalRef(ref, {
      appRoot: APP_ROOT,
      defaultTeam: getDefaultTeam(),
    });
    return await evalSpec(client, resolved.entry);
  },

  async 'can-go-back'(client) {
    return await cdpEval(client, 'globalThis.__AGENTIC__?.canGoBack()');
  },

  async 'go-back'(client) {
    await cdpEval(client, 'globalThis.__AGENTIC__?.goBack()');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const route = await cdpEval(client, 'globalThis.__AGENTIC__?.getRoute()');
    return { currentRoute: route };
  },

  async 'press-test-id'(client, args, { deviceName } = {}) {
    const testId = args[0];
    if (!testId) {
      throw new Error('Usage: press-test-id <testId> [--value true|false]');
    }
    let targetValue;
    if (args[1] === '--value') {
      if (!['true', 'false'].includes(args[2])) {
        throw new Error('Usage: press-test-id <testId> [--value true|false]');
      }
      targetValue = args[2] === 'true';
    }
    const expr =
      targetValue === undefined
        ? `globalThis.__AGENTIC__?.pressTestId(${JSON.stringify(testId)})`
        : `globalThis.__AGENTIC__?.pressTestId(${JSON.stringify(testId)}, ${JSON.stringify(targetValue)})`;
    const result = await cdpEval(client, expr);
    return { ...result, testId, deviceName };
  },

  async 'set-input'(client, args, { deviceName } = {}) {
    const testId = args[0];
    const value = args[1] ?? '';
    if (!testId) {
      throw new Error('Usage: set-input <testId> <value>');
    }

    const expr = `globalThis.__AGENTIC__?.setInputByTestId?.(${JSON.stringify(
      testId
    )}, ${JSON.stringify(value)})`;
    const result = await cdpEval(client, expr);
    return { ...result, testId, value, deviceName };
  },

  async 'set-step-hud'(client, args, { deviceName } = {}) {
    const payload = args.join(' ');
    if (!payload) {
      throw new Error('Usage: set-step-hud <json-step>');
    }

    let step;
    try {
      step = JSON.parse(payload);
    } catch (error) {
      throw new Error(`Invalid HUD payload: ${error.message}`);
    }

    const expr = `globalThis.__AGENTIC__?.setStepHud?.(${JSON.stringify(step)}) ?? ${JSON.stringify(
      {
        ok: false,
        supported: false,
      }
    )}`;
    const result = await cdpEval(client, expr);
    return { ...result, deviceName };
  },

  async 'clear-step-hud'(client, _args, { deviceName } = {}) {
    const expr = `globalThis.__AGENTIC__?.clearStepHud?.() ?? ${JSON.stringify({
      ok: false,
      supported: false,
    })}`;
    const result = await cdpEval(client, expr);
    return { ...result, deviceName };
  },

  async 'scroll-view'(client, args, { deviceName } = {}) {
    // Parse flags: --test-id <id>, --offset <n>, --animated / --no-animated
    let testId = undefined;
    let offset = 300;
    let animated = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--test-id' && i + 1 < args.length) {
        testId = args[++i];
      } else if (args[i] === '--offset' && i + 1 < args.length) {
        offset = Number(args[++i]);
      } else if (args[i] === '--animated') {
        animated = true;
      } else if (args[i] === '--no-animated') {
        animated = false;
      }
    }
    const optsJson = JSON.stringify({ testId, offset, animated });
    const expr = `globalThis.__AGENTIC__?.scrollView(${optsJson})`;
    const result = await cdpEval(client, expr);
    return { ...result, deviceName };
  },

  async 'check-pre-conditions'(client, args) {
    const payload = args.join(' ');
    if (!payload) {
      throw new Error('Usage: check-pre-conditions <json-array>');
    }

    let specs;
    try {
      specs = JSON.parse(payload);
    } catch (error) {
      throw new Error(`Invalid pre-condition JSON: ${error.message}`);
    }

    if (!Array.isArray(specs)) {
      throw new Error('check-pre-conditions expects a JSON array');
    }

    const failures = [];
    const passed = [];

    for (const spec of specs) {
      const result = await evaluatePreCondition(client, spec);
      if (result.ok) {
        passed.push(result.name);
      } else {
        failures.push(result);
      }
    }

    return {
      ok: failures.length === 0,
      passed,
      failures,
    };
  },

  async reload(client, _args, { deviceName } = {}) {
    await client.send('Page.reload', {}, 5000);
    return { reloaded: true, deviceName };
  },

  async screenshot(client, args, { deviceName, platform } = {}) {
    const label = args[0] || 'screenshot';
    const timestamp = new Date()
      .toISOString()
      .replaceAll(/[:.]/g, '-')
      .replaceAll('T', '_')
      .slice(0, 19);

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    // Build filename including device name for multi-device disambiguation
    const safeName = (deviceName || 'unknown')
      .replaceAll(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 30);
    const filename = `${timestamp}_${label}_${safeName}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);

    if (platform === 'web') {
      // Web: use CDP Page.captureScreenshot
      const result = await client.send('Page.captureScreenshot', {
        format: 'png',
      }, 10000);
      if (!result.data) {
        throw new Error('Page.captureScreenshot returned no data');
      }
      fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
    } else if (platform === 'android') {
      // Android: shell out to adb
      const serial = resolveAndroidSerial(deviceName);
      const serialFlag = serial ? `-s ${serial}` : '';
      try {
        execSync(`adb ${serialFlag} exec-out screencap -p > "${filepath}"`, {
          shell: true,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
      } catch (e) {
        throw new Error(`adb screencap failed: ${e.message}`);
      }
    } else if (platform === 'ios') {
      // iOS: distinguish simulator vs physical device
      const iosDevice = resolveIOSDevice(deviceName);
      if (iosDevice.type === 'simulator') {
        try {
          execSync(`xcrun simctl io "${iosDevice.udid}" screenshot "${filepath}"`, {
            stdio: ['ignore', 'ignore', 'pipe'],
          });
        } catch (e) {
          throw new Error(`xcrun simctl screenshot failed: ${e.message}`);
        }
      } else {
        // Physical iOS device — no reliable CLI screenshot tool available.
        process.stderr.write(`[cdp-bridge] Skipping screenshot for physical iOS device "${deviceName}" (not supported)\n`);
        return { screenshot: null, deviceName, platform, skipped: 'physical iOS device screenshots not supported' };
      }
    } else {
      throw new Error(
        `Cannot take screenshot: unknown platform "${platform}" for device "${deviceName}"`
      );
    }

    // Verify file was created
    if (!fs.existsSync(filepath) || fs.statSync(filepath).size === 0) {
      throw new Error(`Screenshot failed: file not created or empty at ${filepath}`);
    }

    // Cleanup old screenshots (keep last 20)
    try {
      const files = fs
        .readdirSync(SCREENSHOT_DIR)
        .filter((f) => f.endsWith('.png'))
        .sort()
        .reverse();
      for (const f of files.slice(20)) {
        fs.unlinkSync(path.join(SCREENSHOT_DIR, f));
      }
    } catch {
      // cleanup is best-effort
    }

    const abspath = path.resolve(filepath);
    return { screenshot: abspath, deviceName, platform };
  },

};

// ---------------------------------------------------------------------------
// Platform-specific device resolution for screenshots
// ---------------------------------------------------------------------------

/**
 * Resolve an ADB device serial from a deviceName.
 * The deviceName from Metro typically looks like "Pixel 6a - 16 - API 36".
 * We match against `adb devices -l` model names.
 */
function resolveAndroidDeviceRecord(deviceName) {
  if (!deviceName) return null;
  let output;
  try {
    output = execSync('adb devices -l', { encoding: 'utf8' });
  } catch {
    return null;
  }
  const lines = output.split('\n').filter((l) => l.includes('device '));
  if (lines.length === 0) return null;
  if (lines.length === 1) {
    // Only one device — use it
    const serial = lines[0].split(/\s+/)[0];
    return {
      serial,
      targetType: serial.startsWith('emulator-') ? 'emulator' : 'physical',
    };
  }
  // Multiple devices — try to match by model name
  const filter = deviceName.toLowerCase();
  for (const line of lines) {
    const modelMatch = line.match(/model:(\S+)/);
    if (modelMatch) {
      const rawModel = modelMatch[1].toLowerCase();
      const normalizedModel = rawModel.replaceAll(/_/g, ' ');
      const firstToken = filter.split(' ')[0].toLowerCase();
      if (
        filter.includes(rawModel) ||
        rawModel.includes(firstToken) ||
        filter.includes(normalizedModel) ||
        normalizedModel.includes(firstToken)
      ) {
        const serial = line.split(/\s+/)[0];
        return {
          serial,
          targetType: serial.startsWith('emulator-') ? 'emulator' : 'physical',
        };
      }
    }
  }
  // No match — error loudly instead of silently using wrong device
  const available = lines
    .map((l) => {
      const serial = l.split(/\s+/)[0];
      const model = (l.match(/model:(\S+)/) || [])[1] || 'unknown';
      return `${serial} (model: ${model})`;
    })
    .join('\n  - ');
  throw new Error(
    `No Android device matching "${deviceName}".\n` +
    `Available devices:\n  - ${available}`
  );
}

function resolveAndroidSerial(deviceName) {
  return resolveAndroidDeviceRecord(deviceName)?.serial || null;
}

function getBootedIOSSimulators() {
  const output = execSync('xcrun simctl list devices -j', {
    encoding: 'utf8',
  });
  const data = JSON.parse(output);
  const booted = [];
  for (const [, devs] of Object.entries(data.devices)) {
    for (const d of devs) {
      if (d.state === 'Booted') booted.push(d);
    }
  }
  return booted;
}

function getConnectedIOSPhysicalDevices() {
  try {
    const output = execFileSync('/usr/bin/xcrun', ['devicectl', 'list', 'devices', '-v'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const blocks = output.split(/(?=▿ .+ - [0-9A-F]{8}-)/);
    const devices = [];
    for (const block of blocks) {
      if (!block.includes('physical')) continue;
      if (!block.includes('available') && !block.includes('paired')) continue;
      const name =
        block.match(/name: Optional\("([^"]+)"\)/)?.[1] ||
        block.match(/marketingName: Optional\("([^"]+)"\)/)?.[1];
      const udid = block.match(/udid: Optional\("([^"]+)"\)/)?.[1];
      if (name && udid) {
        devices.push({ name, udid });
      }
    }
    return devices;
  } catch {
    return [];
  }
}

function normalizeIOSDeviceFilterName(deviceName) {
  return (deviceName || '')
    .replace(/^sim:/i, '')
    .replace(/^device:/i, '')
    .replace(/^ios:/i, '');
}

function shouldAnnotateIOSTarget(target) {
  const appId = target.appId || '';
  const metroDeviceName = target.deviceName || '';
  const title = target.title || '';
  const searchable = `${metroDeviceName} ${title}`;

  if (!appId.startsWith('net.siteed.')) {
    return false;
  }

  // Metro reports Android physical/emulator device names in the same target
  // list as iOS. Do not rewrite Android targets just because their bundle ID
  // uses our net.siteed.* namespace.
  if (/\b(Android|Pixel|API\s+\d+|emulator|sdk_gphone)\b/i.test(searchable)) {
    return false;
  }

  if (/\b(iPhone|iPad|iPod)\b/i.test(searchable)) {
    return true;
  }

  const normalizedName = normalizeIOSDeviceFilterName(metroDeviceName).toLowerCase();
  const matchingSimulator = getBootedIOSSimulators().some(
    (device) => device.name.toLowerCase() === normalizedName
  );
  if (matchingSimulator) {
    return true;
  }

  // The sherpa-voice iOS simulator/dev-client target uses the production
  // bundle ID in Metro, while Android dev builds use net.siteed.sherpavoice.development.
  return appId === 'net.siteed.sherpavoice';
}

function annotateIOSTarget(target) {
  const metroDeviceName = target.deviceName || '';
  const bootedSimulators = getBootedIOSSimulators();
  const connectedPhysicalDevices = getConnectedIOSPhysicalDevices();
  const matchingSimulator = bootedSimulators.find(
    (device) => device.name.toLowerCase() === metroDeviceName.toLowerCase()
  );

  if (matchingSimulator) {
    return {
      ...target,
      deviceName: `sim:${matchingSimulator.name}`,
      originalDeviceName: metroDeviceName,
      targetType: 'simulator',
      udid: matchingSimulator.udid,
    };
  }

  const logicalDeviceId = target.reactNative?.logicalDeviceId;
  const matchingPhysicalDevice =
    connectedPhysicalDevices.length === 1
      ? connectedPhysicalDevices[0]
      : connectedPhysicalDevices.find(
          (device) =>
            device.name.toLowerCase() === metroDeviceName.toLowerCase() ||
            device.udid === logicalDeviceId
        );

  if (matchingPhysicalDevice) {
    return {
      ...target,
      deviceName: `device:${matchingPhysicalDevice.name}`,
      originalDeviceName: metroDeviceName,
      targetType: 'physical',
      udid: matchingPhysicalDevice.udid,
    };
  }

  return {
    ...target,
    deviceName: `ios:${metroDeviceName || 'unknown'}`,
    originalDeviceName: metroDeviceName,
    targetType: 'unknown',
  };
}

/**
 * Resolve whether an iOS device is a simulator or physical device.
 * Returns { type: 'simulator', udid } or { type: 'physical' }.
 *
 * Uses exact name match against booted simulators — fuzzy matching caused
 * physical device names like "iPhone" to incorrectly match simulators
 * like "iPhone 16 Pro Max".
 */
function resolveIOSDevice(deviceName) {
  const booted = getBootedIOSSimulators();

  if (!deviceName) {
    // No device name — use first booted simulator if available
    if (booted.length > 0) {
      return { type: 'simulator', udid: booted[0].udid };
    }
    return { type: 'physical' };
  }

  const normalizedName = normalizeIOSDeviceFilterName(deviceName);

  // Exact name match against booted simulators (case-insensitive)
  const exactMatches = booted.filter(
    (d) => d.name.toLowerCase() === normalizedName.toLowerCase()
  );

  if (exactMatches.length === 1) {
    return { type: 'simulator', udid: exactMatches[0].udid };
  }

  if (exactMatches.length > 1) {
    const list = exactMatches
      .map((d) => `${d.name} (${d.udid})`)
      .join(', ');
    throw new Error(
      `Multiple booted simulators match "${deviceName}": ${list}. Use --device with a more specific name.`
    );
  }

  // No exact simulator match — it's a physical device
  return { type: 'physical' };
}

function inferTargetType(platform, deviceName) {
  if (platform === 'web') {
    return 'browser';
  }

  if (platform === 'ios') {
    try {
      return resolveIOSDevice(deviceName).type;
    } catch {
      return 'unknown';
    }
  }

  if (platform === 'android') {
    try {
      return resolveAndroidDeviceRecord(deviceName)?.targetType || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { deviceFilter, args } = parseArgs(process.argv);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(`CDP Bridge — unified entry point for all platforms (Android, iOS, Web)

Usage:
  node scripts/agentic/cdp-bridge.mjs [--device <name>] <command> [args...]

Commands:
  navigate <path>                    Navigate to a route (Expo Router URL path)
  get-route                          Get current route path
  get-state                          Get audio recorder state (isRecording, isPaused, durationMs, etc.)
  eval <expression>                  Evaluate arbitrary JS in app context
  eval-async <expression>            Evaluate a Promise-returning expression in app context
  eval-ref <team/ref>                Evaluate a named ref from scripts/agentic/teams/*/evals*.json
  eval-ref --list                    List named eval refs for the current app
  can-go-back                        Check if navigation can go back
  go-back                            Navigate back
  press-test-id <testId>             Press a component by testID (walks React fiber tree)
  set-input <testId> <value>         Set a text input by testID via the agentic bridge
  set-step-hud <json-step>           Publish the current recipe step to the in-app HUD overlay
  clear-step-hud                     Clear the in-app HUD overlay
  scroll-view [--test-id <id>] [--offset <n>] [--animated|--no-animated]
                                     Scroll a ScrollView/FlatList/FlashList (default: offset=300, no-animated)
  check-pre-conditions <json-array>  Evaluate registered pre-conditions for the current app
  reload                             Reload the JS bundle via Page.reload
  screenshot [label]                 Take a screenshot (dispatches per-platform)
  list-devices                       List all connected agentic devices

Routes:
  /(tabs)/record          Record tab (default)
  /(tabs)/import          Import tab
  /(tabs)/transcription   Transcription tab
  /(tabs)/files           Files tab
  /(tabs)/more            More tab
  /minimal                Minimal recording test
  /trim                   Audio trimming
  /decibel                Decibel meter
  /permissions            Permission settings
  /audio-device-test      Audio device testing
  /baby-cry               Baby cry detection
  /essentia               Essentia audio analysis
  /download               Download screen
  /wasm-demo              WebAssembly demo

Device targeting:
  --device <name>   Filter by device name (case-insensitive substring match)
  0 devices         → error: no devices found
  1 device          → result directly
  2+ devices        → all commands broadcast to every device
                      output: { devices: [...results] }
                      use --device to narrow down

Environment:
  WATCHER_PORT    Metro port (default: ${DEFAULT_PORT})
  CDP_TIMEOUT     Connection timeout in ms (default: 5000)
  CDP_URL         External Chrome CDP URL (e.g. http://192.168.1.5:9222)
                  Bypasses .agent/web-browser.json — connects directly`);
  process.exit(0);
}

const port = loadPort();
const timeout = Number.parseInt(process.env.CDP_TIMEOUT || '5000', 10);

// Resolve WebSocket implementation once (Node 22+ built-in, else ws package)
const WebSocketImpl = await resolveWebSocket();

// -- list-devices: safe discovery, queries state from each agentic device --
if (command === 'list-devices') {
  const allTargets = await discoverAllTargets(port, WebSocketImpl, null).catch(() => []);
  const devices = [];
  for (const target of allTargets) {
    let state = null;
    let platform = '';
    try {
      const client = await createWSClient(target.wsUrl, 2000, WebSocketImpl);
      try {
        platform = await cdpEval(client, 'globalThis.__AGENTIC__?.platform', 2000).catch(() => '') || '';
        state = await cdpEval(client, 'globalThis.__AGENTIC__?.getState()', 2000);
      } finally {
        client.close();
      }
    } catch { /* state unavailable */ }
    devices.push({
      name: target.deviceName,
      platform,
      targetType: inferTargetType(platform, target.deviceName),
      ...(state && typeof state === 'object' ? state : {}),
    });
  }
  console.log(JSON.stringify({ devices, count: devices.length }, null, 2));
  process.exit(0);
}

async function main() {
  // Discover all agentic targets (no filtering yet)
  const allTargets = await discoverAllTargets(port, WebSocketImpl, deviceFilter);

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error(`Available: ${[...Object.keys(COMMANDS), 'list-devices'].join(', ')}`);
    process.exit(1);
  }

  // -- Resolve target list --------------------------------------------------
  // All commands broadcast to every discovered target by default.
  // Use --device <name> to narrow down when needed.

  let targets = allTargets;

  if (deviceFilter) {
    const filter = deviceFilter.toLowerCase();
    targets = allTargets.filter(
      (t) => (t.deviceName || '').toLowerCase().includes(filter)
    );
    if (targets.length === 0) {
      const available = allTargets
        .map((t) => t.deviceName || '(unnamed)')
        .join('\n  - ');
      console.error(`ERROR: No device matching "${deviceFilter}" found.\nAvailable devices:\n  - ${available}`);
      process.exit(1);
    }
  }

  if (targets.length === 0) {
    console.error('ERROR: No agentic devices found. Is the app running?');
    process.exit(1);
  }

  // -- Dispatch to target(s) -----------------------------------------------
  const results = [];
  for (const target of targets) {
    const client = await createWSClient(target.wsUrl, timeout, WebSocketImpl);
    try {
      const platform = await cdpEval(client, 'globalThis.__AGENTIC__?.platform').catch(() => '') || '';
      const result = await handler(client, args.slice(1), {
        deviceName: target.deviceName,
        platform,
      });
      results.push(result);
    } finally {
      client.close();
    }
  }

  if (results.length === 1) {
    console.log(JSON.stringify(results[0], null, 2));
  } else {
    console.log(JSON.stringify({ devices: results }, null, 2));
  }
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
