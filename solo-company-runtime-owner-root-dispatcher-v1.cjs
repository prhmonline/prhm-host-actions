'use strict';
/**
 * OWNER-GOVERNED Solo root registration candidate. NOT installed.
 *
 * The only Production write path requires:
 *   root; clean source-attested fixed Git checkout; current owner-signed
 *   SHA-specific review waiver; one-use owner-issuer EdDSA L4 receipt
 *   containing the exact SHA+metadata six-file plan; durable consumed marker;
 *   root-owned journal directory; fixed service health before/after.
 * Owner is not Provider. No private key, signer, user-selected file or shell.
 *
 * One execution may restart control-plane units, never the Solo daemon.
 * Separate crash recovery only restores a transaction with a previously
 * consumed permit and exact compiled-in six-file destination allowlist.
 */
const fs=require('node:fs');
const cp=require('node:child_process');
const path=require('node:path');
const crypto=require('node:crypto');
const owner=require('./solo-company-runtime-owner-root-admission-v1.cjs');
const receipt=require('./solo-company-runtime-provider-signed-receipt-v1.js');
const tx=require('./solo-company-runtime-signed-registration-transaction-v1.js');
const bridge=require('./solo-company-runtime-native-registration-bridge-v1.js');
const native=require('./honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs');
const planSource=require('./solo-company-runtime-owner-plan-readonly-v1.cjs');
const cutover=require('./solo-company-runtime-root-cutover-contract-v1.cjs');
const health=require('./solo-company-runtime-root-live-health-v1.cjs');

