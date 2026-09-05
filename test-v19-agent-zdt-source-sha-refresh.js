'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const IMPL = path.join(__dirname, 'bootstrap-host-actions-v19-agent-zdt-source-sha-refresh.js');

function load() {
  delete require.cache[require.resolve(IMPL)];
  return require(IMPL);
}

test('exports fixed v19 Agent ZDT source-SHA refresh contract', () => {
  const m = load();
  assert.equal(m.ACTION, 'agent_zdt_existing_topology_rolling_refresh_source_sha_refresh_v19');
  assert.equal(m.TARGET_PATH, '/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js');
  assert.equal(m.OLD_ACTION_SHA, 'd6e9b9d1478f680986773d9ac4fddf4c4c292a4b83421aabc9025ac33d7215c3');
  assert.equal(m.OLD_API_SHA, '7897c7e50d73bc9f00eb7efcc9bde7b25e2a0107175d592dad0d8b9180db78f9');
  assert.equal(m.NEW_API_SHA, 'c59283afb1d03c523d22d649765ebdaf388857d49e3d86e5a2abab8543fcf69a');
  assert.equal(typeof m.buildCandidate, 'function');
});

test('candidate replaces exactly one API source SHA and preserves all other bytes', () => {
  const m = load();
  const before = [
    '#!/usr/local/bin/prhm-node',
    "const EXPECTED_SHA=Object.freeze({",
    "  ['/opt/prhm-agent-zdt/router.mjs']:'53b904296da0e9d1490bfc7e3ef0b9c1fbad602a1e693141108f016764ebbe78',",
    "  ['/home/agent/ssh-agent-api/server.js']:'7897c7e50d73bc9f00eb7efcc9bde7b25e2a0107175d592dad0d8b9180db78f9',",
    "  ['/home/agent/ssh-mcp-server/server.js']:'5d631a1c94208ba2d3daa515e45f3bd3717cf705a1d918f3e8bd9f9d85a97176'",
    '});',
    'module.exports={EXPECTED_SHA};',
    ''
  ].join('\n');

  const out = m.buildCandidate(before);
  assert.equal(out.ok, true);
  assert.equal(out.replacement_count, 1);
  assert.equal(out.production_mutation, false);
  assert.match(out.sha256, /^[a-f0-9]{64}$/);
  assert.equal(out.content.includes(m.OLD_API_SHA), false);
  assert.equal(out.content.includes(m.NEW_API_SHA), true);
  assert.equal(
    out.content.replace(m.NEW_API_SHA, m.OLD_API_SHA),
    before
  );
});

test('candidate fails closed when old pin is missing, duplicated, or new pin already exists', () => {
  const m = load();
  assert.throws(() => m.buildCandidate('no matching pin here'), /expected_old_api_sha_missing/);
  assert.throws(() => m.buildCandidate(m.OLD_API_SHA + '\n' + m.OLD_API_SHA), /expected_old_api_sha_not_unique/);
  assert.throws(() => m.buildCandidate(m.OLD_API_SHA + '\n' + m.NEW_API_SHA), /new_api_sha_already_present/);
});

test('v19 exposes no caller-controlled command, path, service, or arbitrary write surface', () => {
  const m = load();
  assert.equal(m.buildCandidate.length, 1);
  for (const forbidden of ['command','exec','spawn','destinationPath','service','run','apply']) {
    assert.equal(Object.prototype.hasOwnProperty.call(m, forbidden), false);
  }
});
