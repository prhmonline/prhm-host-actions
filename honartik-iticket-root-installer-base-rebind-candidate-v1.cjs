'use strict';

/**
 * SOURCE ONLY, NO APPLY ENTRYPOINT.
 *
 * Trusted facts supplied by the owner after reading the failed installer
 * from the production root console (2026-10-18):
 *  - failed installer SHA:   0f76d3ad65ba267c045dd545d249e0b2083f4aedf8983a109d3ee6446686fa1d
 *  - installer base SHA pin: de924f7319f3656d788ba5d3f89ef2910bf4b0e3f0b8b074e7cd3a534441d5ea
 *  - live base owner SHA:    4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406
 *
 * The output is only a candidate Buffer to be reviewed and independently
 * installed through a TRUSTED, signed one-time approval with rollback.
 * Never execute as root or modify files using this module directly.
 */
const crypto = require('node:crypto');

const ACTION = 'honartik_iticket_root_installer_base_rebind_candidate_v1';
const INSTALLER_SHA = '0f76d3ad65ba267c045dd545d249e0b2083f4aedf8983a109d3ee6446686fa1d';
const OLD_BASE_SHA = 'de924f7319f3656d788ba5d3f89ef2910bf4b0e3f0b8b074e7cd3a534441d5ea';
const LIVE_BASE_SHA = '4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(why) { throw new Error('installer_base_rebind_' + why); }
function assertSha(value) { if (!/^[a-f0-9]{64}$/.test(value || '')) fail('invalid_sha'); }

/**
 * Pure, zero-side-effect source transformation.
 * An exact *single* base property must hold the old SHA; the old hash
 * cannot appear at another site. No other byte or owner pin may change.
 */
function rebindSource(source) {
  if (typeof source !== 'string' || source.length < 100 || source.length > 200000)
    fail('source_size_or_type');
  const matches = [...source.matchAll(/(['"]?)base\1\s*:\s*(['"])([a-f0-9]{64})\2/g)];
  if (matches.length !== 1) fail('base_property_count');
  if (matches[0][3] !== OLD_BASE_SHA) fail('unexpected_base_pin');
  if (source.split(OLD_BASE_SHA).length !== 2) fail('old_pin_duplicate');
  if (source.includes(LIVE_BASE_SHA)) fail('live_pin_already_present');

  const before = source.slice(0, matches[0].index);
  const hit = matches[0][0];
  const after = source.slice(matches[0].index + hit.length);
  const patched = before + hit.replace(OLD_BASE_SHA, LIVE_BASE_SHA) + after;
  if (patched.length !== source.length) fail('size_changed');
  if (patched.split(LIVE_BASE_SHA).length !== 2 || patched.includes(OLD_BASE_SHA))
    fail('postcondition_failed');
  // Independently prove exact one-token edit on the original bytes.
  if (patched.replace(LIVE_BASE_SHA, OLD_BASE_SHA) !== source)
    fail('more_than_one_change');
  return patched;
}

/**
 * An independently authorized root mediator may pass the exact original bytes
 * and the current base bytes for review. No reading/writing of host files here.
 * The installer may contain further stale owner pins: DO NOT INSTALL merely
 * because this function returns. Review all four current owner preimages.
 */
function makeCandidate({installerBytes, baseBytes} = {}) {
  if (!Buffer.isBuffer(installerBytes) || !Buffer.isBuffer(baseBytes))
    fail('byte_inputs_required');
  if (sha256(installerBytes) !== INSTALLER_SHA) fail('installer_preimage_sha_drift');
  if (sha256(baseBytes) !== LIVE_BASE_SHA) fail('base_live_sha_drift');
  const source = installerBytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(installerBytes))
    fail('installer_not_utf8');
  const candidate = Buffer.from(rebindSource(source), 'utf8');
  assertSha(sha256(candidate));
  return Object.freeze({
    action: ACTION,
    installer_before_sha256: INSTALLER_SHA,
    live_base_sha256: LIVE_BASE_SHA,
    installer_after_sha256: sha256(candidate),
    candidate_bytes: candidate,
    production_mutation: false,
    approval_issued: false,
    rollback_required: true,
  });
}

module.exports = Object.freeze({
  ACTION, INSTALLER_SHA, OLD_BASE_SHA, LIVE_BASE_SHA,
  sha256, rebindSource, makeCandidate,
});
