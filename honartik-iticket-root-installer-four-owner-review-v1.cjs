'use strict';

/**
 * Source-only review candidate, NOT a live installer.
 * This module NEVER opens production paths, executes the helper, grants approval,
 * writes files, or activates a financial flag. It requires independently read
 * trusted bytes for all five known preimages and produces a review-only diff.
 *
 * The expected hashes below were observed from the root-owned failed helper;
 * the live owner hashes were observed from independent on-host SHA256 readings.
 */
const crypto = require('node:crypto');
const INSTALLER_SHA256 = '0f76d3ad65ba267c045dd545d249e0b2083f4aedf8983a109d3ee6446686fa1d';
const ORDER = Object.freeze(['base','exec','policy','mcp']);
const OWNERS = Object.freeze({
  base: Object.freeze({
    path: '/opt/prhm-agent-selfmaint/server.js',
    old: 'de924f7319f3656d788ba5d3f89ef2910bf4b0e3f0b8b074e7cd3a534441d5ea',
    live: '4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
  }),
  exec: Object.freeze({
    path: '/opt/prhm-agent-selfmaint-exec/server.js',
    old: '6bba46890db31abc8eca7e7681753a4788c46170033a555a1106e05d0a7a66f9',
    live: '410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
  }),
  policy: Object.freeze({
    path: '/opt/prhm-company-control-plane/config/approval-policy.json',
    old: '2fedd70a182aa351e269df95a1b9d829f5a0b18defe8871cb4045106948d711a',
    live: '148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
  }),
  mcp: Object.freeze({
    path: '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
    old: '048e2db190c5548f47967447b3b564eefd0b7203cf6df84beb73c520d481633d',
    live: 'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',
  }),
});
const SHA_PROPERTY = /(?:['"]([A-Za-z_][A-Za-z0-9_]*)['"]|([A-Za-z_][A-Za-z0-9_]*))\s*:\s*(['"])([a-f0-9]{64})\3/g;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(why) { throw new Error('four_owner_review_' + why); }

/**
 * Pure textual transform of exactly four verified, known SHA value spans.
 * Every other original source byte is preserved and verified by roundtrip.
 * This intentionally cannot certify what the installer *does* after binding.
 */
function rebindForReview(source) {
  if (typeof source !== 'string' || source.length < 200 || source.length > 200000)
    fail('source_size_or_type');
  const found = [...source.matchAll(SHA_PROPERTY)];
  if (found.length !== 4) fail('four_sha_properties_required');
  const keys = found.map(m => m[1] || m[2]);
  if (new Set(keys).size !== 4 || ORDER.some(k => !keys.includes(k)))
    fail('owner_key_set_invalid');
  for (const m of found) {
    const key = m[1] || m[2];
    if (m[4] !== OWNERS[key].old) fail('expected_owner_pin_drift_' + key);
  }
  for (const key of ORDER) {
    if (source.split(OWNERS[key].old).length !== 2)
      fail('duplicate_expected_owner_pin_' + key);
    if (source.includes(OWNERS[key].live))
      fail('new_owner_pin_already_present_' + key);
  }
  let result = source;
  for (const m of [...found].reverse()) {
    const key = m[1] || m[2];
    const offset = m[0].lastIndexOf(m[4]);
    if (offset < 0) fail('invalid_value_span');
    const start = m.index + offset;
    result = result.slice(0,start) + OWNERS[key].live + result.slice(start + 64);
  }
  if (result.length !== source.length) fail('source_length_changed');
  let reverted = result;
  for (const key of ORDER) {
    if (result.split(OWNERS[key].live).length !== 2 ||
        result.includes(OWNERS[key].old))
      fail('owner_postcondition_' + key);
    reverted = reverted.replace(OWNERS[key].live, OWNERS[key].old);
  }
  if (reverted !== source) fail('unintended_change');
  return result;
}

/**
 * Immutable review evidence only: original installer and four owner bytes must
 * match all five exact SHA256 preimages. No running, writing or signing.
 */
function makeReview({installerBytes, liveOwnerBytes} = {}) {
  if (!Buffer.isBuffer(installerBytes) ||
      !liveOwnerBytes || typeof liveOwnerBytes !== 'object')
    fail('inputs_required');
  if (sha256(installerBytes) !== INSTALLER_SHA256)
    fail('installer_source_sha_drift');
  for (const key of ORDER) {
    if (!Buffer.isBuffer(liveOwnerBytes[key])) fail('owner_bytes_missing_' + key);
    if (sha256(liveOwnerBytes[key]) !== OWNERS[key].live)
      fail('owner_live_sha_drift_' + key);
  }
  const original = installerBytes.toString('utf8');
  if (!Buffer.from(original,'utf8').equals(installerBytes))
    fail('installer_not_utf8');
  const updated = Buffer.from(rebindForReview(original),'utf8');
  if (updated.length !== installerBytes.length) fail('bytes_changed_length');
  return Object.freeze({
    schema: 'prhm.iticket.four-owner-review.v1',
    original_installer_sha256: INSTALLER_SHA256,
    review_candidate_sha256: sha256(updated),
    review_candidate_bytes: updated,
    changed_pins: ORDER.slice(),
    source_only: true,
    install_authorized: false,
    approval_issued: false,
    production_mutation: false,
    pending_semantic_review: true,
    pending_trusted_backup_and_rollback: true,
    pending_signed_one_time_level4_authorization: true,
    pending_independent_mysql_mariadb_payment_gates: true,
  });
}
module.exports = Object.freeze({INSTALLER_SHA256, ORDER, OWNERS, sha256, rebindForReview, makeReview});
