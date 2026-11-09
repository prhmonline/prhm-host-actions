'use strict';
/**
 * SOURCE ONLY. Immutable Solo Universal v2 observe-only release agreement.
 *
 * This module has no CLI, no private key, no approval issuer and no root/native
 * filesystem or service operations. A SEPARATELY REVIEWED trusted root adapter
 * must attest the exact immutable source, load the root-owned owner key,
 * verify the final driver Git SHA and durably consume the independently
 * supplied Ed25519 Level-4 receipt before it can invoke any mutating method.
 */
const crypto = require('node:crypto');

const PINS = Object.freeze({
  operation: 'universal.existing_stateful_service_observe_adoption_v2',
  issuer: 'prhm-owner-root-of-trust',
  audience: 'prhm-universal-root-installer',
  type: 'PRHM-SOLO-UNIVERSAL-STATEFUL-V2',
  level: 4,
  risk: 'critical',
  source_repo: 'prhmonline/deploy-control',
  source_anchor: '9df0cab4d4d75a81fb4ba1e5982915584fc8a727',
  installed_digest: '08889c18a570cc2bff408dfbe78b7e5f4f8da24f465b4fdd445640cd7f89d17d',
  manifest_preimage_sha256: 'b11c7f601307b702f3c7380485851ecf9a23e15fd91c93b7796373f817a2a2a3',
  candidate_digest: '20d8a4f5a972fcfb33812c67e935b38a65d9b71be8a4c7cf21d9f7b4999b929a',
  profile_sha256: 'f767738f3059650e22c137c22e9b4c93f6f28db14ebe8ee3d20eb9c99e7a6df4',
  runtime_release: '0eb43d72aab3f10db22172c8be4c0411cf22d074',
  profile_path: '/etc/deploy-control/projects/solo_company.production.json',
  installer_prefix: '/usr/local/libexec/deploy-control/universal',
  public_key_path: '/root/prhm-owner-public-key.candidate.pem',
  owner_spki_sha256: 'd161f17f3d3446185e9b106b459b693eb3f453653d8221fc7d8e3f6b987f477b',
  owner_receipt_path: '/root/prhm-solo-trust-evidence/universal-stateful-v2-l4.jws',
  max_ttl_seconds: 180,
  allowed_modes: Object.freeze(['observe-existing']),
  no_solo_restart: true,
  no_state_write: true,
  no_public_route: true,
  no_solo_deploy_or_rollback: true,
});
const SHA64 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAIL = reason => { throw Error('solo_universal_v2_release_' + reason) };
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const exact = (x, fields) => !!x && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).sort().join('|') === [...fields].sort().join('|');

function decoded(part) {
  if (typeof part !== 'string' || part.length < 1 || part.length > 24000 ||
      !/^[A-Za-z0-9_-]+$/.test(part)) FAIL('jws_encoding');
  const b = Buffer.from(part, 'base64url');
  if (b.toString('base64url') !== part) FAIL('jws_noncanonical_base64');
  let x;
  try { x = JSON.parse(b.toString('utf8')) } catch (_) { FAIL('jws_json_invalid') }
  if (!Buffer.from(JSON.stringify(x)).equals(b)) FAIL('jws_noncanonical_json');
  return x;
}

/**
 * Pure cryptographic proof check for a trusted native caller. This function
 * does NOT consume a token or grant permission to change a host. The caller
 * must use a root-owned, independently attested key with the fixed PINS hash
 * and an immutable, approved driver SHA from the final code freeze.
 *
 * The expectedKeySha parameter exists for offline synthetic-key tests ONLY;
 * the production root caller MUST supply PINS.owner_spki_sha256.
 */
