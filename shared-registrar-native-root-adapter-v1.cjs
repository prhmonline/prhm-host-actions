'use strict';

/**
 * Issue #221: BOUNDED NATIVE ROOT ADAPTER CANDIDATE for the existing shared
 * five-field Host Actions registration pathway.
 *
 * NO CLI, HTTP, generic Host Action registration or provider-console bootstrap.
 * This can only be invoked by an independently installed, root-owned dispatcher.
 * Approval is NEVER a boolean or caller-provided metadata: use the live
 * Ed25519 public trust anchor, persisted once-only ledger and fixed action.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const gate=require('./shared-registrar-root-trust-preflight-v1.cjs');
const gateway=require('./prhm-action-registry-gateway-v1.cjs');
const native=require('./shared-registrar-native-filesystem-v1.cjs');
const ROOT='/var/backups/prhm-host-actions-registration';
const RECEIPTS=path.join(ROOT,'l4-execution-receipts');
const fail=x=>{throw Error('registrar_root_adapter_'+x)};
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function safeRootDir(p){
 const st=fs.lstatSync(p);
 if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(p)!==p||
   (st.mode&0o077)!==0||st.uid!==0)fail('trusted_directory_invalid');
}
function rootOnly(){
 if(typeof process.getuid!=='function'||process.getuid()!==0)
  fail('root_required');
 safeRootDir(ROOT);
}
function stablePreimage(){
 const out={};
 for(const [id,expected] of Object.entries(gate.OWNERS)){
  const st=fs.lstatSync(expected.path);
  if(!st.isFile()||st.isSymbolicLink()||
      fs.realpathSync(expected.path)!==expected.path||
      (st.mode&0o022)!==0)fail('owner_unsafe:'+id);
  const bytes=fs.readFileSync(expected.path);
  if(native.HASH(bytes)!==expected.sha256)fail('owner_drift:'+id);
  out[id]={bytes,mode:st.mode&0o777,uid:st.uid,gid:st.gid};
 }
 return out;
}
function mustFunctions(hooks){
 const keys=['readPinnedGitManifest','readPinnedGitSource','readStagedAsset',
   'getPinnedCandidateOwners','reloadAndVerifyHealth','restoreAndVerifyHealth'];
 if(!hooks||keys.some(x=>typeof hooks[x]!=='function'))
   fail('trusted_host_capability_missing');
 return hooks;
}
function createBoundPlan({args,hooks}){
 // Host-owned functions only. Never serialize or accept hooks from an HTTP or
 // MCP user request. Attest all staged assets and immutable Git blobs.
 const f=mustFunctions(hooks);
 const canonical=gateway.canonicalArgs(args);
 if(!canonical)fail('canonical_binding_missing');
 const manifest=f.readPinnedGitManifest({
  repo:'prhmonline/prhm-host-actions',commit:args.manifest_commit,
  project:args.project
 });
 if(!manifest||typeof manifest.path!=='string'||
  !Buffer.isBuffer(manifest.bytes))fail('manifest_missing');
 const pre=stablePreimage();
 const release=gateway.attestRelease({
  manifestBytes:manifest.bytes,expectedManifestSha:args.manifest_sha256,
  sourceCommit:args.source_commit,manifestCommit:args.manifest_commit,
  readOwner:p=>{
   const id=Object.keys(gate.OWNERS).find(x=>gate.OWNERS[x].path===p);
   if(!id)fail('untrusted_owner_path');
   return pre[id].bytes;
  },
  readAsset:p=>f.readStagedAsset(p),
  readGitBlob:(commit,p)=>{
   if(commit!==args.manifest_commit||p!==manifest.path)
     fail('unbound_manifest_blob');
   return manifest.bytes;
  },
  readGitSource:(commit,p)=>{
   if(commit!==args.source_commit)fail('unbound_source_commit');
   return f.readPinnedGitSource({
    repo:'prhmonline/prhm-host-actions',commit,path:p
   });
  }
 });
 if(release.normalized.project!==args.project||
   release.normalized.git_path!==manifest.path)
   fail('manifest_identity_mismatch');
 const candidates=f.getPinnedCandidateOwners({
  repo:'prhmonline/prhm-host-actions',
  sourceCommit:args.source_commit,release
 });
 if(!candidates||Object.keys(candidates).sort().join('|')!==
   native.KEYS.slice().sort().join('|'))fail('candidate_set_invalid');
 const steps=native.KEYS.map(id=>{
  const expect=gate.OWNERS[id];
  const bound=release.normalized.owners[id];
  const bytes=candidates[id];
  if(!bound||bound.path!==expect.path||
     bound.before_sha256!==expect.sha256||
     !Buffer.isBuffer(bytes)||!SHA.test(bound.after_sha256)||
     native.HASH(bytes)!==bound.after_sha256)
    fail('candidate_provenance_or_sha:'+id);
  return {key:id,path:expect.path,beforeSha:expect.sha256,
   afterSha:bound.after_sha256,nextBytes:bytes};
 });
 // Asset contents are bound to the exact immutable source commit.
 // Include every asset in the SAME crash-safe transaction as the four owners.
 const assets=release.normalized.assets.map(a=>{
  if(!/^\/opt\/prhm-agent-selfmaint-exec\/actions\/[a-z0-9][a-z0-9_.-]{2,120}$/.test(a.path))
   fail('asset_destination_untrusted');
  const bytes=f.readPinnedGitSource({
   repo:'prhmonline/prhm-host-actions',commit:args.source_commit,
   path:a.source_path
  });
  if(!Buffer.isBuffer(bytes)||native.HASH(bytes)!==a.sha256)
   fail('asset_pinned_source_mismatch');
  return {path:a.path,afterSha:a.sha256,nextBytes:bytes};
 });
 if(assets.length===0||assets.length>32)fail('asset_set_invalid');
 return Object.freeze({release,plan:{
  schema:'prhm.registrar.native-transaction.v1',
  steps,assets,sourceCommit:args.source_commit,
  manifestSha256:args.manifest_sha256
 }});
}
function reserveReceipt(requestId,argumentSha){
 if(!UUID.test(requestId||'')||!SHA.test(argumentSha||''))
  fail('receipt_identity_invalid');
 // Require a persistent root-owned execution ledger independent from Approval
 // Center's consumed ledger. Never retry a transaction under the same L4.
 try{fs.mkdirSync(RECEIPTS,{mode:0o700});}
 catch(e){if(e.code!=='EEXIST')throw e}
 safeRootDir(RECEIPTS);
 const file=path.join(RECEIPTS,requestId+'.json');
 const fd=fs.openSync(file,'wx',0o600);
 try{
  fs.writeSync(fd,JSON.stringify({requestId,argumentSha,at:new Date().toISOString(),
   state:'CLAIMED_FAIL_CLOSED'})+'\n');
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 const d=fs.openSync(RECEIPTS,fs.constants.O_DIRECTORY|fs.constants.O_RDONLY);
 try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
 return file;
}
async function applyFromTrustedRootDispatcher({args,approvalToken,hooks}={}){
 rootOnly();
 const f=mustFunctions(hooks);
 const bound=createBoundPlan({args,hooks:f});
 // The one-time signed L4 request is bound to the exact canonical tuple and
 // verified against the real root-owned public key AND consumed ledger.
 const approval=gateway.verifyLiveConsumedRegistrationApproval({
  token:approvalToken,args
 });
 if(!approval||approval.action!==gate.ACTION||approval.level!==4||
   approval.risk!=='critical'||!UUID.test(approval.request_id||''))
   fail('signed_authorization_invalid');
 reserveReceipt(approval.request_id,gateway.approvalBindingSha(args));
 let result;
 try{
  result=await native.executeCore(bound.plan,{
   workRoot:ROOT,
   postInstall:async()=>{
    const r=await f.reloadAndVerifyHealth({
     services:gate.SERVICES,action:bound.release.normalized.action,
     project:args.project
    });
    return r===true;
   },
   postRollback:async()=>{
    const r=await f.restoreAndVerifyHealth({
     services:gate.SERVICES,project:args.project
    });
    return r===true;
   }
  });
 }catch(e){throw Error('registration_failed_fail_closed:'+String(e.message))}
 return Object.freeze({ok:true,action:bound.release.normalized.action,
  transaction:result.transaction,sourceCommit:args.source_commit,
  manifestCommit:args.manifest_commit,requestId:approval.request_id});
}
module.exports=Object.freeze({
 ROOT,RECEIPTS,stablePreimage,createBoundPlan,
 applyFromTrustedRootDispatcher
});
if(require.main===module){
 process.stderr.write('No standalone installer: existing trusted L4 Host Actions dispatcher required.\n');
 process.exitCode=64;
}
