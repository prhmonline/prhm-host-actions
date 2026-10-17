'use strict';
/**
 * Read-only Agent 3 native registrar RELEASE AUDIT (NOT an installer).
 * Detects candidate/immutable-source drift that hosted unit tests alone
 * cannot establish. Never calls Approval Center, changes a Git ref, writes
 * host files, invokes sudo, registers an action or consumes a signed receipt.
 * A GREEN source audit is NOT production readiness: live root verification,
 * exact postimage manifest, signed Level-4 and rollback remain independent.
 */
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const lock=require('./release-lock.json');
const contract=require('./production-registration-contract.json');
const registration=require('./registration-contract.cjs');
const root=path.resolve(__dirname,'..','..');
const FILES=Object.freeze([
 'ops/agent3-universal-backup/native-five-field-base-v3-postimage.cjs',
 'ops/agent3-universal-backup/native-five-field-executor-v3-handlers.cjs',
 'ops/agent3-universal-backup/native-v3-root-route-binding.cjs',
 'ops/agent3-universal-backup/native-v3-root-http-bridge.cjs',
 'ops/agent3-universal-backup/native-v3-dedicated-unix-boundary.cjs',
 'ops/agent3-universal-backup/native-root-request-entrypoints.cjs',
 'ops/agent3-universal-backup/native-five-field-mcp-policy-patch.cjs',
 'ops/agent3-universal-backup/native-v3-signed-approval-protocol.cjs'
]);
const MANIFEST='ops/agent3-universal-backup/registry-release-manifest.json';
const FULL_SHA=/^[a-f0-9]{40}$/;
const HASH=/^[a-f0-9]{64}$/;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function git(args) {
 const r=cp.spawnSync('git',args,{cwd:root,encoding:null,
  timeout:12000,maxBuffer:3*1024*1024,shell:false});
 if(r.error||r.signal||r.status!==0)return null;
 return Buffer.from(r.stdout);
}
function validateManifest(bytes){
 if(!Buffer.isBuffer(bytes))
  return Object.freeze({schema_valid:false,preimages_matched:false});
 try{
  // Presence is not provenance. Verify the complete shared manifest schema
  // and the four current, independently pinned Root owner preimages.
  const {release}=registration.verifyReviewedManifest({bytes,gitPath:MANIFEST});
  const pins=contract.preimage_sha256||{};
  const keys=['base','executor','policy','mcp'];
  return Object.freeze({
   schema_valid:true,
   preimages_matched:keys.every(key=>
    release.owners[key]?.before_sha256===pins[key])
  });
 }catch{
  return Object.freeze({schema_valid:false,preimages_matched:false});
 }
}
function pinnedState(){
 const commit=lock.source_commit_sha;
 const head=git(['rev-parse','--verify','HEAD']);
 const ancestor=FULL_SHA.test(commit)&&
  git(['merge-base','--is-ancestor',commit,'HEAD'])!==null;
 const sourceMatchesContract=commit===registration.SOURCE_COMMIT;
 const assets=Object.entries(lock.expected_sha256||{}).map(([name,hash])=>{
  // Inputs are defined only by the reviewed local release-lock, NOT by a user.
  if(typeof name!=='string'||name.startsWith('/')||name.includes('..')||
     !HASH.test(hash))return {path:name,matched:false};
  const bytes=git(['show',commit+':'+name]);
  return {path:name,matched:!!bytes&&sha(bytes)===hash};
 });
 const native=FILES.map(name=>{
  const atPin=FULL_SHA.test(commit)?git(['show',commit+':'+name]):null;
  const current=fs.readFileSync(path.join(root,name));
  return {path:name,present_in_immutable_source:!!atPin,
   matches_current:!!atPin&&sha(atPin)===sha(current)};
 });
 const manifestAtHead=git(['show','HEAD:'+MANIFEST]);
 const manifestAssessment=validateManifest(manifestAtHead);
 return Object.freeze({
  head:head?.toString('utf8').trim()||null,
  pinned_source_commit:commit,
  pin_is_ancestor:ancestor,
  source_lock_matches_registrar:sourceMatchesContract,
  assets,native,manifest_committed:Buffer.isBuffer(manifestAtHead),
  manifest_schema_valid:manifestAssessment.schema_valid,
  manifest_preimage_pins_match:manifestAssessment.preimages_matched,
  registration_candidate_not_applied:contract.status==='registration_candidate_not_applied',
  release_status_candidate_not_installed:lock.status==='candidate_not_installed',
  // A mutable Git JSON flag can never attest the running trusted Root
  // dispatcher, Linux peer credentials, or a signed independent review.
  // The live verifier is not integrated; reject any claimed apply enablement.
  native_root_dispatch_reviewed:false,
  untrusted_registration_can_apply_claim:contract.registration_can_apply===true
 });
}
function assess(facts){
 const blockers=[];
 if(!FULL_SHA.test(facts.pinned_source_commit||'')||
    !facts.pin_is_ancestor)blockers.push('IMMUTABLE_SOURCE_NOT_ANCESTOR');
 if(!facts.source_lock_matches_registrar)
   blockers.push('SOURCE_COMMIT_REGISTRATION_DRIFT');
 for(const item of facts.assets||[])
  if(!item.matched)blockers.push('SOURCE_ASSET_SHA_MISMATCH:'+item.path);
 for(const item of facts.native||[]){
  if(!item.present_in_immutable_source)
   blockers.push('NATIVE_SOURCE_ABSENT_AT_RELEASE_PIN:'+item.path);
  else if(!item.matches_current)
   blockers.push('NATIVE_SOURCE_DRIFT:'+item.path);
 }
 if(!facts.manifest_committed)
  blockers.push('FOUR_OWNER_RELEASE_MANIFEST_MISSING');
 else if(facts.manifest_schema_valid!==true)
  blockers.push('FOUR_OWNER_RELEASE_MANIFEST_INVALID');
 else if(facts.manifest_preimage_pins_match!==true)
  blockers.push('FOUR_OWNER_PREIMAGE_PIN_MISMATCH');
 if(facts.native_root_dispatch_reviewed!==true)
  blockers.push('TRUSTED_NATIVE_ROOT_DISPATCH_NOT_REVIEWED');
 if(facts.untrusted_registration_can_apply_claim===true)
  blockers.push('UNVERIFIED_ROOT_DISPATCH_CONFIGURATION_CLAIM');
 if(!facts.registration_candidate_not_applied||
    !facts.release_status_candidate_not_installed)
  blockers.push('UNEXPECTED_LIVE_STATUS_CLAIM');
 return Object.freeze({
  schema:'prhm.agent3.native-registry-readiness-audit.v1',
  mode:'READ_ONLY_LOCAL_GIT_SOURCE_AUDIT',
  source_candidate_complete:blockers.length===0,
  source_blockers:Object.freeze(blockers),
  live_root_attested:false,
  level4_signed_and_consumed:false,
  four_owner_rollback_verified:false,
  production_install_authorized:false,
  production_mutation:false
 });
}
if(require.main===module){
 try{
  const report=assess(pinnedState());
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  // Audit is successful if it truthfully emits NO-GO; installed readiness
  // is never inferred from test exit status.
 }catch(e){
  process.stderr.write('native_registry_release_audit_error:'+e.message+'\n');
  process.exitCode=78;
 }
}
module.exports=Object.freeze({FILES,MANIFEST,validateManifest,pinnedState,assess});