const WORK_ROOT='/var/lib/prhm-agent-selfmaint-exec/solo-owner-root-transactions-v1';
const LEDGER='/var/lib/prhm-agent-selfmaint-exec/solo-owner-root-receipts-v1';
const RECEIPT_FILE='/root/prhm-solo-trust-evidence/registration-l4.jws';
const SYSTEMCTL='/usr/bin/systemctl';
const fail=s=>{throw Error('solo_owner_driver_'+s)};
const ensureRoot=()=>{
  if(process.getuid()!==0||process.geteuid()!==0)fail('root_required');
};
function readRootFile(file,mode=0o600){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(file)!==file||
    st.uid!==0||st.gid!==0||(st.mode&0o777)!==mode)
    fail('unsafe_root_input');
  if(st.size<1||st.size>32768)fail('root_input_size_invalid');
  return fs.readFileSync(file);
}
function rootDirectory(dir){
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(dir)!==dir||
    st.uid!==0||st.gid!==0||(st.mode&0o777)!==0o700)
    fail('root_directory_unsafe');
  return true;
}
function requestIdFromToken(token){
  if(typeof token!=='string'||token.split('.').length!==3)
    fail('receipt_format_invalid');
  const payload=token.split('.')[1];
  if(!/^[A-Za-z0-9_-]+$/.test(payload))fail('receipt_encoding_invalid');
  let obj;
  try{obj=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'))}
  catch{fail('receipt_claims_malformed')}
  // This is untrusted until verifyOwnerReceipt authenticates all claims.
  if(!receipt.UUID.test(obj?.request_id||''))fail('request_id_invalid');
  return obj.request_id;
}
function restartFixedService(unit){
  if(!cutover.STEPS.some(x=>x.unit===unit))fail('restart_not_allowlisted');
  const cmd=cp.spawnSync(SYSTEMCTL,['restart',unit],{
    encoding:'utf8',timeout:60000,maxBuffer:4096,
    env:{PATH:'/usr/bin:/bin',LANG:'C'}});
  if(cmd.error||cmd.status!==0)fail('service_restart_failed');
}
async function settleHealth(){
  let last=null;
  for(let attempt=0;attempt<45;attempt++){
    try{return await health.attest()}catch(e){last=e}
    await new Promise(done=>setTimeout(done,250));
  }
  fail('health_not_recovered:'+String(last?.message||'unknown').slice(0,90));
}
async function restartAndVerify(){
  // Each iteration witnesses BOTH MCP lanes + router BEFORE any restart.
  for(const step of cutover.STEPS){
    await settleHealth();
    restartFixedService(step.unit);
    await settleHealth();
  }
  return true;
}
function waiverFromDisk(hostHead){
  const pem=readRootFile(owner.KEY_FILE);
  const message=readRootFile(owner.WAIVER_DIR+'/waiver.txt');
  const signature=readRootFile(owner.WAIVER_DIR+'/waiver.sig');
  return owner.verifyWaiver({publicKeyPem:pem,message,signature,hostHead});
}
async function inspectReadOnly(){
  ensureRoot();
  const exact=planSource.prepareExactPlan();
  await health.attest();
  rootDirectory(WORK_ROOT);
  rootDirectory(LEDGER);
  return Object.freeze({
    host_head:exact.hostHead,plan_sha256:receipt.hashPlan(exact.plan),
    release_sha:exact.plan.release_sha,
    service_state:'HEALTHY',owner_root_signature_required:true,
    production_changed:false
  });
}
async function apply(){
  ensureRoot();
  rootDirectory(WORK_ROOT);
  rootDirectory(LEDGER);
  const {hostHead,plan,native:prepared}=planSource.prepareExactPlan();
  if(prepared.manifestSha256!==receipt.hashPlan(plan))fail('plan_digest_drift');
  await health.attest();
  const token=readRootFile(RECEIPT_FILE).toString('ascii').trim();
  const requestId=requestIdFromToken(token);
  const nowSeconds=Math.floor(Date.now()/1000);
  const admitted=owner.admitOwner({
    token,plan,requestId,nowSeconds,hostHead
  });
  if(!admitted.waiver.verified||!admitted.grant.verified||
    admitted.grant.plan_sha256!==prepared.manifestSha256||
    admitted.grant.operation!==tx.OPERATION)
    fail('owner_grant_not_bound');
  // Consumption is DURABLE before any controlled service or file mutation.
  const consumed=receipt.consumeReceipt(admitted.grant,LEDGER,Math.floor(Date.now()/1000));
  if(consumed.consumed!==true||consumed.operation!==tx.OPERATION)
    fail('receipt_not_consumed');
  const result=await native.executeCore(prepared,{
    workRoot:WORK_ROOT,
    postInstall:restartAndVerify,
    postRollback:restartAndVerify
  });
  if(result.status!=='COMMITTED')fail('transaction_not_committed');
  await health.attest();
  return Object.freeze({
    status:'COMMITTED',operation:tx.OPERATION,
    owner_issuer:receipt.OWNER_ISSUER,request_id:consumed.request_id,
    plan_sha256:consumed.plan_sha256,
    host_head:hostHead,transaction:result.transaction,
    runtime_reinstall:false,production_changed:true
  });
}
const OWNERS=Object.freeze([
  tx.TARGETS.approval,tx.TARGETS.executor,tx.TARGETS.mcp,tx.TARGETS.policy
]);
const ASSETS=Object.freeze([tx.TARGETS.core,tx.TARGETS.worker]);
function pendingJournal(){
  rootDirectory(WORK_ROOT);
  const pending=[];
  for(const item of fs.readdirSync(WORK_ROOT)){
    if(!/^txn-[A-Za-z0-9_-]+$/.test(item))continue;
    const d=path.join(WORK_ROOT,item);
    const st=fs.lstatSync(d);
    if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(d)!==d)
      fail('unsafe_journal_dir');
    const j=JSON.parse(readRootFile(path.join(d,'journal.json')).toString('utf8'));
    if(!['COMMITTED','ROLLED_BACK'].includes(j.status))
      pending.push({path:d,journal:j});
  }
  if(pending.length!==1)fail('single_pending_transaction_required');
  return pending[0];
}
function consumedPermitExists(planSha){
  rootDirectory(LEDGER);
  if(!/^[a-f0-9]{64}$/.test(planSha||''))fail('pending_plan_invalid');
  for(const name of fs.readdirSync(LEDGER)){
    if(!/^[0-9a-f-]{36}\.json$/.test(name))continue;
    const data=JSON.parse(readRootFile(path.join(LEDGER,name)).toString('utf8'));
    if(data.operation===tx.OPERATION&&data.plan_sha256===planSha&&
      receipt.UUID.test(data.request_id||''))
      return true;
  }
  return false;
}
async function recover(){
  ensureRoot();
  // Crash recovery must not assume live *preimages* still match: they may
  // be halfway replaced. Authenticate immutable source and signed waiver only.
  const hostHead=planSource.attestHostCheckout();
  waiverFromDisk(hostHead);
  const pending=pendingJournal();
  if(pending.journal.schema!=='prhm.registrar.native-journal.v1'||
     pending.journal.sourceCommit!==tx.SOURCE_COMMITS.host||
     !consumedPermitExists(pending.journal.manifestSha256))
    fail('pending_transaction_not_authorized');
  const result=await native.recoverAfterCrash({
    workRoot:WORK_ROOT,transaction:pending.path,
    expectedTargets:OWNERS,expectedAssets:ASSETS,
    postRollback:restartAndVerify
  });
  if(result.status!=='ROLLED_BACK')fail('recovery_incomplete');
  await health.attest();
  return Object.freeze({status:'ROLLED_BACK',transaction:pending.path,
    runtime_reinstall:false,owner_review_waiver_verified:true});
}
module.exports=Object.freeze({WORK_ROOT,LEDGER,RECEIPT_FILE,OWNERS,ASSETS,
  requestIdFromToken,inspectReadOnly,apply,recover});
if(require.main===module){
  const mode=process.argv.length===3?process.argv[2]:'';
  const run=mode==='--preflight'?inspectReadOnly:
    mode==='--register'?apply:mode==='--recover'?recover:null;
  if(!run){
    process.stderr.write('NO_ACTION: allowed modes --preflight, --register, --recover\n');
    process.exitCode=64;
  }else run().then(v=>process.stdout.write(JSON.stringify(v)+'\n'))
    .catch(e=>{process.stderr.write('ROOT_ACTION_FAILED='+
      String(e.message).slice(0,220)+'\n');process.exitCode=2});
}
