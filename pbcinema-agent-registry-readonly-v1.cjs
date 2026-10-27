'use strict';
/*
 * PBCinema: SOURCE-ONLY candidate for EXISTING Host Actions v2 registry.
 * Never execute this module as an installer and never treat a boolean or
 * caller-controlled JSON as an Ed25519 Level-4 approval.
 *
 * Both application roots are shared with Park Bazar. These two identities
 * MUST remain absent from every write, deploy, DB and file-write allowlist.
 * The only permitted behavior before isolation is metadata-only discovery.
 */
const crypto = require('node:crypto');
const ACTION = 'pbcinema_projects_register_v1';
const ANCHOR = 'const PROJECTS = {';
const SHA = /^[a-f0-9]{64}$/;
const PROJECTS = Object.freeze({
  pbcinema_front_prod: Object.freeze({
    domain: 'pbcinema.ir',
    root: '/home/cfpark/domains/park.prhm.ir/public_html',
  }),
  pbcinema_admin_prod: Object.freeze({
    domain: 'dashboard.pbcinema.ir',
    root: '/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app',
  }),
});
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error('pbcinema_registry_' + code); };
function verifyEvidence(evidence) {
  if (!evidence || evidence.source !== 'trusted_root_preflight' ||
      evidence.writeAllowlistAudit !== 'DENY_ALL_PBCINEMA' ||
      typeof evidence.roots !== 'object' ||
      typeof evidence.vhosts !== 'object' ||
      typeof evidence.permissions !== 'object') fail('preflight_missing');
  for (const [id, record] of Object.entries(PROJECTS)) {
    const root = evidence.roots[id], host = evidence.vhosts[id];
    if (!root || root.exists !== true || root.isDirectory !== true ||
        root.isSymlink !== false || root.realpath !== record.root ||
        !host || host.domain !== record.domain ||
        host.resolvedRoot !== record.root) fail('vhost_or_root_mismatch:' + id);
    const perms = evidence.permissions[id];
    if (!perms || Object.keys(perms).sort().join(',') !==
        'dbWrite,deploy,execWrite,fileWrite,projectWrite' ||
        Object.values(perms).some(value => value !== false))
      fail('shared_root_write_scope_not_denied:' + id);
  }
  return true;
}
function prepareCandidate({ source, expectedSha256, liveEvidence }) {
  if (typeof source !== 'string' || !SHA.test(expectedSha256 || '') ||
      sha256(Buffer.from(source, 'utf8')) !== expectedSha256)
    fail('preimage_sha_mismatch');
  verifyEvidence(liveEvidence);
  if (source.split(ANCHOR).length !== 2) fail('registry_anchor_cardinality');
  for (const id of Object.keys(PROJECTS)) {
    if (source.includes(id)) fail('duplicate_or_ambiguous_project:' + id);
  }
  const entries = Object.entries(PROJECTS).map(([id, record]) =>
    '  ' + id + ': { name: ' + JSON.stringify(id) +
    ', root: ' + JSON.stringify(record.root) +
    ', description: ' + JSON.stringify('PBCinema shared-root metadata only') +
    ', readOnly: true, writeEnabled: false, deploymentEnabled: false, metadataOnly: true },'
  ).join('\n');
  const candidate = source.replace(ANCHOR, ANCHOR + '\n' + entries);
  return Object.freeze({
    action: ACTION,
    state: 'candidate_not_installed',
    expectedSha256,
    candidateSha256: sha256(Buffer.from(candidate, 'utf8')),
    projectIds: Object.keys(PROJECTS),
    writeEnabled: false,
    requiresTrustedInstaller: true,
    requiresConsumedSignedL4: true,
    candidate,
  });
}
module.exports = Object.freeze({ACTION, PROJECTS, sha256, verifyEvidence, prepareCandidate});
