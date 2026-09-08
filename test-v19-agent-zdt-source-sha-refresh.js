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
  assert.equal(m.OLD_ACTION_SHA, '6b110621eb7dbff73d04ca0c16d9493d9ec58411dc806c1415efa93b6dac84ec');
  assert.equal(m.OLD_API_SHA, 'c592835c75cfe3b02d613ba895d811340200bfd06f33d2a77373a28e267691eb');
  assert.equal(m.NEW_API_SHA, '02e7587d0319865bbb1767568edde18d1350aaa39bb0fedc92c5867fd639e3e2');
  assert.equal(typeof m.buildCandidate, 'function');
});

test('candidate replaces exactly one API source SHA and preserves all other bytes', () => {
  const m = load();
  const before = [
    '#!/usr/local/bin/prhm-node',
    "const EXPECTED_SHA=Object.freeze({",
    "  ['/opt/prhm-agent-zdt/router.mjs']:'53b904296da0e9d1490bfc7e3ef0b9c1fbad602a1e693141108f016764ebbe78',",
    "  ['/home/agent/ssh-agent-api/server.js']:'c592835c75cfe3b02d613ba895d811340200bfd06f33d2a77373a28e267691eb',",
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
