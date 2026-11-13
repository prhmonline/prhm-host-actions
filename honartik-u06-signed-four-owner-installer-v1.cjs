'use strict';
/**
 * First-time U06 four-owner bootstrap, with independently signed owner SSHSIG.
 *
 * This is NOT an Approval Center L4 issuer. This installs the exact U06 action
 * only after a separate, short-lived, owner-signed registration manifest.
 * Every subsequent U06 call still requires the official consumed L4 receipt.
 *
 * Fixed host, four owner files, 15 allowlisted native assets, restricted
 * services, live preimage SHA and cryptographic owner signature. Durable
 * journaling/rollback comes from the existing tested fsync-native transaction
 * engine. No standalone apply CLI, generic Host Action L3 or custom commands.
 *
 * Live root execution is only possible by an explicit trusted operator entry
 * which calls applyOwnerSigned() with the exact pinned Git release bytes.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),cp=require('node:child_process');
const Plan=require('./honartik-u06-real-four-owner-registration-plan-v1.cjs');
const Proof=require('./honartik-u06-owner-signed-bootstrap-proof-v1.cjs');
const Tx=require('./honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs');
const WORK_ROOT='/var/lib/prhm-agent-selfmaint-exec/honartik-u06-bootstrap';
const ACTIONS='/opt/prhm-agent-selfmaint-exec/actions';
const UNIT=Object.freeze([
 'prhm-company-approval.service',
 'prhm-agent-selfmaint-exec.service',
 'prhm-agent-selfmaint.service',
 'prhm-agent-mcp-blue.service',
 'prhm-agent-mcp-green.service'
]);
const RUNTIME_PRIVATE_DIRS=Object.freeze([
 '/var/lib/prhm-agent-selfmaint-exec/honartik-u06-native-root',
 '/var/lib/prhm-agent-selfmaint-exec/honartik-u06-native-root/l4-consumed',
 '/var/lib/prhm-agent-selfmaint-exec/honartik-u06-native-root/owner-oidc',
 '/var/backups/prhm-u06-native',
 '/var/lib/prhm-u06-owner-approvals',
 '/var/lib/prhm-u06-owner-approvals/consumed'
]);
const FIXED=Object.freeze({
 workRoot:WORK_ROOT,action:Plan.A,operation:Plan.OP,host:Proof.PIN.host,
 ownerPaths:Plan.TARGET,sourceAllowlist:Plan.ASSET_NAMES,
 privateRuntimeDirs:RUNTIME_PRIVATE_DIRS,
 namespace:Proof.PIN.namespace,
 policyAfter:Plan.POLICY_SHA
});
const die=x=>{throw Error('u06_signed_bootstrap_'+x)};
const need=(x,e)=>{if(!x)die(e)};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function directory(p,mode,uid){
 const s=fs.lstatSync(p);
 need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===uid&&s.gid===0&&
  (s.mode&0o777)===mode,'untrusted_root_directory');
}
function rootIdentity(){
 need(process.getuid?.()===0&&process.getgid?.()===0&&
  os.hostname()===FIXED.host,'root_host_required');
 directory(ACTIONS,0o755,0);
 const parent=path.dirname(WORK_ROOT);
 const st=fs.lstatSync(parent);
 need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&
  st.gid===0&&(st.mode&0o022)===0,
  'bootstrap_parent_not_root_trusted');
}
function checkPendingIfExists(){
 let present;
 try{fs.lstatSync(WORK_ROOT);present=true}
 catch(e){if(e.code!=='ENOENT')throw e;present=false}
 if(present){
  directory(WORK_ROOT,0o700,0);
  Tx.assertNoPendingTransactions(WORK_ROOT);
 }
}
function createPrivateWorkRootAfterSignature(){
 const parent=path.dirname(WORK_ROOT);
 try{fs.mkdirSync(WORK_ROOT,{mode:0o700})}
 catch(e){if(e.code!=='EEXIST')throw e}
 directory(WORK_ROOT,0o700,0);
 syncDir(parent);
 Tx.assertNoPendingTransactions(WORK_ROOT);
}

function assertTrustedAncestry(file){
 let current=path.dirname(file),n=0;
 while(current!=='/'&&n++<30){
  let st;
  try{st=fs.lstatSync(current)}
  catch(e){if(e.code==='ENOENT'){current=path.dirname(current);continue}
    throw e}
  need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&st.gid===0&&
    (st.mode&0o022)===0,'private_runtime_parent_not_root_owned');
  current=path.dirname(current);
 }
 need(n<30,'private_runtime_ancestry_loop');
}
function assertRuntimeDirsAbsent(){
 for(const item of RUNTIME_PRIVATE_DIRS){
  assertTrustedAncestry(item);
  try{fs.lstatSync(item);die('private_runtime_dir_already_exists')}
  catch(e){if(e.code!=='ENOENT')throw e}
 }
}
function createSignedRuntimeDirs(){
 // This is ONLY called from the post-install callback after owner SSHSIG
 // verification and fsynced Root transaction INSTALLING journal.
 for(const item of RUNTIME_PRIVATE_DIRS){
  assertTrustedAncestry(item);
  let st;
  try{st=fs.lstatSync(item)}
  catch(e){if(e.code!=='ENOENT')throw e}
  need(st===undefined,'unreviewed_runtime_dir_race');
  fs.mkdirSync(item,{mode:0o700});
  directory(item,0o700,0);
  syncDir(path.dirname(item));
 }
}
function pruneEmptyRuntimeDirsAfterRollback(){
 // SIGKILL recovery uses this same strict inverse; never delete files
 // created by another process or any nonempty unverified directory.
 for(const item of [...RUNTIME_PRIVATE_DIRS].reverse()){
  let st;
  try{st=fs.lstatSync(item)}
  catch(e){if(e.code==='ENOENT')continue;throw e}
  directory(item,0o700,0);
  need(fs.readdirSync(item).length===0,
    'rollback_runtime_dir_not_empty_retain_journal');
  fs.rmdirSync(item);
  syncDir(path.dirname(item));
 }
}
function readOwners(){
 return Object.freeze({
  agent_api:fs.readFileSync(Plan.TARGET.base),
  root_executor:fs.readFileSync(Plan.TARGET.executor),
  agent3_mcp:fs.readFileSync(Plan.TARGET.mcp),
  approval_policy:fs.readFileSync(Plan.TARGET.policy)
 });
}
function readAssets(stagedPath){
 need(typeof stagedPath==='string'&&
  stagedPath.startsWith('/var/tmp/u06-owner-reviewed-')&&
  path.isAbsolute(stagedPath)&&fs.realpathSync(stagedPath)===stagedPath,
  'untrusted_staged_source_directory');
 directory(stagedPath,0o700,0);
 const assets={};
 for(const name of Plan.ASSET_NAMES){
  const candidate=path.join(stagedPath,name);
  const st=fs.lstatSync(candidate);
  need(st.isFile()&&!st.isSymbolicLink()&&st.uid===0&&
    st.gid===0&&(st.mode&0o777)===0o600&&st.nlink===1&&
    st.size>30&&st.size<250000,'untrusted_staged_asset');
  assets[name]=fs.readFileSync(candidate);
 }
 return Object.freeze(assets);
}
function review({sourceCommit,stagedPath}){
 rootIdentity();
 const plan=Plan.build({sourceCommit,ownerBuffers:readOwners(),
  assetBuffers:readAssets(stagedPath)});
 Tx.checkPlan(plan);Tx.verifyPreimage(plan.steps);
 Tx.verifyAssetPreimages(plan.assets);
 checkPendingIfExists();
 assertRuntimeDirsAbsent();
 return Object.freeze({schema:'prhm.u06.signed-four-owner-review.v1',
  source_commit:sourceCommit,
  manifest_sha256:plan.manifestSha256,
  owner_post_sha256:plan.signedDigestClosure.postimage_sha256,
  asset_sha256:plan.signedDigestClosure.asset_sha256,
  production_modified:false,owner_signed:false,
  official_level4_issued:false});
}
function generateFreshOwnerSigningRequest({sourceCommit,stagedPath}){
 rootIdentity();
 const p=Plan.build({sourceCommit,ownerBuffers:readOwners(),
  assetBuffers:readAssets(stagedPath)});
 Tx.checkPlan(p);Tx.verifyPreimage(p.steps);
 Tx.verifyAssetPreimages(p.assets);
 checkPendingIfExists();
 assertRuntimeDirsAbsent();
 const now=Date.now();
 return Buffer.from(JSON.stringify({
  schema:'prhm.u06.owner-signed-root-bootstrap.v1',
  host:Proof.PIN.host,action:Proof.PIN.action,
  operation:Proof.PIN.operation,source_commit:sourceCommit,
  policy_post_sha256:Plan.POLICY_SHA,
  preimage_sha256:p.signedDigestClosure.preimage_sha256,
  postimage_sha256:p.signedDigestClosure.postimage_sha256,
  asset_sha256:p.signedDigestClosure.asset_sha256,
  owner_key_fingerprint:Proof.PIN.fp,
  created_utc:new Date(now-5000).toISOString(),
  expires_utc:new Date(now+165000).toISOString(),
  nonce:crypto.randomBytes(32).toString('hex')
 })+'\n');
}
function syncDir(dir){
 const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|
   fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function burnNonce(nonce){
 need(/^[a-f0-9]{64}$/.test(nonce),'owner_nonce_invalid');
 const target=path.join(WORK_ROOT,'signed-owner-'+nonce+'.consumed');
 const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|
  fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{
  fs.writeFileSync(fd,JSON.stringify({schema:'prhm.u06.owner-once-bootstrap.v1',
   action:Plan.A,nonce,state:'CONSUMED_NO_REPLAY'})+'\n');
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 syncDir(WORK_ROOT);
}
function systemctl(operation,unit){
 need(UNIT.includes(unit)&&['restart','is-active'].includes(operation),
  'systemctl_not_fixed');
 const p=cp.spawnSync('/usr/bin/systemctl',[operation,unit],{
  timeout:45000,encoding:'utf8',maxBuffer:8192,
  stdio:['ignore','pipe','pipe']});
 // Failure output deliberately suppressed (service logs may include tokens).
 need(p.status===0&&!p.error&&!p.signal,
  'fixed_systemd_'+operation+'_failed');
 return true;
}
function serviceHealth(){
 for(const unit of UNIT)systemctl('is-active',unit);
 return true;
}
function restartAndHealth(){
 // Restart Approval Center first so new registered L4 policy is available
 // before the Root, API and MCP endpoints begin receiving new U06 requests.
 for(const unit of UNIT)systemctl('restart',unit);
 return serviceHealth();
}
function attestRegistration(postHash){
 for(const [k,file] of Object.entries(Plan.TARGET)){
  const current=fs.readFileSync(file);
  need(sha(current)===postHash[k],'post_install_owner_sha_drift_'+k);
 }
 const policy=JSON.parse(fs.readFileSync(Plan.TARGET.policy));
 need(policy.operations?.[Plan.OP]?.level===4&&
  policy.operations[Plan.OP]?.one_time_use===true&&
  policy.typed_scopes.some(scope=>
    scope.operation===Plan.OP&&scope.action===Plan.A&&
    scope.risk==='critical'),'u06_level4_post_policy_not_registered');
 return true;
}
async function applyOwnerSigned({sourceCommit,stagedPath,manifestBytes,
 signatureArmor}={}){
 rootIdentity();
 need(Buffer.isBuffer(manifestBytes)&&
  typeof signatureArmor==='string','owner_manifest_and_signature_required');
 const plan=Plan.build({sourceCommit,ownerBuffers:readOwners(),
  assetBuffers:readAssets(stagedPath)});
 Tx.checkPlan(plan);Tx.verifyPreimage(plan.steps);
 Tx.verifyAssetPreimages(plan.assets);
 checkPendingIfExists();
 assertRuntimeDirsAbsent();
 const reviewedPackage=plan.signedDigestClosure;
 const m=Proof.canonicalManifest(manifestBytes,reviewedPackage);
 const evidence=Proof.verify({manifestBytes,armor:signatureArmor,
  computed:reviewedPackage});
 need(evidence.independent_owner_ssh_ed25519_verified===true&&
  evidence.runtime_official_level4_still_required===true,
  'independent_owner_bootstrap_signature_missing');
 // No owner signature, no WorkRoot mutation: first time registration
 // must never make a self-issued trust anchor.
 createPrivateWorkRootAfterSignature();
 // An interrupted attempt burns this signed approval and cannot be replayed.
 burnNonce(m.nonce);
 const out=await Tx.executeCore(plan,{
  workRoot:WORK_ROOT,
  postInstall:async()=>{
    createSignedRuntimeDirs();
    return restartAndHealth()&&attestRegistration(
      plan.signedDigestClosure.postimage_sha256);
  },
  postRollback:async()=>{
    const healthy=restartAndHealth();
    pruneEmptyRuntimeDirsAfterRollback();
    return healthy&&Object.entries(Plan.TARGET).every(([k,filename])=>
      sha(fs.readFileSync(filename))===Plan.BEFORE[k]);
  }
 });
 need(out.status==='COMMITTED','root_install_not_committed');
 return Object.freeze({
  schema:'prhm.u06.independent-owner-bootstrap-installed.v1',
  root_registration_committed:true,
  transaction:out.transaction,
  exact_source_commit:sourceCommit,
  official_level4_issued:false,
  native_production_backup_executed:false
 });
}
async function recoverInterruptedInstall({transaction}={}){
 rootIdentity();
 need(typeof transaction==='string'&&
  path.dirname(transaction)===WORK_ROOT&&
  path.basename(transaction).startsWith('txn-'),
  'recovery_transaction_path_invalid');
 return Tx.recoverAfterCrash({
  workRoot:WORK_ROOT,transaction,
  expectedTargets:Object.values(Plan.TARGET),
  expectedAssets:Plan.ASSET_NAMES.map(n=>path.join(ACTIONS,n)),
  postRollback:async()=>{
    const healthy=restartAndHealth();
    pruneEmptyRuntimeDirsAfterRollback();
    return healthy&&Object.entries(Plan.TARGET).every(([k,filename])=>
      sha(fs.readFileSync(filename))===Plan.BEFORE[k]);
  }
 });
}
module.exports=Object.freeze({
 FIXED,review,generateFreshOwnerSigningRequest,
 applyOwnerSigned,recoverInterruptedInstall,
 AUTO_APPLY:false,NO_LEVEL4_ISSUER:true
});
if(require.main===module){
 process.stderr.write('NO DIRECT BOOTSTRAP CLI. Requires independently owner-signed manifest and Root operator.\n');
 process.exitCode=64;
}
