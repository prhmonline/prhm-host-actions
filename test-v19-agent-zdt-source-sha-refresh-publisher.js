'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const FILE = path.join(__dirname, 'bootstrap-agent-zdt-source-sha-refresh-v19.sh');

function source() {
  return fs.readFileSync(FILE, 'utf8');
}

test('publisher is fixed to the reviewed action and SHA transition', () => {
  const s = source();
  assert.match(s, /TARGET='\/opt\/prhm-agent-selfmaint-exec\/actions\/agent-zdt-existing-topology-rolling-refresh-v1\.js'/);
  assert.match(s, /OLD_ACTION_SHA='d6e9b9d1478f680986773d9ac4fddf4c4c292a4b83421aabc9025ac33d7215c3'/);
  assert.match(s, /OLD_API_SHA='7897c7e50d73bc9f00eb7efcc9bde7b25e2a0107175d592dad0d8b9180db78f9'/);
  assert.match(s, /NEW_API_SHA='c59283afb1d03c523d22d649765ebdaf388857d49e3d86e5a2abab8543fcf69a'/);
});

test('publisher accepts no positional input and exposes no network or service-control surface', () => {
  const s = source();
  assert.doesNotMatch(s, /\$\{?1\}?|\$@|getopts/);
  assert.doesNotMatch(s, /\bcurl\b|\bwget\b|\bsystemctl\b|\bssh\b|\bscp\b/);
  assert.match(s, /\[ "\$#" -eq 0 \]/);
});

test('publisher is fail-closed, backup-first, syntax-checking, and atomic', () => {
  const s = source();
  assert.match(s, /sha256sum/);
  assert.match(s, /old_action_sha_mismatch/);
  assert.match(s, /old_api_sha_count_mismatch/);
  assert.match(s, /new_api_sha_already_present/);
  assert.match(s, /\/var\/backups\/prhm-agent-zdt-source-sha-refresh-v19/);
  assert.match(s, /prhm-node --check/);
  assert.match(s, /mv -f -- "\$TMP" "\$TARGET"/);
  assert.match(s, /rollback/);
});

test('publisher shell syntax is valid', () => {
  const r = cp.spawnSync('/bin/bash', ['-n', FILE], {encoding:'utf8'});
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
