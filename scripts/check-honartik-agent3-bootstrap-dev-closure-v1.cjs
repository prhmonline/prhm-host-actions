#!/usr/bin/env node
'use strict';
// Source-only read verification: no network, deployment, staging, credentials or writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'manifests/honartik-agent3-bootstrap-dev-test-source-closure-v1.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const staged = [
  'bootstrap-host-actions-honartik-staging-privilege-boundary-install-v1.js',
  'honartik-staging-privilege-boundary-install-v1.js',
  'test-honartik-staging-privilege-boundary-install-v1.js',
];
const rootInputs = [
  'bootstrap-host-actions-honartik-staging-privilege-boundary-install-v1.js',
  'test-honartik-staging-privilege-boundary-install-v1.js',
];
function safeRelative(p) {
  assert.equal(typeof p, 'string');
  assert.match(p, /^(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.(?:js|cjs|json)$/);
  assert.ok(!p.split('/').includes('..'), 'no parent traversal');
  return p;
}
function localPath(parent, relative) {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(parent), relative));
  return safeRelative(/\.(js|cjs|json)$/.test(resolved) ? resolved : resolved + '.js');
}
function hashGitBlob(bytes) {
  return crypto.createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
}
assert.equal(manifest.schema, 'prhm.honartik.agent3.dev-test-source-closure.v1');
assert.equal(manifest.status, 'GIT_ONLY_REVIEWED_SOURCE_NOT_INSTALLED');
assert.equal(manifest.source_commit, 'd174b949f1715e33e3b66674f344d471f2c50a68');
assert.equal(manifest.source_file_count, 18);
assert.equal(manifest.files.length, 18);
assert.equal(manifest.requires_separately_reviewed_fixed_scope_update, true);
assert.equal(manifest.host_tool_currently_can_stage_full_closure, false);
for (const key of ['approved_for_production', 'may_request_level4', 'may_charge_or_release_tickets']) {
  assert.equal(manifest[key], false);
}
assert.deepEqual(manifest.host_fixed_allowlist.slice().sort(), staged);
const files = new Map();
for (const row of manifest.files) {
  safeRelative(row.path);
  assert.ok(!files.has(row.path), 'duplicate path: ' + row.path);
  const target = path.join(root, row.path);
  const stat = fs.lstatSync(target);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'regular source only');
  const bytes = fs.readFileSync(target);
  assert.equal(bytes.length, row.utf8_bytes, 'bytes drift: ' + row.path);
  assert.equal(hashGitBlob(bytes), row.git_blob_sha1, 'Git blob drift: ' + row.path);
  const src = bytes.toString('utf8');
  const deps = [...new Set([...src.matchAll(/\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)]
    .map(m => localPath(row.path, m[1])))];
  assert.deepEqual(deps, row.local_requires, 'dependency drift: ' + row.path);
  files.set(row.path, row);
}
const queue = [...rootInputs], reached = new Set();
while (queue.length) {
  const file = queue.shift();
  assert.ok(files.has(file), 'dependency omitted: ' + file);
  if (reached.has(file)) continue;
  reached.add(file);
  for (const dep of files.get(file).local_requires) queue.push(dep);
}
assert.equal(reached.size, 18, 'closure includes unreachable/unreviewed modules');
const unstaged = [...files.keys()].filter(p => !staged.includes(p)).sort();
assert.deepEqual(manifest.host_not_explicitly_staged.slice().sort(), unstaged);
assert.equal(unstaged.length, 15);
process.stdout.write('HONARTIK_AGENT3_DEV_TEST_SOURCE_CLOSURE=PASS files=18 not_explicitly_staged=15 production_modified=false\n');
