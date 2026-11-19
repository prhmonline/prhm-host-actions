'use strict';

/**
 * SOURCE-ONLY candidate for a fixed Honartik cinema checkout release action.
 *
 * Intentionally NO production side effects or entrypoint. The trusted PRHM
 * shared registrar / Approval Center must independently attest source and
 * candidate artifacts and consume a fresh, signed, typed Level-4 approval
 * before this may ever be exposed as an executable MCP operation.
 */
const crypto = require('node:crypto');

const ACTION = 'honartik_cinema_checkout_release_v1';
const PROJECT = 'honartik_front_prod';
const PROD_ROOT = '/home/honartik/domains/honartik.ir/public_html';
const CANDIDATE_ROOT = '/root/prhm-dev/worktrees/honartik-iticket-checkout-20261119';
const BACKUP_ROOT = '/home/honartik/recovery-archive/honartik-front/iticket-pre-release-20261119-fbb3175';
const BASE_SHA = 'fbb317572f3dc6b0a04363ff8222aace65644491';
const RELEASE_SHA = 'e1af45a377baa1ad45cee4dba3a379dd5199681f';
const TESTED_BUILD_ID = 'vlzBn3MPhvvB8oPMG9NnX';
const SHA256 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;

const EXPECTED_DIFF_PATHS = Object.freeze([
  'scripts/test-iticket-checkout-bridge-runtime.mjs',
  'scripts/test-iticket-checkout-contract.mjs',
  'src/app/api/checkout-bridge/route.ts',
  'src/app/cinema/[showId]/page.tsx',
  'src/app/cinema/api.ts',
  'src/app/cinema/payment-status/page.tsx',
  'src/app/cinema/session/[sessionId]/page.tsx',
  'src/app/theater/[id]/page.tsx',
  'src/lib/api/client.ts'
]);

// Only the cinema API/checkout flow, checkout tests, and cinema show page
// are inside the original payment-fix purpose. Theater media is unrelated.
// Never silently interpret a SHA pin as permission to change theater UI.
const CHECKOUT_SCOPE_PATHS = Object.freeze(EXPECTED_DIFF_PATHS.filter(
  path => path !== 'src/app/theater/[id]/page.tsx'
));

const REQUIRED_TESTS = Object.freeze([
  'checkout_contract_16',
  'mocked_bridge_10',
  'typescript',
  'next_build',
  'candidate_health',
  'candidate_cinema',
  'candidate_payment_status',
  'candidate_unauth_401',
  'backup_sha256',
  'rollback_boot',
  'production_health'
]);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(
      k => JSON.stringify(k) + ':' + canonical(value[k])
    ).join(',') + '}';
  }
  return JSON.stringify(value);
}
function contract() {
  return Object.freeze({
    schema_version: 'prhm.honartik-cinema-checkout-action.source.v1',
    action: ACTION,
    project: PROJECT,
    prod_root: PROD_ROOT,
    candidate_root: CANDIDATE_ROOT,
    backup_root: BACKUP_ROOT,
    baseline_sha: BASE_SHA,
    release_sha: RELEASE_SHA,
    tested_build_id: TESTED_BUILD_ID,
    expected_diff_paths: [...EXPECTED_DIFF_PATHS],
    checkout_scope_paths: [...CHECKOUT_SCOPE_PATHS],
    allowed_network: ['127.0.0.1'],
    allow_db_mutations: false,
    allow_payment_posts: false,
    allow_additional_projects: false,
    auto_retry: false,
    require_signed_l4_one_time: true,
    require_archive_integrity: true,
    require_candidate_attestation: true,
    require_automatic_rollback: true,
    required_tests: [...REQUIRED_TESTS],
    source_only: true,
    installed: false
  });
}
const CONTRACT_SHA256 = sha256(Buffer.from(canonical(contract())));

function normalizePaths(paths) {
  if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string')) return null;
  if (new Set(paths).size !== paths.length) return null;
  if (paths.some(p => !p || p.startsWith('/') || p.includes('\\') ||
    p.split('/').some(piece => piece === '.' || piece === '..'))) return null;
  return [...paths].sort();
}

