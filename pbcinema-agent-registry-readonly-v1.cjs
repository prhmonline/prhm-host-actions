'use strict';

/**
 * PBCinema SOURCE ONLY: an Agent /projects response projection.
 *
 * IMPORTANT: This must NEVER add names to the executable PROJECTS registry.
 * The aliases may appear in GET /projects for discovery, but are intentionally
 * unknown to the /run-project, /ops/execute, Safe Files, DB and deploy handlers.
 *
 * Only the EXISTING trusted Host Actions v2 installer can bind this helper to
 * the authenticated GET /projects response. This helper cannot issue approvals,
 * install itself, run a command or modify a filesystem.
 *
 * The historical application roots are shared with Park Bazar. The installer
 * MUST independently attest the CURRENT live Apache vhost and realpath,
 * source SHA, all write-deny allowlists, signed one-time L4 authorization,
 * exact backups and rollback BEFORE using this helper.
 */
const crypto = require('node:crypto');
const ACTION = 'pbcinema_projects_register_v1';
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
const WRITE_CAPABILITIES = Object.freeze([
  'dbWrite', 'deploy', 'execWrite', 'fileWrite', 'projectWrite'
]);
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
function fail(code) { throw new Error('pbcinema_registry_' + code); }
function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function verifyEvidence(evidence) {
  // Data-shape assertions are NOT a trust boundary: a trusted installer MUST
  // independently obtain and authenticate every value. Caller-supplied data
  // must never be treated as Level-4 authorization or owner attestation.
  if (!isObject(evidence) || !isObject(evidence.roots) ||
      !isObject(evidence.vhosts) || !isObject(evidence.permissions) ||
      evidence.writeAllowlistAudit !== 'DENY_ALL_PBCINEMA') fail('preflight_missing');
  for (const [id, spec] of Object.entries(PROJECTS)) {
    const root=evidence.roots[id], vhost=evidence.vhosts[id], perms=evidence.permissions[id];
    if (!isObject(root) || root.exists !== true || root.isDirectory !== true ||
        root.isSymlink !== false || root.realpath !== spec.root ||
        !isObject(vhost) || vhost.domain !== spec.domain ||
        vhost.resolvedRoot !== spec.root)
      fail('live_root_or_vhost_mismatch:' + id);
    if (!isObject(perms) ||
        Object.keys(perms).sort().join('|') !== WRITE_CAPABILITIES.slice().sort().join('|') ||
        Object.values(perms).some(x => x !== false))
      fail('write_denial_unverified:' + id);
  }
  return true;
}

function projectResponseOverlay({response, expectedResponseSha256, evidence}) {
  if (!isObject(response) || response.ok !== true || !isObject(response.projects))
    fail('response_contract_invalid');
  // Exact SHA of the original stable serialized Agent response; the installer
  // must supply this from its independent read-only preflight.
  const original = Buffer.from(JSON.stringify(response), 'utf8');
  if (!SHA.test(expectedResponseSha256 || '') ||
      sha256(original) !== expectedResponseSha256) fail('response_sha_drift');
  verifyEvidence(evidence);
  const records={...response.projects};
  for (const [id,spec] of Object.entries(PROJECTS)) {
    if (Object.prototype.hasOwnProperty.call(records,id))
      fail('executable_or_duplicate_alias:' + id);
    records[id]=Object.freeze({
      name:id, root:spec.root, description:'PBCinema shared-root discovery only',
      discoveryOnly:true, metadataOnly:true, writeEnabled:false, deploymentEnabled:false
    });
  }
  return {...response, projects:records};
}

function prepareCandidate({response, expectedResponseSha256, evidence}) {
  const augmented=projectResponseOverlay({response, expectedResponseSha256, evidence});
  return Object.freeze({
    action:ACTION, state:'source_only_not_installed',
    projectIds:Object.keys(PROJECTS),
    writesEnabled:false, requiresConsumedSignedL4:true,
    requiresExistingAtomicInstaller:true,
    originalSha256:expectedResponseSha256,
    augmentedSha256:sha256(Buffer.from(JSON.stringify(augmented), 'utf8')),
    // The complete projected /projects response is returned for unit testing,
    // NEVER as executable PROJECTS registry source code.
    projectedResponse:augmented
  });
}

module.exports=Object.freeze({
  ACTION, PROJECTS, WRITE_CAPABILITIES, sha256, verifyEvidence,
  projectResponseOverlay, prepareCandidate
});
