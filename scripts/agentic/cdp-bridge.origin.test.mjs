/**
 * Regression coverage for native inspector Origin selection.
 *
 * Context: on Expo SDK 57 / RN 0.86 the inspector rejects a localhost Origin by
 * completing the WebSocket upgrade (HTTP 101) and then closing the socket with
 * code 1006 and no reason. That looks like a silent JS runtime, so the bridge
 * reported `{"devices": [], "count": 0}` and every recipe needing __AGENTIC__
 * failed with `cdp.target found no ready agentic devices`.
 *
 * The fix is to offer the Metro host recorded by start-metro.sh as a candidate
 * Origin instead of hardcoding 127.0.0.1, while keeping the local origin as a
 * fallback for Expo 56, which required it.
 *
 * Run: node --test scripts/agentic/cdp-bridge.origin.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const BRIDGE = path.join(import.meta.dirname, 'cdp-bridge.mjs');
const WS_URL = 'ws://localhost:7361/inspector/debug?device=abc&page=1';

let tmpRoot;
let bridge;

/** Load the bridge with APP_ROOT pointed at a fixture app dir. */
async function loadBridge(appRoot) {
  process.env.APP_ROOT = appRoot;
  process.env.CDP_BRIDGE_IMPORT_ONLY = '1';
  // Cache-bust so each fixture gets a fresh module with its own APP_ROOT.
  return import(`${BRIDGE}?t=${Date.now()}-${Math.random()}`);
}

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-origin-'));
  // App-local layout: APP_ROOT is the app itself (apps/playground), so there is
  // no `apps/` subtree -- this is the case findAppMetroHost() cannot see.
  fs.mkdirSync(path.join(tmpRoot, '.agent'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, '.agent', 'metro.host'), '192.168.50.199\n');
  bridge = await loadBridge(tmpRoot);
});

after(() => {
  delete process.env.CDP_ORIGIN;
  delete process.env.CDP_BRIDGE_IMPORT_ONLY;
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('getInspectorOriginCandidates', () => {
  it('offers the app-local Metro host before the local origin', () => {
    bridge.setLastGoodInspectorOrigin(null);
    const candidates = bridge.getInspectorOriginCandidates(WS_URL);

    assert.equal(
      candidates[0],
      'http://192.168.50.199:7361',
      'recorded Metro host must be tried first -- localhost is rejected on RN 0.86'
    );
    assert.ok(
      candidates.includes('http://127.0.0.1:7361'),
      'local origin must remain as an Expo 56 fallback'
    );
  });

  it('reads metro.host from the app-local .agent dir', () => {
    assert.equal(bridge.findLocalMetroHost(), '192.168.50.199');
  });

  it('lets an explicit CDP_ORIGIN win over discovery', () => {
    process.env.CDP_ORIGIN = 'http://example.test:1234';
    try {
      bridge.setLastGoodInspectorOrigin('http://192.168.50.199:7361');
      assert.deepEqual(bridge.getInspectorOriginCandidates(WS_URL), [
        'http://example.test:1234',
      ]);
    } finally {
      delete process.env.CDP_ORIGIN;
    }
  });

  it('honours an empty CDP_ORIGIN as "send no Origin header"', () => {
    process.env.CDP_ORIGIN = '';
    try {
      assert.deepEqual(bridge.getInspectorOriginCandidates(WS_URL), [undefined]);
    } finally {
      delete process.env.CDP_ORIGIN;
    }
  });

  it('reuses the origin that last passed the __AGENTIC__ probe', () => {
    bridge.setLastGoodInspectorOrigin('http://10.0.0.5:7361');
    assert.equal(
      bridge.getInspectorOriginCandidates(WS_URL)[0],
      'http://10.0.0.5:7361',
      'a known-good origin must be tried first so later connections skip re-probing'
    );
    bridge.setLastGoodInspectorOrigin(null);
  });

  it('never emits duplicate candidates', () => {
    bridge.setLastGoodInspectorOrigin('http://192.168.50.199:7361');
    const candidates = bridge.getInspectorOriginCandidates(WS_URL);
    assert.equal(
      new Set(candidates).size,
      candidates.length,
      `duplicate origins would retry a known-bad host: ${candidates.join(', ')}`
    );
    bridge.setLastGoodInspectorOrigin(null);
  });

  it('leaves non-inspector URLs without an Origin', () => {
    bridge.setLastGoodInspectorOrigin(null);
    assert.deepEqual(
      bridge.getInspectorOriginCandidates('ws://localhost:9222/devtools/page/X'),
      [undefined],
      'web Chrome targets must keep their existing no-Origin behaviour'
    );
  });

  it('preserves a non-local inspector host as its own origin', () => {
    bridge.setLastGoodInspectorOrigin(null);
    assert.deepEqual(
      bridge.getInspectorOriginCandidates(
        'ws://10.1.2.3:7361/inspector/debug?device=abc&page=1'
      ),
      ['http://10.1.2.3:7361']
    );
  });
});

describe('getInspectorOriginCandidates without a recorded metro.host', () => {
  it('still falls back to the local origin', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-origin-bare-'));
    try {
      const isolated = await loadBridge(bare);
      isolated.setLastGoodInspectorOrigin(null);
      assert.deepEqual(isolated.getInspectorOriginCandidates(WS_URL), [
        'http://127.0.0.1:7361',
      ]);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});
