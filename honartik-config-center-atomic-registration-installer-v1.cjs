'use strict';
/**
 * SOURCE-ONLY registration installer candidate. Import only from an already
 * authorized, root-owned bootstrap mediator after signed, one-time Level-4
 * approval. There is deliberately NO CLI apply mode and NO agent endpoint.
 *
 * Per-file atomic replacement + durable preimage backups + exact rollback.
 * No database, website, credential, SMS, payment or booking writes.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const registry=require('./honartik-config-center-registration-candidate-v1.cjs');
const manifest=require('./honartik-config-center-install-manifest-v1.json');
const ACTION='honartik_config_center_registration_install_v1';
const BACKUP_ROOT='/var/backups/prhm-honartik-config-center-registration-v1';
const STAGE_ROOT='/opt/prhm-agent-selfmaint-exec/staged/honartik-config-center-v1';
const KEYS=Object.freeze(['base','executor','policy','mcp']);
const SERVICES=Object.freeze([
 'prhm-agent-selfmaint.service',
 'prhm-agent-selfmaint-exec.service',
 'prhm-agent-mcp-blue.service',
 'prhm-agent-mcp-green.service'
]);
const hex=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(code){throw new Error(code)}
function exactly(cond,code){if(!cond)fail(code)}
function validateApproval(proof,manifestHash){
 exactly(proof&&typeof proof==='object'&&!Array.isArray(proof),'trusted_l4_proof_absent');
 const permitted=['action','risk','level','verified_by_trusted_mediator','one_time_token_consumed',
  'second_confirmation_valid','request_id','manifest_sha256','source_commit_sha'];
 exactly(Object.keys(proof).sort().join(',')===permitted.sort().join(','),'approval_fields_unexpected');
 exactly(proof.action===ACTION&&proof.risk==='critical'&&proof.level===4&&
  proof.verified_by_trusted_mediator===true&&proof.one_time_token_consumed===true&&
  proof.second_confirmation_valid===true,'trusted_l4_proof_invalid');
 exactly(typeof proof.request_id==='string'&&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proof.request_id),
  'approval_request_id_invalid');
 exactly(proof.manifest_sha256===manifestHash,'approval_manifest_hash_drift');
 exactly(typeof proof.source_commit_sha==='string'&&/^[0-9a-f]{40}$/i.test(proof.source_commit_sha),
  'approval_source_commit_invalid');
 return Object.freeze({...proof});
}
function readRegular(io,file,expected,owner=null){
 const st=io.lstatSync(file);
 exactly(st.isFile()&&!st.isSymbolicLink()&&io.realpathSync(file)===file,'file_not_regular:'+path.basename(file));
 exactly((st.mode&0o022)===0&&st.size>0&&st.size<4000000,'file_mode_or_size_unsafe:'+path.basename(file));
 if(owner!==null)exactly(st.uid===owner,'file_owner_drift:'+path.basename(file));
 const fd=io.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let b;
 try{
  const post=io.fstatSync(fd);
  exactly(post.isFile()&&post.dev===st.dev&&post.ino===st.ino&&
    post.size===st.size&&post.uid===st.uid&&post.gid===st.gid,
    'file_replaced_during_read:'+path.basename(file));
  b=io.readFileSync(fd);
 }finally{io.closeSync(fd)}
 exactly(Buffer.isBuffer(b)&&b.length===st.size&&hex(b)===expected,
  'file_digest_mismatch:'+path.basename(file));
 return {path:file,bytes:b,sha256:expected,uid:st.uid,gid:st.gid,mode:st.mode&0o777};
}
function validateManifest(){
 exactly(manifest.schema_version==='prhm.honartik.config-center-registration.v1'&&
  manifest.action===registry.ACTION&&manifest.assets.length===5,
  'manifest_contract_invalid');
 exactly(Object.keys(manifest.control_plane_preimages).sort().join(',')===KEYS.slice().sort().join(','),
  'manifest_owner_keys_invalid');
 for(const key of KEYS){
  const got=manifest.control_plane_preimages[key],want=registry.LIVE[key];
  exactly(got?.path===want.path&&got.sha256===want.sha256,'manifest_owner_pin_drift:'+key);
 }
 const targets=new Set();
 for(const asset of manifest.assets){
  exactly(asset.source===path.posix.normalize(asset.source)&&!asset.source.startsWith('/')&&
    !asset.source.startsWith('../')&&asset.target===
       '/opt/prhm-agent-selfmaint-exec/actions/'+path.basename(asset.source)&&
    /^[a-f0-9]{64}$/.test(asset.sha256),'manifest_asset_path_or_pin_invalid');
  exactly(!targets.has(asset.target),'manifest_duplicate_target');
  targets.add(asset.target);
 }
 return true;
}
function assertBackupRoot(io){
 const st=io.lstatSync(BACKUP_ROOT);
 exactly(st.isDirectory()&&!st.isSymbolicLink()&&io.realpathSync(BACKUP_ROOT)===BACKUP_ROOT&&
  st.uid===0&&(st.mode&0o077)===0,'backup_root_unsafe');
}
function syncFile(io,file){
 exactly(typeof io.fsyncSync==='function','fsync_interface_missing');
 const fd=io.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{io.fsyncSync(fd)}finally{io.closeSync(fd)}
}
function assertParent(io,file){
 const dir=path.dirname(file);
 exactly(io.realpathSync(dir)===dir,'target_parent_symlink');
 const st=io.lstatSync(dir);
 exactly(st.isDirectory()&&st.uid===0&&(st.mode&0o022)===0,'target_parent_unsafe');
}
function planInstallation({io=fs,sourceRoot=STAGE_ROOT}={}){
 validateManifest();
 exactly(sourceRoot===STAGE_ROOT,'untrusted_stage_root');
 const current={};
 for(const key of KEYS){
  const pin=manifest.control_plane_preimages[key];
  assertParent(io,pin.path);
  current[key]=readRegular(io,pin.path,pin.sha256);
 }
 const outputs=registry.buildCandidates(filename=>{
  const key=KEYS.find(k=>manifest.control_plane_preimages[k].path===filename);
  exactly(!!key,'unexpected_preimage_reader');
  return current[key].bytes;
 });
 const assets=[];
 for(const entry of manifest.assets){
  const staged=path.join(STAGE_ROOT,entry.source);
  assertParent(io,staged);assertParent(io,entry.target);
  const source=readRegular(io,staged,entry.sha256,0);
  let existing=false;
  try{io.lstatSync(entry.target);existing=true}catch(e){if(e.code!=='ENOENT')throw e}
  exactly(!existing,'asset_target_already_exists:'+path.basename(entry.target));
  assets.push({target:entry.target,bytes:source.bytes,expected:entry.sha256,
    uid:0,gid:0,mode:0o644,before:null});
 }
 const registryFiles=KEYS.map(key=>({
  target:current[key].path,bytes:Buffer.from(outputs.sources[key],'utf8'),
  expected:outputs.output_sha256[key],uid:current[key].uid,gid:current[key].gid,
  mode:current[key].mode,before:current[key]
 }));
 return Object.freeze({
  schema:'prhm.honartik.config-center.install-plan.v1',action:ACTION,
  sourceRoot:STAGE_ROOT,
  inputSha256:outputs.input_sha256,outputSha256:outputs.output_sha256,
  changes:Object.freeze([...assets,...registryFiles]),
  proofOnly:true,productionMutation:false
 });
}
function assertStillOriginal(io,file){
 assertParent(io,file.target);
 if(file.before){
  const present=readRegular(io,file.target,file.before.sha256);
  exactly(present.uid===file.before.uid&&present.gid===file.before.gid&&
    present.mode===file.before.mode,'owner_or_mode_drift');
 }else{
  try{io.lstatSync(file.target);fail('asset_appeared_before_write')}
  catch(e){if(e.code!=='ENOENT')throw e}
 }
}
function atomicReplace(io,entry,nonce){
 assertParent(io,entry.target);
 const tmp=path.join(path.dirname(entry.target),'.'+path.basename(entry.target)+'.honartik-'+nonce+'.tmp');
 let created=false;
 try{
  io.writeFileSync(tmp,entry.bytes,{flag:'wx',mode:entry.mode});created=true;
  io.chownSync(tmp,entry.uid,entry.gid);
  io.chmodSync(tmp,entry.mode);
  syncFile(io,tmp);
  io.renameSync(tmp,entry.target);created=false;
 }finally{
  if(created)try{io.unlinkSync(tmp)}catch{}
 }
}
function verifyCurrentInstalled(io,file){
 const out=readRegular(io,file.target,file.expected);
 exactly(out.uid===file.uid&&out.gid===file.gid&&out.mode===file.mode,
   'postwrite_owner_or_mode_drift');
}
function recover(io,changed,backupDir,{restart,health}){
 const problems=[];
 for(const entry of changed.slice().reverse()){
  try{
   let snapshot;
   try{snapshot=readRegular(io,entry.target,entry.expected)}
   catch(e){
    // A pre-write error may leave original untouched.
    if(entry.before){
     const original=readRegular(io,entry.target,entry.before.sha256);
     if(original.uid===entry.before.uid&&original.gid===entry.before.gid&&
       original.mode===entry.before.mode)continue;
    }else{
     try{io.lstatSync(entry.target)}catch(err){if(err.code==='ENOENT')continue}
    }
    throw e;
   }
   if(entry.before){
    const key=KEYS.find(k=>registry.LIVE[k].path===entry.target);
    exactly(!!key,'rollback_owner_not_pinned');
    const saved=readRegular(io,path.join(backupDir,key+'.bak'),
      entry.before.sha256,0);
    const restore={...entry,bytes:saved.bytes,expected:entry.before.sha256,
      uid:entry.before.uid,gid:entry.before.gid,mode:entry.before.mode};
    atomicReplace(io,restore,'rollback-'+key);
    verifyCurrentInstalled(io,restore);
   }else{
    io.unlinkSync(entry.target);
    try{io.lstatSync(entry.target);fail('asset_still_present')}
    catch(e){if(e.code!=='ENOENT')throw e}
   }
 }catch(e){problems.push(path.basename(entry.target)+':'+String(e.message))}
 }
 if(changed.length){
  for(const service of SERVICES)try{restart(service);health(service)}catch(e){
   problems.push('service_health:'+service+':'+String(e.message))
  }
 }
 return {verified:problems.length===0,errors:problems};
}
function executeTransactionCore(plan,{approval,manifestBytes,sourceSha,io=fs,restart,health}={}){
 // No external /apply handler or command line. A separately authorized
 // registrar must verify the actual signed receipt and pass one-time proof.
 exactly(typeof restart==='function'&&typeof health==='function','service_callbacks_missing');
 exactly(Buffer.isBuffer(manifestBytes),'manifest_attested_bytes_required');
 exactly(manifestBytes.toString('utf8')===JSON.stringify(manifest,null,2)+'\n',
  'manifest_file_bytes_mismatch');
 const proof=validateApproval(approval,hex(manifestBytes));
 exactly(sourceSha===proof.source_commit_sha,'manifest_source_sha_unbound');
 exactly(plan&&plan.action===ACTION&&plan.proofOnly===true&&
  plan.productionMutation===false&&plan.changes?.length===9,'plan_invalid');
 const backupDir=path.join(BACKUP_ROOT,proof.request_id);
 const changed=[];
 // Read-only recheck immediately before first mutation.
 for(const f of plan.changes)assertStillOriginal(io,f);
 assertBackupRoot(io); // pre-provisioned private root-owned backup root
 io.mkdirSync(backupDir,{recursive:false,mode:0o700});
 try{
  // All four original bytes preserved before touching *any* target.
  for(const file of plan.changes.filter(x=>x.before)){
   const key=KEYS.find(k=>registry.LIVE[k].path===file.target);
   const data={...file.before,key};
   const backup=path.join(backupDir,key+'.bak');
   io.writeFileSync(backup,data.bytes,{flag:'wx',mode:0o600});
   io.chownSync(backup,0,0);
   io.chmodSync(backup,0o600);
   syncFile(io,backup);
   readRegular(io,backup,data.sha256,0);
  }
  for(let i=0;i<plan.changes.length;i++){
   const entry=plan.changes[i];
   assertStillOriginal(io,entry);
   changed.push(entry); // account for rename-then-exception cases
   atomicReplace(io,entry,proof.request_id.slice(0,8)+'-'+i);
   verifyCurrentInstalled(io,entry);
  }
  for(const service of SERVICES){restart(service);health(service)}
  const result=Object.freeze({ok:true,action:ACTION,requestId:proof.request_id,
   status:'registered',services:SERVICES.slice(),installedAssets:5,updatedOwners:4,
   rollback:'not_needed',productionSiteModified:false,credentialIssued:false});
  io.writeFileSync(path.join(backupDir,'result.json'),JSON.stringify(result)+'\n',
    {flag:'wx',mode:0o600});
  return result;
 }catch(e){
  const restore=recover(io,changed,backupDir,{restart,health});
  const result={ok:false,action:ACTION,requestId:proof.request_id,status:'failed',
   rollback:restore.verified?'verified':'unverified',errors:restore.errors,
   productionSiteModified:false,credentialIssued:false};
  try{io.writeFileSync(path.join(backupDir,'result.json'),JSON.stringify(result)+'\n',
    {flag:'wx',mode:0o600})}catch{}
  fail(restore.verified?'installation_failed_rolled_back':'installation_failed_rollback_unverified');
 }
}
function executeAfterTrustedApproval({approvalToken,manifestBytes,sourceSha,restart,health}={}){
 // Public installer entrypoint: cryptographically verify real Approval Center
 // Ed25519 proof *and* its persisted one-time consumption receipt. A caller-
 // invented object with verified_by_trusted_mediator=true is not accepted.
 // The fixed trusted bootstrap must perform the actual signed Level-4
 // request/authorize-consume BEFORE calling this method.
 exactly(Buffer.isBuffer(manifestBytes),'manifest_attested_bytes_required');
 exactly(typeof approvalToken==='string'&&approvalToken.length>120,'signed_approval_token_required');
 exactly(typeof sourceSha==='string'&&/^[a-f0-9]{40}$/i.test(sourceSha),'reviewed_commit_sha_required');
 exactly(typeof restart==='function'&&typeof health==='function','service_callbacks_missing');
 const {verifyAlreadyConsumedFromLive}=require('./honartik-config-center-signed-registration-approval-v1.cjs');
 const approval=verifyAlreadyConsumedFromLive({
  token:approvalToken,manifestSha:hex(manifestBytes),commitSha:sourceSha,
  nowSec:Math.floor(Date.now()/1000)
 });
 // No caller-supplied file plan, filesystem, source root, key, clock or policy.
 const plan=planInstallation({io:fs,sourceRoot:STAGE_ROOT});
 return executeTransactionCore(plan,{
  approval,manifestBytes,sourceSha,io:fs,restart,health
 });
}
/**
 * Compatibility entry for a separately attested and installed shared-registry
 * executor. Never accepts boolean approval or caller-provided authorization.
 * A real Ed25519+consumed five-field registry receipt is independently checked.
 */