function verifySignedPermit({token, publicKeyPem, expectedKeySha, driverGitSha,
                             nowSec} = {}) {
  if (!SHA64.test(expectedKeySha || '') || !SHA40.test(driverGitSha || '') ||
      !Number.isSafeInteger(nowSec) || nowSec <= 0) FAIL('trusted_context_required');
  if (typeof token !== 'string' || token.length < 150 || token.length > 32000)
    FAIL('token_missing_or_large');
  const parts = token.split('.');
  if (parts.length !== 3) FAIL('jws_parts');
  const header = decoded(parts[0]), claims = decoded(parts[1]);
  if (!/^[A-Za-z0-9_-]+$/.test(parts[2])) FAIL('signature_encoding');
  const sig = Buffer.from(parts[2], 'base64url');
  if (sig.toString('base64url') !== parts[2] || sig.length !== 64)
    FAIL('signature_shape');
  let key;
  try { key = crypto.createPublicKey(publicKeyPem) }
  catch (_) { FAIL('invalid_public_key') }
  if (key.asymmetricKeyType !== 'ed25519') FAIL('wrong_key_type');
  const actualKeySha = sha256(key.export({type:'spki', format:'der'}));
  if (actualKeySha !== expectedKeySha) FAIL('owner_key_pin_mismatch');
  if (!exact(header, ['alg','typ','kid']) ||
      header.alg !== 'EdDSA' || header.typ !== PINS.type ||
      header.kid !== actualKeySha.slice(0,16)) FAIL('jws_header');
  if (!crypto.verify(null, Buffer.from(parts[0]+'.'+parts[1]), key, sig))
    FAIL('signature_invalid');

  const names = ['iss','aud','operation','environment','project','level','risk',
    'one_time_use','source_repo','source_anchor','driver_git_sha',
    'installed_digest','manifest_preimage_sha256','candidate_digest',
    'profile_sha256','runtime_release','request_id','jti','iat','exp'];
  if (!exact(claims,names) ||
      claims.iss !== PINS.issuer || claims.aud !== PINS.audience ||
      claims.operation !== PINS.operation || claims.environment !== 'production' ||
      claims.project !== 'solo_company' || claims.level !== 4 ||
      claims.risk !== 'critical' || claims.one_time_use !== true ||
      claims.source_repo !== PINS.source_repo ||
      claims.source_anchor !== PINS.source_anchor ||
      claims.driver_git_sha !== driverGitSha ||
      claims.installed_digest !== PINS.installed_digest ||
      claims.manifest_preimage_sha256 !== PINS.manifest_preimage_sha256 ||
      claims.candidate_digest !== PINS.candidate_digest ||
      claims.profile_sha256 !== PINS.profile_sha256 ||
      claims.runtime_release !== PINS.runtime_release ||
      !UUID.test(claims.request_id || '') || !UUID.test(claims.jti || '') ||
      !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
      claims.exp - claims.iat < 1 ||
      claims.exp - claims.iat > PINS.max_ttl_seconds ||
      claims.iat > nowSec + 30 || nowSec < claims.iat - 30 ||
      nowSec >= claims.exp) FAIL('release_scope_or_time_invalid');
  return Object.freeze({
    verified: true, consumed: false, operation: PINS.operation,
    request_id: claims.request_id, jti: claims.jti,
    driver_git_sha: driverGitSha,
    candidate_digest: PINS.candidate_digest,
    profile_sha256: PINS.profile_sha256,
    expiry: claims.exp, signer_key_pin: actualKeySha,
  });
}

