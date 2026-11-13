'use strict';
/**
 * O08 CFPark: source-only, READ-ONLY registrar admission dossier.
 *
 * IMPORTANT: This module cannot install an action, alter an owner, create an
 * approval receipt, change sudoers, or release an application. It accepts
 * independently gathered hash metadata for OFFLINE REVIEW ONLY. The existing
 * signed approval/installer gateway must re-collect owner bytes and attest all
 * SHAs itself before permitting any Level-4 operation.
 */
const ACTION = 'cfpark_front_readonly_attest';
const SOURCE_REPO = 'prhmonline/deploy-control';
const SOURCE_COMMIT = '232e090124657f4637fd9583ea60634f9554b930';
const SOURCE_ASSET = 'assets/cfpark-front-readonly-attestor-v1.sh';
const SOURCE_GIT_BLOB = 'caceb90cf20b760efa465d1e880d71a837931235';
const INSTALL_TARGET = '/usr/local/libexec/deploy-control/cfpark-front-readonly-attestor-v1.sh';
const PROFILE_TARGET = '/etc/deploy-control/projects/cfpark_front.production.json';
const LIVE_ROOT = '/home/cfpark/domains/cfpark.ir/public_html';
const LIVE_SHA = '55edc23883fb08622029611db55173885bf1f41b';
const SOURCE_MAIN_SHA = '94eef70a8a23c6b1ca18bd7c3a445043b1a82a7c';

const OWNERS = Object.freeze({
  base:Object.freeze({
    path:'/opt/prhm-agent-selfmaint/server.js',
    sha256:'57828b344aca1d1fb51e74cc2c64094edb03c5fd86fe68420d7185f0d12b6530'
  }),
  executor:Object.freeze({
    path:'/opt/prhm-agent-selfmaint-exec/server.js',
    sha256:'4c136a210681ee07a45d96d38d91c1253afcce67feed0a9d062f9f14d0557169'
  }),
  policy:Object.freeze({
    path:'/opt/prhm-company-control-plane/config/approval-policy.json',
    sha256:'26359a31efdfe0acde07cc9f4001afddee98efaa206e4528880068bf93c425f5'
  }),
  mcp:Object.freeze({
    path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
    sha256:'0c6a74757696a0d85840a0aec1bc53c91431481024f2be56e4ecb02f789073ef'
  })
});
const FIELDS = Object.freeze([
  'owner_shas','asset_git_blob','helper_installed','profile_installed',
  'fixed_sudo_installed','shared_registry_registered'
]);
function fail(reason){ throw new Error('o08_cfpark_registry_blocked:'+reason); }
function exactKeys(x,keys) {
  if (!x || typeof x!=='object' || Array.isArray(x) ||
      Object.keys(x).sort().join('|')!==keys.slice().sort().join('|')) fail('schema');
}
function reviewInventory(evidence) {
  exactKeys(evidence,FIELDS);
  exactKeys(evidence.owner_shas,Object.keys(OWNERS));
  for(const [name,spec] of Object.entries(OWNERS)){
    if(evidence.owner_shas[name]!==spec.sha256)fail('owner_sha_drift_'+name);
  }
  if(evidence.asset_git_blob!==SOURCE_GIT_BLOB)fail('untrusted_asset_blob');
  for(const field of FIELDS.slice(2)){
    if(typeof evidence[field]!=='boolean')fail('invalid_flag_'+field);
  }
  // The actual signed gateway, never this dossier, is the authority.
  if(evidence.shared_registry_registered===false) {
    return Object.freeze({
      decision:'BLOCKED', reason:'shared_registry_not_installed',
      project:'cfpark_front', action:ACTION,
      installation_authorized:false, production_deploy_authorized:false
    });
  }
  // Even a positive caller-supplied inventory is NOT a signed authorization.
  return Object.freeze({
    decision:'BLOCKED', reason:'signed_l4_receipt_and_native_installer_required',
    project:'cfpark_front', action:ACTION,
    installation_authorized:false, production_deploy_authorized:false
  });
}
function immutableRegistrationSpec() {
  // Declarative proposal only. No commands, filesystem writes, or approval generation.
  return Object.freeze({
    phase:'source_only', decision:'BLOCKED',
    action:ACTION, project:'cfpark_front',
    source_repo:SOURCE_REPO, source_commit:SOURCE_COMMIT,
    source_asset:SOURCE_ASSET, source_blob_sha1:SOURCE_GIT_BLOB,
    install_target:INSTALL_TARGET, install_owner:'root:root',
    install_mode:'0755', run_as:'cfpark', permitted_arguments:0,
    live_root:LIVE_ROOT, live_sha:LIVE_SHA, source_main_sha:SOURCE_MAIN_SHA,
    universal_profile:PROFILE_TARGET,
    required_level:4, requires_fresh_signed_approval:true,
    requires_atomic_rollback:true, install_allowed:false,
    production_deploy_allowed:false
  });
}
module.exports=Object.freeze({
  ACTION, OWNERS, SOURCE_COMMIT, SOURCE_GIT_BLOB, PROFILE_TARGET,
  INSTALL_TARGET, LIVE_ROOT, LIVE_SHA,
  immutableRegistrationSpec, reviewInventory
});