/**
 * Pure preflight. Input MUST come from an independently authenticated
 * read-only collector. It never confers approval; even a passing report
 * cannot be used as a signed consent or as permission to deploy.
 */
function evaluateObservedState(observed) {
  const gaps = [];
  if (!observed || typeof observed !== 'object' || Array.isArray(observed)) {
    return Object.freeze({ ready: false, gaps: ['OBSERVATIONS_INVALID'], action: ACTION });
  }
  if (observed.project !== PROJECT) gaps.push('WRONG_PROJECT');
  if (observed.production_head !== BASE_SHA) gaps.push('BASE_SHA_DRIFT');
  if (observed.candidate_head !== RELEASE_SHA) gaps.push('RELEASE_SHA_DRIFT');
  if (observed.production_root !== PROD_ROOT ||
      observed.candidate_root !== CANDIDATE_ROOT) gaps.push('ROOT_MISMATCH');
  if (observed.production_clean !== true || observed.candidate_clean !== true) {
    gaps.push('DIRTY_WORKTREE');
  }

  const expected = [...EXPECTED_DIFF_PATHS].sort();
  const changed = normalizePaths(observed.changed_paths);
  if (!changed || JSON.stringify(changed) !== JSON.stringify(expected)) {
    gaps.push('DIFF_NOT_EXACTLY_SHA_BOUND');
  }

  const outOfScope = EXPECTED_DIFF_PATHS.filter(p => !CHECKOUT_SCOPE_PATHS.includes(p));
  if (outOfScope.length > 0) gaps.push('SOURCE_SCOPE_REQUIRES_SEPARATE_APPROVAL');

  if (observed.tested_build_id !== TESTED_BUILD_ID) gaps.push('BUILD_ID_DRIFT');
  // BUILD_ID is NOT cryptographic proof of a candidate build. The artifact
  // digest must be pinned by a trusted release manifest and independently
  // attested by the future registrar.
  if (!SHA256.test(String(observed.pinned_artifact_sha256 || '')) ||
      observed.pinned_artifact_sha256 !== observed.observed_artifact_sha256) {
    gaps.push('ARTIFACT_DIGEST_NOT_ATTESTED');
  }
  const tests = observed.tests;
  if (!tests || typeof tests !== 'object' || Array.isArray(tests) ||
      REQUIRED_TESTS.some(k => tests[k] !== true)) {
    gaps.push('TEST_EVIDENCE_INCOMPLETE');
  }
  if (observed.bank_transaction_attempts !== 0 ||
      observed.supplier_reservation_posts !== 0 ||
      observed.database_writes !== 0) {
    gaps.push('FORBIDDEN_SIDE_EFFECTS');
  }
  // A source-only candidate is never installable or executable directly,
  // even if every other test is true. Only the reviewed shared registrar may
  // later issue a typed, signed, once-only Host Actions v2 consent.
  gaps.push('TRUSTED_REGISTRAR_AND_SIGNED_L4_NOT_VERIFIED');
  return Object.freeze({
    action: ACTION,
    project: PROJECT,
    baseline_sha: BASE_SHA,
    release_sha: RELEASE_SHA,
    contract_sha256: CONTRACT_SHA256,
    ready: false,
    gaps: Object.freeze([...new Set(gaps)]),
    out_of_scope_paths: Object.freeze(outOfScope),
    installed: false,
    production_changed: false
  });
}

if (!SHA40.test(BASE_SHA) || !SHA40.test(RELEASE_SHA)) {
  throw new Error('honartik_checkout_action_sha_contract_invalid');
}

module.exports = Object.freeze({
  ACTION, PROJECT, PROD_ROOT, CANDIDATE_ROOT, BACKUP_ROOT,
  BASE_SHA, RELEASE_SHA, TESTED_BUILD_ID, CONTRACT_SHA256,
  EXPECTED_DIFF_PATHS, CHECKOUT_SCOPE_PATHS, REQUIRED_TESTS,
  contract, normalizePaths, evaluateObservedState
});