/** Strictly validate signed-permit consumption and frozen preflight evidence. */
function checkPreflight(v) {
  const names=['installed_digest','actual_bundle_digest',
    'installed_manifest_sha256','candidate_digest','profile_sha256',
    'runtime_release','existing_v1_profiles_valid','profile_absent',
    'service_healthy','state_private','immutable_source_verified',
    'root_owned_paths','no_symlinks','protected_targets_unchanged'];
  if (!exact(v,names) || v.installed_digest !== PINS.installed_digest ||
      v.actual_bundle_digest !== PINS.installed_digest ||
      v.installed_manifest_sha256 !== PINS.manifest_preimage_sha256 ||
      v.candidate_digest !== PINS.candidate_digest ||
      v.profile_sha256 !== PINS.profile_sha256 ||
      v.runtime_release !== PINS.runtime_release ||
      ['existing_v1_profiles_valid','profile_absent','service_healthy',
       'state_private','immutable_source_verified','root_owned_paths',
       'no_symlinks','protected_targets_unchanged'].some(x => v[x] !== true))
    FAIL('live_preimage_untrusted');
  return v;
}
function checkGrant(g,driverGitSha) {
  if (!exact(g,['verified','consumed','operation','driver_git_sha',
                 'candidate_digest','profile_sha256','jti','request_id']) ||
      g.verified !== true || g.consumed !== true ||
      g.operation !== PINS.operation || g.driver_git_sha !== driverGitSha ||
      g.candidate_digest !== PINS.candidate_digest ||
      g.profile_sha256 !== PINS.profile_sha256 ||
      !UUID.test(g.request_id || '') || !UUID.test(g.jti || ''))
    FAIL('verified_consumed_l4_required');
}
/**
 * Source-only transaction COORDINATOR. host methods are capabilities supplied
 * only by a separately reviewed, immutable root driver. This module MUST NOT
 * be used as a standalone root CLI or as a public caller-supplied adapter.
 */
const HOST_METHODS = Object.freeze([
  'acquireExclusiveLock','preflight','prepareDurableRollback',
  'attestRollbackReady','verifyConsumeSignedL4','installVersionedBundle',
  'installExactProfile','attestV2Observation','finalizeJournal',
  'restoreJournal','attestRestored','releaseLock'
]);
async function coordinateSignedRelease(host,driverGitSha) {
  if (!host || HOST_METHODS.some(k => typeof host[k] !== 'function') ||
      !SHA40.test(driverGitSha || '')) FAIL('trusted_root_driver_missing');
  let lease = null, journal = null, writeAttempted = false, committed = false;
  try {
    lease = await host.acquireExclusiveLock(PINS);
    if (!lease || typeof lease.id !== 'string' || lease.id.length < 8)
      FAIL('exclusive_lock_required');
    const before = checkPreflight(await host.preflight(PINS));
    journal = await host.prepareDurableRollback(PINS,before);
    if (!journal || !journal.id || await host.attestRollbackReady(journal) !== true)
      FAIL('durable_recovery_required');
    const permit = await host.verifyConsumeSignedL4(PINS,driverGitSha,journal);
    checkGrant(permit,driverGitSha);
    writeAttempted = true;
    if (await host.installVersionedBundle(PINS,journal) !== true)
      FAIL('bundle_install_failed');
    if (await host.installExactProfile(PINS,journal) !== true)
      FAIL('profile_install_failed');
    const observed = await host.attestV2Observation(PINS,journal);
    if (!observed || observed.mode !== 'READ_ONLY_NO_DEPLOY' ||
        observed.managed_by_universal !== false ||
        observed.production_modified !== false ||
        observed.runtime_restarted !== false ||
        observed.solo_deploy_enabled !== false ||
        observed.legacy_registry_valid !== true)
      FAIL('live_postimage_untrusted');
    if (await host.finalizeJournal(journal) !== true) FAIL('durable_commit_failed');
    committed = true;
    return Object.freeze({
      status:'COMMITTED',operation:PINS.operation,
      candidate_digest:PINS.candidate_digest,request_id:permit.request_id,
      observer_registered:true,managed_for_deployment:false,
      solo_runtime_restarted:false,
    });
  } catch (e) {
    if (journal && writeAttempted && !committed) {
      // If any uncertainty exists (including a journal commit I/O error),
      // root driver must inspect journal state before restoring.
      const result = await host.restoreJournal(PINS,journal);
      if (result !== true || await host.attestRestored(PINS,journal) !== true)
        FAIL('ROLLBACK_FAILED_NEEDS_ROOT_RECOVERY');
    }
    throw e;
  } finally {
    if (lease) await host.releaseLock(lease);
  }
}
module.exports=Object.freeze({PINS,verifySignedPermit,checkPreflight,
  checkGrant,HOST_METHODS,coordinateSignedRelease});
if(require.main===module){
  process.stderr.write('SOURCE_ONLY_NO_CLI_NO_APPROVAL_ISSUER_NO_ROOT_INSTALL\n');
  process.exitCode=64;
}