'use strict';
/**
 * Issue #217: SOURCE-ONLY fixed 4-owner registration PLAN.
 * This module does not expose a filesystem writer, CLI, approval or root
 * dispatch. An independently reviewed provider-console dispatcher must
 * authenticate an exact L4 registration approval and verify all preimages
 * before calling the separate fs transaction core.
 */
const crypto=require('node:crypto');
const path=require('node:path');
const REG=require('./honartik-universal-installer-registration-review-pack-v1.cjs');
const DISPATCH=require('./honartik-universal-installer-native-dispatch-registration-review-v1.cjs');
const SHA=b=>crypto.createHash('sha256').update(b).digest('hex');
const BLOB=b=>crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const ACTION='honartik_universal_installer_upgrade_v1';
const ASSET_ROOT='/opt/prhm-agent-selfmaint-exec/actions';
const ORDER=Object.freeze(['base','executor','mcp','policy']);
const fail=name=>{throw Error('honartik217_registration_plan_'+name)};
const need=(ok,name)=>{if(!ok)fail(name)};
const PATHS=Object.freeze(Object.fromEntries(ORDER.map(k=>[k,REG.TARGETS[k].path])));
// Trusted root-console preimages re-attested on 2026-10-28; source-only pins.
const EXPECTED_OWNER_META=Object.freeze({
 base:Object.freeze({uid:0,gid:0,mode:0o644}),
 executor:Object.freeze({uid:0,gid:0,mode:0o755}),
 mcp:Object.freeze({uid:0,gid:0,mode:0o600}),
 policy:Object.freeze({uid:0,gid:0,mode:0o644})
});
function readPinnedOwner(readOwners,key){
 const owner=REG.TARGETS[key];
 const bytes=readOwners(owner.path);
 need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=2_000_000,'owner_missing_'+key);
 need(SHA(bytes)===owner.sha256,'owner_sha_drift_'+key);
 return bytes;
}
function makeReviewPlan({readOwners,readOwnerMetadata,readArtifacts,readShim}={}){
 need(typeof readOwners==='function'&&typeof readOwnerMetadata==='function'&&
  typeof readArtifacts==='function'&&typeof readShim==='function','readers_required');
 // All four owner identities and trusted metadata are pinned before any candidate.
 const raw=Object.fromEntries(ORDER.map(k=>[k,readPinnedOwner(readOwners,k)]));
 const ownerMeta=Object.fromEntries(ORDER.map(key=>{
  const m=readOwnerMetadata(REG.TARGETS[key].path);
  need(m&&m.isFile===true&&m.isSymbolicLink===false&&m.nlink===1&&
   Number.isInteger(m.uid)&&m.uid>=0&&Number.isInteger(m.gid)&&m.gid>=0&&
   Number.isInteger(m.mode)&&m.mode>=0&&m.mode<=0o777&&
   (m.mode&0o022)===0,'owner_metadata_untrusted_'+key);
  const expected=EXPECTED_OWNER_META[key];
  need(m.uid===expected.uid&&m.gid===expected.gid&&m.mode===expected.mode,
   'owner_metadata_drift_'+key);
  return [key,Object.freeze({expectedUid:m.uid,expectedGid:m.gid,expectedMode:m.mode})];
 }));
 const reviewed=DISPATCH.previewPinnedProduction(p=>readOwners(p),
  n=>readShim(n));
 need(reviewed.security_boundary?.production_mutation===false&&
  reviewed.security_boundary?.install_authorized===false&&
  reviewed.action===ACTION,'dispatcher_review_drift');
 const policy=REG.proposeLivePolicyReview(raw.policy);
 need(policy.candidate_sha256===REG.RECONCILED_CANDIDATE_POLICY_SHA&&
  policy.matches_current_approval_gate_pin===true,
  'policy_review_drift');
 const artifactRefs=REG.verifyArtifactClosure((name,commit)=>readArtifacts(name,commit));
 const shim=readShim(DISPATCH.SHIM);
 need(Buffer.isBuffer(shim)&&BLOB(shim)===DISPATCH.SHIM_BLOB,'shim_blob_drift');
 const assets=Object.entries(REG.ARTIFACTS).map(([name,blob])=>{
  const bytes=readArtifacts(name,REG.SOURCE_SHA);
  need(Buffer.isBuffer(bytes)&&BLOB(bytes)===blob&&
   artifactRefs[name].git_blob===blob,'asset_source_drift_'+name);
  return Object.freeze({path:path.join(ASSET_ROOT,name),
   afterSha:SHA(bytes),nextBytes:bytes});
 });
 assets.push(Object.freeze({path:path.join(ASSET_ROOT,DISPATCH.SHIM),
  afterSha:SHA(shim),nextBytes:shim}));
 const next=reviewed.proposed_owner_text;
 const steps=Object.freeze(ORDER.map(key=>{
  const bytes=key==='policy'?policy.candidate_policy_bytes:
   Buffer.from(next[key],'utf8');
  need(Buffer.isBuffer(bytes),'candidate_bytes_missing_'+key);
  return Object.freeze({key,path:PATHS[key],
   beforeSha:REG.TARGETS[key].sha256,afterSha:SHA(bytes),nextBytes:bytes,
   ...ownerMeta[key]});
 }));
 // No caller-provided paths, policy, approvals, destination or source commit.
 // This metadata digest is NOT a cryptographic deployment authorization.
 const manifestSha256=SHA(Buffer.from(JSON.stringify({
  action:ACTION,sourceCommit:REG.SOURCE_SHA,
  shimBlob:DISPATCH.SHIM_BLOB,steps:steps.map(s=>[s.key,s.path,s.beforeSha,s.afterSha,
   s.expectedUid,s.expectedGid,s.expectedMode]),
  assets:assets.map(a=>[a.path,a.afterSha])
 })));
 return Object.freeze({
  schema:'prhm.registrar.native-transaction.v1',
  sourceCommit:REG.SOURCE_SHA,manifestSha256,steps,
  assets:Object.freeze(assets),
  registration_action:ACTION,
  review_only:true,
  provider_console_dispatcher_installed:false,
  independently_approved:false,
  live_l4_issued:false,
  production_executable:false
 });
}
module.exports=Object.freeze({
 ACTION,ASSET_ROOT,PATHS,ORDER,EXPECTED_OWNER_META,makeReviewPlan,
 REVIEW_ONLY:true,NO_PRODUCTION_WRITER:true,NO_APPROVAL_ISSUER:true
});
if(require.main===module){
 process.stderr.write('SOURCE_ONLY: independent trusted Root-of-Trust registration required.\n');
 process.exitCode=64;
}
