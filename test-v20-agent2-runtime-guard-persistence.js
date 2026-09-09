'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const IMPL = path.join(
  __dirname,
  'bootstrap-host-actions-v20-agent2-runtime-guard-persistence.js'
);

function load() {
  delete require.cache[require.resolve(IMPL)];
  return require(IMPL);
}

test('exports fixed V20 Agent2 persistence contract', () => {
  const m = load();

  assert.equal(
    m.ACTION,
    'agent2_runtime_guard_persistence_v20'
  );

  assert.equal(
    m.API_SOURCE_SHA,
    '46b2e680b48a641c4802038770c9bf27f6f60b5d1b55384ead03cef439217a93'
  );

  assert.deepEqual(
    Object.keys(m.ARTIFACTS).sort(),
    ['forward', 'guard', 'helper', 'stage']
  );

  assert.equal(typeof m.verifyCanonicalArtifacts, 'function');
  assert.equal(m.verifyCanonicalArtifacts.length, 0);
});

test('canonical artifacts have exact immutable SHA-256 values', () => {
  const m = load();
  const out = m.verifyCanonicalArtifacts();

  assert.equal(out.ok, true);
  assert.equal(out.production_mutation, false);
  assert.equal(out.database_mutation, false);

  assert.equal(
    out.artifacts.stage.sha256,
    'f598433e7cca534a8d507f21e0e2a1b4f3bb8f02d2532beb83ab026f1a154c2b'
  );

  assert.equal(
    out.artifacts.forward.sha256,
    'f8132af794482436e80ff3e19ae3f4353a82de8c3e5387023d90bc7e0d244b7b'
  );

  assert.equal(
    out.artifacts.helper.sha256,
    'c5e2835e3eb76d3a48bf5bb7f34956cddc8fc83fb176048e1be28dee74dbf1a7'
  );

  assert.equal(
    out.artifacts.guard.sha256,
    'aeee5be4c6cdeb9f31c341898ce01b7242ecc106181faf47e3d6dfd2003fc6e3'
  );
});

test('helper binds current API source and runtime guard SHA', () => {
  const m = load();

  const helper = fs.readFileSync(
    path.join(
      m.ARTIFACT_ROOT,
      m.ARTIFACTS.helper.source
    ),
    'utf8'
  );

  assert.equal(
    helper.includes(
      "[PATHS.apiSource]:'46b2e680b48a641c4802038770c9bf27f6f60b5d1b55384ead03cef439217a93'"
    ),
    true
  );

  assert.equal(
    helper.includes(
      "const MCP_RUNTIME_PREFLIGHT_SHA='aeee5be4c6cdeb9f31c341898ce01b7242ecc106181faf47e3d6dfd2003fc6e3';"
    ),
    true
  );
});

test('stage and forward artifacts are idempotent and non-refreshing', () => {
  const m = load();

  const stage = fs.readFileSync(
    path.join(m.ARTIFACT_ROOT, m.ARTIFACTS.stage.source),
    'utf8'
  );

  const forward = fs.readFileSync(
    path.join(m.ARTIFACT_ROOT, m.ARTIFACTS.forward.source),
    'utf8'
  );

  for (const source of [stage, forward]) {
    assert.equal(source.includes('already_applied:true'), true);
    assert.equal(source.includes('api_source_refresh:false'), true);
  }

  assert.equal(
    forward.includes(
      'const content=source.replace(ROLLING_HELPER_OLD_API_SHA'
    ),
    false
  );

  assert.equal(
    forward.includes('replacement_count:1'),
    false
  );
});

test('V20 exposes no arbitrary mutation surface', () => {
  const m = load();

  for (const forbidden of [
    'apply',
    'exec',
    'spawn',
    'command',
    'destinationPath',
    'service',
    'run',
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(m, forbidden),
      false
    );
  }
});
