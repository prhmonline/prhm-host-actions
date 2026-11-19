'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTION, PROJECT, BASE_SHA, RELEASE_SHA, TESTED_BUILD_ID,
  PROD_ROOT, CANDIDATE_ROOT, BACKUP_ROOT, CONTRACT_SHA256,
  EXPECTED_DIFF_PATHS, CHECKOUT_SCOPE_PATHS, REQUIRED_TESTS,
  contract, normalizePaths, evaluateObservedState
} = require('./honartik-cinema-checkout-release-contract-v1.cjs');

function observed() {
  return {
    project: PROJECT,
    production_root: PROD_ROOT,
    candidate_root: CANDIDATE_ROOT,
    production_head: BASE_SHA,
    candidate_head: RELEASE_SHA,
    production_clean: true,
    candidate_clean: true,
    changed_paths: [...EXPECTED_DIFF_PATHS],
    tested_build_id: TESTED_BUILD_ID,
    pinned_artifact_sha256: 'a'.repeat(64),
    observed_artifact_sha256: 'a'.repeat(64),
    tests: Object.fromEntries(REQUIRED_TESTS.map(name => [name, true])),
    bank_transaction_attempts: 0,
    supplier_reservation_posts: 0,
    database_writes: 0
  };
}

test('only one exact project, baseline SHA, release SHA and fixed build are in the contract', () => {
  const c = contract();
  assert.equal(c.action, 'honartik_cinema_checkout_release_v1');
  assert.equal(c.project, 'honartik_front_prod');
  assert.equal(c.baseline_sha, 'fbb317572f3dc6b0a04363ff8222aace65644491');
  assert.equal(c.release_sha, 'e1af45a377baa1ad45cee4dba3a379dd5199681f');
  assert.equal(c.tested_build_id, 'vlzBn3MPhvvB8oPMG9NnX');
  assert.equal(c.backup_root, BACKUP_ROOT);
  assert.match(CONTRACT_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(c.allow_db_mutations, false);
  assert.equal(c.allow_payment_posts, false);
  assert.equal(c.allow_additional_projects, false);
  assert.equal(c.auto_retry, false);
  assert.equal(c.require_signed_l4_one_time, true);
  assert.equal(c.source_only, true);
  assert.equal(c.installed, false);
});

test('exact nine-file release diff cannot be silently widened', () => {
  assert.equal(EXPECTED_DIFF_PATHS.length, 9);
  assert.equal(CHECKOUT_SCOPE_PATHS.length, 8);
  assert.deepEqual(normalizePaths([...EXPECTED_DIFF_PATHS].reverse()), [...EXPECTED_DIFF_PATHS].sort());
  const state = observed();
  state.changed_paths.push('app/config/db.php');
  assert.ok(evaluateObservedState(state).gaps.includes('DIFF_NOT_EXACTLY_SHA_BOUND'));
});

test('unrelated theater changes are blocked rather than treating a SHA as scope approval', () => {
  const report = evaluateObservedState(observed());
  assert.equal(report.ready, false);
  assert.equal(report.installed, false);
  assert.equal(report.production_changed, false);
  assert.deepEqual(report.out_of_scope_paths, ['src/app/theater/[id]/page.tsx']);
  assert.ok(report.gaps.includes('SOURCE_SCOPE_REQUIRES_SEPARATE_APPROVAL'));
  assert.ok(report.gaps.includes('TRUSTED_REGISTRAR_AND_SIGNED_L4_NOT_VERIFIED'));
});

test('rejects changed production SHA and candidate SHA without modifying anything', () => {
  const prod = observed();
  prod.production_head = '0'.repeat(40);
  assert.ok(evaluateObservedState(prod).gaps.includes('BASE_SHA_DRIFT'));
  const candidate = observed();
  candidate.candidate_head = '1'.repeat(40);
  assert.ok(evaluateObservedState(candidate).gaps.includes('RELEASE_SHA_DRIFT'));
});

test('rejects dirty trees, untrusted roots and different projects', () => {
  const state = observed();
  state.production_clean = false;
  state.project = 'imotion_front_prod';
  state.candidate_root = '/tmp/attacker';
  const gaps = evaluateObservedState(state).gaps;
  assert.ok(gaps.includes('DIRTY_WORKTREE'));
  assert.ok(gaps.includes('WRONG_PROJECT'));
  assert.ok(gaps.includes('ROOT_MISMATCH'));
});

test('fails closed on path traversal, duplicate diff, missing artifact digest or changed build', () => {
  assert.equal(normalizePaths(['src/../secrets']), null);
  assert.equal(normalizePaths(['/etc/passwd']), null);
  assert.equal(normalizePaths(['x', 'x']), null);
  const state = observed();
  state.changed_paths = ['src/../secrets'];
  state.pinned_artifact_sha256 = 'not-pinned';
  state.tested_build_id = 'modified-build';
  const gaps = evaluateObservedState(state).gaps;
  assert.ok(gaps.includes('DIFF_NOT_EXACTLY_SHA_BOUND'));
  assert.ok(gaps.includes('ARTIFACT_DIGEST_NOT_ATTESTED'));
  assert.ok(gaps.includes('BUILD_ID_DRIFT'));
});

test('refuses missing test evidence and any forbidden money or database side effects', () => {
  const state = observed();
  state.tests.candidate_unauth_401 = false;
  state.database_writes = 1;
  state.bank_transaction_attempts = 1;
  state.supplier_reservation_posts = 1;
  const gaps = evaluateObservedState(state).gaps;
  assert.ok(gaps.includes('TEST_EVIDENCE_INCOMPLETE'));
  assert.ok(gaps.includes('FORBIDDEN_SIDE_EFFECTS'));
});

test('caller-provided approval booleans cannot make a source-only contract executable', () => {
  const state = observed();
  state.approved = true;
  state.level4_confirmation = 'CONFIRM_LEVEL_4_CRITICAL';
  state.registry_installed = true;
  state.signed_receipt = 'forged';
  const report = evaluateObservedState(state);
  assert.equal(report.ready, false);
  assert.equal(report.installed, false);
  assert.ok(report.gaps.includes('TRUSTED_REGISTRAR_AND_SIGNED_L4_NOT_VERIFIED'));
});

test('invalid observation fails closed and never exposes a shell or deployment API', () => {
  assert.deepEqual(evaluateObservedState(null).gaps, ['OBSERVATIONS_INVALID']);
  const c = contract();
  for (const key of ['command', 'shell', 'sql', 'url', 'host', 'deploy', 'execute', 'apply']) {
    assert.equal(Object.hasOwn(c, key), false);
  }
  const impl = require('./honartik-cinema-checkout-release-contract-v1.cjs');
  for (const name of ['activate', 'deploy', 'apply', 'run', 'registerTool']) {
    assert.equal(typeof impl[name], 'undefined');
  }
});

console.log('Honartik cinema checkout SHA-bound candidate: 9 read-only/fail-closed contract tests defined');
