'use strict';
/**
 * Offline, source-only assembler of the immutable Agent 3 registration manifest.
 *
 * This is NOT a registry writer, production installer, live attestation or
 * approval issuer. The four proposed patched owner buffers must be supplied
 * by a separately reviewed four-owner patch process. No --apply is available.
 */
const crypto=require('node:crypto');
const gateway=require('../../prhm-action-registry-gateway-v1.cjs');
const registration=require('./registration-contract.cjs');
const {verify}=require('./verify-pinned-owner-preimages.cjs');
const {OWNERS,SERVICES}=require('./four-owner-readonly-preflight.cjs');
const contract=require('./production-registration-contract.json');
const releaseLock=require('./release-lock.json');

const KEYS=Object.freeze(['base','executor','policy','mcp']);
const ASSET_SOURCE='ops/agent3-universal-backup/install-candidate.js';
const ASSET_DEST='/opt/prhm-agent-selfmaint-exec/actions/agent3-backup-installer.cjs';
const MAX_OWNER_BYTES=20*1024*1024;
const MAX_INSTALLER_BYTES=1024*1024;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code){throw Error('agent3_manifest_candidate_denied:'+code);}
function exactKeys(x,keys){
 return x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
}
function build({evidence,proposedOwnerBytes,installerBytes}={}){
 // The incoming evidence is only a read-only preflight claim. The trusted
 // registrar MUST independently re-read owner descriptors at execution time.
 verify({evidence,contract});
 if(!exactKeys(proposedOwnerBytes,KEYS))fail('exact_four_owner_outputs_required');
 if(!Buffer.isBuffer(installerBytes)||!installerBytes.length||
    installerBytes.length>MAX_INSTALLER_BYTES)fail('invalid_installer_bytes');
 if(releaseLock.source_commit_sha!==registration.SOURCE_COMMIT||
    releaseLock.fixed_action!==registration.INSTALL_ACTION||
    releaseLock.target_host!=='prhm-production')fail('release_lock_drift');
 const installerHash=sha(installerBytes);
 if(installerHash!==releaseLock.expected_sha256?.[ASSET_SOURCE])
   fail('installer_source_hash_mismatch');
 const owners={};
 for(const key of KEYS){
  const bytes=proposedOwnerBytes[key];
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>MAX_OWNER_BYTES)
   fail('invalid_proposed_owner_bytes:'+key);
  const before=contract.preimage_sha256[key],after=sha(bytes);
  if(after===before)fail('no_owner_change:'+key);
  owners[key]={path:OWNERS[key],before_sha256:before,after_sha256:after};
 }
 const manifest={
  schema_version:'prhm.action-registry.release.v1',
  project:registration.PROJECT,
  action:registration.INSTALL_ACTION,
  source_commit:registration.SOURCE_COMMIT,
  risk:'critical',
  approval_level:4,
  registry_owners:owners,
  assets:[{path:ASSET_DEST,source_path:ASSET_SOURCE,sha256:installerHash}],
  rollback_required:true,
  health:{services:[...SERVICES],tool:registration.INSTALL_ACTION},
  git_path:registration.EXPECTED_MANIFEST_PATH
 };
 gateway.assertManifest(manifest);
 const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
 return Object.freeze({
  mode:'OFFLINE_UNATTESTED_MANIFEST_CANDIDATE',
  manifest,bytes,sha256:sha(bytes),
  live_preimages_independently_verified:false,
  installed:false,approval_issued:false,approval_consumed:false,
  ready_for_production:false,
  required_next:'Commit manifest separately, pin manifest commit and SHA, then have the authorized registrar independently attest live owners, source Git blobs, staged assets and consumed signed Level-4 approval.'
 });
}
if(require.main===module){
 process.stderr.write('offline library only; no CLI registration or install\n');
 process.exitCode=78;
}
module.exports=Object.freeze({KEYS,ASSET_SOURCE,ASSET_DEST,build});