function executeAfterSharedRegistryApproval({approvalToken,args,release,readPinnedManifest,
    restart,health}={}) {
 const shared=require('./prhm-action-registry-gateway-v1.cjs');
 exactly(typeof approvalToken==='string'&&approvalToken.length>120,
   'shared_signed_token_required');
 exactly(args&&release&&release.normalized&&
   args.action===shared.ACTION&&args.project==='honartik'&&
   release.normalized.project==='honartik'&&
   release.normalized.action===registry.ACTION&&
   release.source_commit===args.source_commit&&
   release.manifest_commit===args.manifest_commit&&
   release.manifest_sha256===args.manifest_sha256&&
   typeof restart==='function'&&typeof health==='function'&&
   typeof readPinnedManifest==='function','shared_registration_binding_invalid');
 // Require the Git commit's original reviewed project manifest, not an
 // untrusted manifest supplied in the API request.
 const localBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
 const gitBytes=readPinnedManifest(args.source_commit,
   'honartik-config-center-install-manifest-v1.json');
 exactly(Buffer.isBuffer(gitBytes)&&gitBytes.equals(localBytes),
   'project_manifest_git_source_mismatch');
 exactly(release.normalized.assets.length===manifest.assets.length,
   'shared_asset_set_mismatch');
 for(const a of manifest.assets){
   const hit=release.normalized.assets.filter(x=>x.path===a.target);
   exactly(hit.length===1&&hit[0].source_path===a.source&&
     hit[0].sha256===a.sha256,'shared_asset_pin_mismatch');
 }
 for(const key of KEYS){
   const prior=release.normalized.owners[key];
   exactly(prior.path===manifest.control_plane_preimages[key].path&&
     prior.before_sha256===manifest.control_plane_preimages[key].sha256,
     'shared_owner_pin_mismatch');
 }
 const verified=shared.verifyLiveConsumedRegistrationApproval({token:approvalToken,args});
 exactly(verified.action===shared.ACTION&&verified.operation===shared.OPERATION&&
   verified.source_commit===args.source_commit&&
   verified.manifest_sha256===args.manifest_sha256&&
   verified.arguments_sha256===shared.approvalBindingSha(args),
   'shared_cryptographic_proof_mismatch');
 // Derivation only AFTER the real shared receipt was cryptographically proven.
 // This deliberately adapts to the existing fixed installer contract; it does
 // not mint an Approval Center signature or consume a second authorization.
 const scopedProof=Object.freeze({
   action:ACTION,risk:'critical',level:4,
   verified_by_trusted_mediator:true,one_time_token_consumed:true,
   second_confirmation_valid:true,request_id:verified.request_id,
   manifest_sha256:hex(localBytes),source_commit_sha:args.source_commit
 });
 const plan=planInstallation({io:fs,sourceRoot:STAGE_ROOT});
 for(const key of KEYS){
   const entry=plan.changes.find(x=>x.target===registry.LIVE[key].path);
   exactly(entry&&hex(entry.bytes)===release.normalized.owners[key].after_sha256,
     'shared_generated_owner_sha_mismatch');
 }
 return executeTransactionCore(plan,{
   approval:scopedProof,manifestBytes:localBytes,sourceSha:args.source_commit,
   io:fs,restart,health
 });
}
function selftest(){
 validateManifest();
 return {ok:true,action:ACTION,applyAvailable:false,productionMutation:false,
  requiredLevel:4,requiredAssets:5,requiredOwnerPreimages:4};
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--selftest'){
  process.stderr.write('FAIL_CLOSED_NO_CLI_APPLY\n');process.exitCode=78;
 }else process.stdout.write(JSON.stringify(selftest())+'\n');
}
module.exports=Object.freeze({ACTION,BACKUP_ROOT,STAGE_ROOT,SERVICES,KEYS,
 validateApproval,readRegular,validateManifest,planInstallation,
 assertStillOriginal,atomicReplace,verifyCurrentInstalled,recover,
 executeTransactionCore,executeAfterTrustedApproval,executeAfterSharedRegistryApproval,
 selftest,hex});
