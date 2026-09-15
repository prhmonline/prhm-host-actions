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

test('publisher is fixed to the reviewed action and current SHA transition', () => {
  const s = source();
  assert.match(s, /TARGET='\/opt\/prhm-agent-selfmaint-exec\/actions\/agent-zdt-existing-topology-rolling-refresh-v1\.js'/);
  assert.match(s, /OLD_ACTION_SHA='0fd63f7f8fe346ced5fbbfa3a7a4bc96253e498528934aaa3c7232e986b832bf'/);
  assert.match(s, /OLD_API_SHA='5878fb592d8afcac571faa710e35811e462d4b98a2c120104b1eaf3ec1644001'/);
  assert.match(s, /NEW_API_SHA='0cafe4ec6ad9471f3fdae65e3d2fa93bf349bfdeb5caf99ab03a18a5d3ece556'/);
});

test('publisher accepts no caller positional input and exposes no network or service-control surface', () => {
  const s = source();
  assert.doesNotMatch(s, /\$@|getopts/);
  assert.match(s, /\[ "\$#" -eq 0 \]/);
  assert.doesNotMatch(s, /\bcurl\b|\bwget\b|\bsystemctl\b|\bssh\b|\bscp\b/);
});

test('publisher is fail-closed, backup-first, syntax-checking, and atomic', () => {
  const s = source();
  assert.match(s, /sha256sum/);
  assert.match(s, /old_action_sha_mismatch/);
  assert.match(s, /old_api_sha_count_mismatch/);
  assert.match(s, /new_api_sha_already_present/);
  assert.match(s, /\/var\/backups\/prhm-agent-zdt-source-sha-refresh-v19/);
  assert.match(s, /PRHM_NODE='\/usr\/local\/bin\/prhm-node'/);
  assert.match(s, /"\$PRHM_NODE" --check "\$TMP"/);
  assert.match(s, /"\$PRHM_NODE" --check "\$TARGET"/);
  assert.match(s, /mv -f -- "\$TMP" "\$TARGET"/);
  assert.match(s, /rollback/);
});

test('publisher shell syntax is valid', () => {
  const r = cp.spawnSync('/bin/bash', ['-n', FILE], {encoding:'utf8'});
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
