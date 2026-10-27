'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const candidate = require('./pbcinema-agent-registry-readonly-v1.cjs');

const source = [
  'const PROJECTS = {',
  "  cfpark_front_prod: { name: 'cfpark_front_prod', root: '/home/cfpark/domains/cfpark.ir/public_html' },",
  "  cfpark_admin_prod: { name: 'cfpark_admin_prod', root: '/home/cfpark/domains/dashboard.cfpark.ir/public_html' },",
  '};',
  'module.exports = PROJECTS;',
].join('\n');
const makeEvidence = () => ({
  source: 'trusted_root_preflight',
  writeAllowlistAudit: 'DENY_ALL_PBCINEMA',
  roots: Object.fromEntries(Object.entries(candidate.PROJECTS).map(([id, x]) =>
    [id, { exists: true, isDirectory: true, isSymlink: false, realpath: x.root }])),
  vhosts: Object.fromEntries(Object.entries(candidate.PROJECTS).map(([id, x]) =>
    [id, { domain: x.domain, resolvedRoot: x.root }])),
  permissions: Object.fromEntries(Object.keys(candidate.PROJECTS).map(id =>
    [id, { dbWrite: false, deploy: false, execWrite: false, fileWrite: false, projectWrite: false }])),
});
const plan = (text=source, evidence=makeEvidence(), expected=candidate.sha256(Buffer.from(text))) =>
  candidate.prepareCandidate({source:text, expectedSha256:expected, liveEvidence:evidence});

test('only two exact PBCinema identities are proposed; no write capability', () => {
  const result = plan();
  assert.deepEqual(result.projectIds.sort(), ['pbcinema_admin_prod', 'pbcinema_front_prod']);
  assert.equal(result.writeEnabled, false);
  assert.equal(result.state, 'candidate_not_installed');
  assert.equal(result.requiresTrustedInstaller, true);
  assert.equal(result.requiresConsumedSignedL4, true);
  assert.match(result.candidate, /metadataOnly: true/);
  assert.equal((result.candidate.match(/writeEnabled: false/g) || []).length, 2);
  assert.equal(candidate.sha256(Buffer.from(result.candidate)), result.candidateSha256);
  assert.ok(result.candidate.includes(source.slice(source.indexOf('  cfpark_front_prod'))));
});
test('wrong or missing exact source preimage SHA blocks before generating candidate', () => {
  assert.throws(() => plan(source, makeEvidence(), 'f'.repeat(64)), /preimage_sha_mismatch/);
  assert.throws(() => plan(source, makeEvidence(), ''), /preimage_sha_mismatch/);
});
test('historical paths are never enough: vhost mismatch and symlinks fail closed', () => {
  const evidence=makeEvidence();
  evidence.vhosts.pbcinema_front_prod.resolvedRoot = '/tmp/other';
  assert.throws(() => plan(source,evidence), /vhost_or_root_mismatch/);
  const another=makeEvidence();
  another.roots.pbcinema_admin_prod.isSymlink=true;
  assert.throws(() => plan(source,another), /vhost_or_root_mismatch/);
});
test('shared-root write permissions MUST all be denied', () => {
  for (const name of ['dbWrite','deploy','execWrite','fileWrite','projectWrite']) {
    const evidence=makeEvidence();
    evidence.permissions.pbcinema_front_prod[name]=true;
    assert.throws(() => plan(source,evidence), /shared_root_write_scope_not_denied/);
  }
  const missing=makeEvidence();
  delete missing.permissions.pbcinema_admin_prod.dbWrite;
  assert.throws(() => plan(source,missing), /shared_root_write_scope_not_denied/);
});
test('caller data alone cannot replace trusted preflight declaration', () => {
  const evidence=makeEvidence();
  evidence.source='user_json';
  assert.throws(() => plan(source,evidence), /preflight_missing/);
  evidence.source='trusted_root_preflight';
  evidence.writeAllowlistAudit='UNKNOWN';
  assert.throws(() => plan(source,evidence), /preflight_missing/);
});
test('duplicate aliases and ambiguous registry marker are refused', () => {
  assert.throws(() => plan(source+'\nconst PROJECTS = {};'), /registry_anchor_cardinality/);
  assert.throws(() => plan(source+'\n// pbcinema_admin_prod'), /duplicate_or_ambiguous_project/);
});
test('no direct installer, CLI or mutable exports are provided', () => {
  assert.deepEqual(Object.keys(candidate).sort(),
    ['ACTION','PROJECTS','prepareCandidate','sha256','verifyEvidence'].sort());
  assert.equal(Object.isFrozen(candidate),true);
  assert.equal(Object.isFrozen(candidate.PROJECTS),true);
});
