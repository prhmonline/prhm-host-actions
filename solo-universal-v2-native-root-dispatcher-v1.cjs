'use strict';
/**
 * SOURCE-ONLY OWNER-GOVERNED ROOT DISPATCHER candidate for the EXACT
 * observed Solo Universal v2 release. This file exports NO CLI, signer,
 * arbitrary target, user supplied path or unauthenticated HTTP endpoint.
 *
 * Production installation requires an independent, reviewed immutable Git
 * checkout, separately pinned Root registry dispatch, a root-owned immutable
 * pre-staged v2 source payload, a NEW owner Ed25519 critical Level-4 receipt,
 * durable single-use replay consumption, and crash-recoverable four-file
 * journal. Owner issuer is NOT Provider Root-of-Trust.
 *
 * The existing Solo systemd daemon and state directory are NEVER modified.
 */
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const contract=require('./solo-universal-v2-signed-release-contract-v1.cjs');
const native=require('./solo-universal-v2-native-recovery-v1.cjs');
const permit=require('./solo-universal-v2-root-permit-ledger-v1.cjs');
const preflight=require('./solo-universal-v2-live-readonly-preflight-v1.cjs');
const P=contract.PINS;
const FAIL=s=>{throw Error('solo_universal_v2_root_driver_'+s)};
const JOURNALS='/var/lib/prhm-agent-selfmaint-exec/solo-universal-v2-root-transactions-v1';
const PAYLOAD='/var/lib/prhm-agent-selfmaint-exec/solo-universal-v2-payload';
const SOURCE_BUNDLE=PAYLOAD+'/bundle';
const SOURCE_PROFILE=PAYLOAD+'/solo_company.production.existing-stateful.v2.json';
const GUARD=JOURNALS+'/driver.active.lock';
const WRAPPER_SHA='4c67a86046d0f2eb511a5fabe81b14e35ab9c17aaadf33c2064fa9d68e8989ce';
const PREFIX=P.installer_prefix;
const CFG=Object.freeze({
  prefix:PREFIX,registry:'/etc/deploy-control/projects',journalRoot:JOURNALS,
  wrapperSha:WRAPPER_SHA,expectedCurrent:P.installed_digest,
  expectedManifestSha:P.manifest_preimage_sha256,
  candidateDigest:P.candidate_digest,profileSha:P.profile_sha256,
});
function assertRoot(){
  if(typeof process.geteuid!=='function'||process.getuid()!==0||
     process.geteuid()!==0)FAIL('root_required');
}
function directory(file,mode=0o700){
  const st=fs.lstatSync(file);
  if(!st.isDirectory()||st.isSymbolicLink()||
     fs.realpathSync(file)!==file||st.uid!==0||st.gid!==0||
     (st.mode&0o777)!==mode)FAIL('unsafe_directory');
}
function regular(file,mode=0o600,max=32768){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(file)!==file||
     st.uid!==0||st.gid!==0||(st.mode&0o777)!==mode||
     st.size===0||st.size>max)FAIL('unsafe_staged_file');
  return fs.readFileSync(file);
}
function fsyncDir(file){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
  try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function fixedPython(source,timeout=20000) {
  const r=cp.spawnSync('/opt/prhm/universal-python/bin/python3',
    ['-I','-c',source],{
      encoding:'utf8',timeout,maxBuffer:16384,
      env:{PATH:'/usr/bin:/bin',LANG:'C',PYTHONDONTWRITEBYTECODE:'1',
           PYTHONNOUSERSITE:'1'},
    });
  if(r.error||r.status!==0)FAIL('pinned_python_execution_failed');
  return r.stdout.trim();
}
function quote(s){return JSON.stringify(s)}
function payloadProof(){
  directory(PAYLOAD);
  directory(SOURCE_BUNDLE);
  const p=regular(SOURCE_PROFILE,0o600,8192);
  // First use ONLY the already-installed, pinned Universal v1 verifier to
  // digest candidate bytes; do not execute the untrusted candidate code.
  const digestProof=[
    "import sys",
    "sys.path.insert(0,"+quote(PREFIX+'/current')+")",
    "from universal.install import bundle_digest",
    "assert bundle_digest("+quote(SOURCE_BUNDLE)+")=="+quote(P.candidate_digest)+")",
    "print('EXACT_CANDIDATE_DIGEST_OK')",
  ].join('\n');
  if(fixedPython(digestProof)!=='EXACT_CANDIDATE_DIGEST_OK')
    FAIL('candidate_bundle_untrusted');
  // Only now, after the immutable digest matches, import the staged v2
  // config and verify the canonical profile digest.
  const profileProof=[
    "import sys,json",
    "sys.path.insert(0,"+quote(SOURCE_BUNDLE)+")",
    "from universal.solo_stateful_v2 import validate_profile",
    "d=json.load(open("+quote(SOURCE_PROFILE)+",'r',encoding='utf8'))",
    "assert validate_profile(d).digest=="+quote(P.profile_sha256),
    "print('EXACT_PROFILE_DIGEST_OK')",
  ].join('\n');
  if(fixedPython(profileProof)!=='EXACT_PROFILE_DIGEST_OK')
    FAIL('candidate_profile_untrusted');
  return p;
}
function runtimePid(){
  const r=cp.spawnSync('/usr/bin/systemctl',
    ['show','prhm-solo-company-runtime.service','-p','MainPID','--value'],
    {encoding:'utf8',timeout:5000,maxBuffer:1024,
     env:{PATH:'/usr/bin:/bin',LANG:'C'}});
  if(r.error||r.status!==0||!/^[1-9][0-9]*\s*$/.test(r.stdout))
    FAIL('runtime_pid_unavailable');
  return Number(r.stdout.trim());
}
function checkStaticPreconditions(){
  assertRoot();
  directory(JOURNALS);
  directory(CFG.registry);
  const sourceSha=permit.attestSourceSha();
  const bytes=payloadProof();
  return {sourceSha,profileBytes:bytes,pid:runtimePid()};
}
function makeProductionHost(){
  // Host is constructed internally: caller cannot inject root paths,
  // issuer key, driver Git SHA, candidate bytes or grant.
  const internal={lease:null,journal:null,sourceSha:null,profileBytes:null,
    runtimePid:null,receiptConsumed:false};
  function leaseMatches(lease){
    if(!internal.lease||lease!==internal.lease)FAIL('lease_identity_mismatch');
    if(fs.readFileSync(GUARD,'utf8')!==lease.id+'\n')
      FAIL('guard_lock_untrusted');
  }
  function readyJournal(j){
    if(!internal.journal||internal.journal!==j)FAIL('journal_identity_mismatch');
    leaseMatches(internal.lease);
  }
  return Object.freeze({
    acquireExclusiveLock:async()=>{
      assertRoot();directory(JOURNALS);
      const lease={id:crypto.randomUUID()};
      let fd;
      try{fd=fs.openSync(GUARD,fs.constants.O_CREAT|fs.constants.O_EXCL|
        fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600)}
      catch(e){if(e.code==='EEXIST')FAIL('unresolved_guard_requires_recovery');throw e}
      try{fs.writeFileSync(fd,lease.id+'\n');fs.fsyncSync(fd)}
      finally{fs.closeSync(fd)}
      fsyncDir(JOURNALS);internal.lease=lease;
      return lease;
    },
    preflight:async()=>{
      leaseMatches(internal.lease);
      const checks=checkStaticPreconditions();
      const observed=await preflight.inspect();
      if(observed.result!=='LIVE_V2_RELEASE_PREIMAGE_PASS_NO_PERMIT'||
         observed.l4_release_receipt_present!==true||
         observed.owner_public_key_pin_verified!==true||
         observed.existing_registry_profiles!==6)
        FAIL('live_preflight_not_ready');
      internal.sourceSha=checks.sourceSha;
      internal.profileBytes=checks.profileBytes;
      internal.runtimePid=checks.pid;
      return {
        installed_digest:observed.installed_digest,
        actual_bundle_digest:observed.installed_digest,
        installed_manifest_sha256:observed.manifest_sha256,
        candidate_digest:P.candidate_digest,profile_sha256:P.profile_sha256,
        runtime_release:observed.runtime_release,
        existing_v1_profiles_valid:true,profile_absent:true,
        service_healthy:true,state_private:true,
        immutable_source_verified:true,root_owned_paths:true,
        no_symlinks:true,protected_targets_unchanged:true,
      };
    },
    prepareDurableRollback:async()=>{
      leaseMatches(internal.lease);
      internal.journal=native.prepare(CFG);
      return internal.journal;
    },
    attestRollbackReady:async(j)=>{
      readyJournal(j);
      // Verify exact durable readbacks, not a caller-provided boolean.
      const files=['journal.json','before-wrapper.bin','before-manifest.bin'];
      for(const f of files)regular(path.join(j.dir,f),0o600,32768);
      const x=JSON.parse(fs.readFileSync(path.join(j.dir,'journal.json'),'utf8'));
      if(x.status!=='PREPARED'||x.operation!==P.operation)
        FAIL('prepared_journal_untrusted');
      return true;
    },
    verifyConsumeSignedL4:async(_pin,driverGitSha,j)=>{
      readyJournal(j);
      if(driverGitSha!==internal.sourceSha)FAIL('source_sha_drift');
      const result=permit.verifyConsumeProduction();
      if(result.driver_git_sha!==internal.sourceSha)FAIL('receipt_git_drift');
      native.attachConsumedPermit(CFG,j.dir,result);
      internal.receiptConsumed=true;
      return result;
    },
    installVersionedBundle:async(_pin,j)=>{
      readyJournal(j);
      if(!internal.receiptConsumed)FAIL('no_consumed_receipt');
      native.markApplying(CFG,j.dir);
      // Invoke the already-installed versioned Python source installer with
      // only the fixed expected preimages AFTER the owner-signed permit.
      const script=[
        "import sys,json",
        "sys.path.insert(0,"+quote(PREFIX+'/current')+")",
        "from universal.install import install_bundle",
        "r=install_bundle("+[
          quote(SOURCE_BUNDLE),quote(PREFIX),quote(P.candidate_digest),
          quote(P.installed_digest),
          "expected_current_content="+quote(P.installed_digest),
          "expected_manifest_sha256="+quote(P.manifest_preimage_sha256),
        ].join(',')+")",
        "print(json.dumps(r,sort_keys=True))",
      ].join('\n');
      const out=JSON.parse(fixedPython(script,30000));
      if(out.digest!==P.candidate_digest||out.previous!==P.installed_digest||
         out.legacy_replaced!==false)FAIL('installer_postimage_invalid');
      return true;
    },
    installExactProfile:async(_pin,j)=>{
      readyJournal(j);
      if(!internal.receiptConsumed)FAIL('no_consumed_receipt');
      native.installProfile(CFG,internal.profileBytes);
      return true;
    },
    attestV2Observation:async(_pin,j)=>{
      readyJournal(j);
      native.verifyPost(CFG);
      if(runtimePid()!==internal.runtimePid)FAIL('solo_daemon_pid_changed');
      const cmd=PREFIX+'/deploy-project';
      const r=cp.spawnSync(cmd,['observe-existing','solo_company','production'],{
        encoding:'utf8',timeout:10000,maxBuffer:32768,
        env:{PATH:'/usr/bin:/bin',LANG:'C',PYTHONNOUSERSITE:'1'}});
      if(r.error||r.status!==0)FAIL('v2_observe_command_failed');
      let d;try{d=JSON.parse(r.stdout)}catch(_){FAIL('v2_observe_result_invalid')}
      if(d.schema!=='prhm.universal.existing-stateful.observation.v2'||
         d.mode!=='READ_ONLY_NO_DEPLOY'||d.managed_by_universal!==false||
         d.registered_for_deployment!==false||
         d.production_modified!==false||
         d.observer?.result!=='READ_ONLY_OBSERVATION_PASS_NOT_MANAGED')
         FAIL('observation_postimage_untrusted');
      const count=fs.readdirSync(CFG.registry).filter(x=>x.endsWith('.json')).length;
      if(count!==7)FAIL('registry_count_drift');
      if(runtimePid()!==internal.runtimePid)FAIL('solo_daemon_changed_after_observe');
      return {
        mode:'READ_ONLY_NO_DEPLOY',
        managed_by_universal:false,production_modified:false,
        runtime_restarted:false,solo_deploy_enabled:false,
        legacy_registry_valid:true,
      };
    },
    finalizeJournal:async(j)=>{
      readyJournal(j);
      return native.finish(CFG,j.dir).status==='COMMITTED';
    },
    restoreJournal:async(_pin,j)=>{
      readyJournal(j);
      const res=native.recover(CFG,j.dir);
      if(res.status!=='ROLLED_BACK')FAIL('native_rollback_unverified');
      return true;
    },
    attestRestored:async(_pin,j)=>{
      readyJournal(j);
      native.attestBefore(CFG);
      if(runtimePid()!==internal.runtimePid)FAIL('rollback_service_pid_changed');
      return true;
    },
    releaseLock:async(lease)=>{
      leaseMatches(lease);
      if(internal.journal){
        const j=JSON.parse(fs.readFileSync(path.join(internal.journal.dir,'journal.json'),'utf8'));
        if(j.status==='PREPARED'&&!internal.receiptConsumed){
          native.cancelPrepared(CFG,internal.journal.dir);
        }else if(!['ROLLED_BACK','COMMITTED'].includes(j.status)){
          FAIL('RECOVERY_REQUIRED_GUARD_RETAINED');
        }
      }
      fs.unlinkSync(GUARD);fsyncDir(JOURNALS);
      internal.lease=null;
    },
  });
}
/**
 * Crash recovery is distinct from new authorization: it may ONLY reconcile
 * a journal that already exists under the fixed protected root.
 * APPLYING/ROLLING_BACK must have a separately verified and durably consumed
 * receipt JTI bound to the exact driver commit, operation and candidate.
 * Recovery NEVER restarts Solo, overwrites its StateDirectory or deploys code.
 */
function reconcileInterruptedRelease(){
  assertRoot();directory(JOURNALS);
  const sourceSha=permit.attestSourceSha();
  const st=fs.lstatSync(GUARD);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||
     (st.mode&0o777)!==0o600)FAIL('stale_guard_not_trusted');
  const lockId=fs.readFileSync(GUARD,'utf8').trim();
  if(!/^[a-f0-9-]{36}$/i.test(lockId))FAIL('stale_guard_id_invalid');
  const txns=fs.readdirSync(JOURNALS).filter(n=>
    /^tx-[a-f0-9-]{36}$/i.test(n));
  if(txns.length>1)FAIL('multiple_recovery_transactions');
  if(txns.length===0){
    native.attestBefore(CFG);
    if(fs.existsSync(path.join(JOURNALS,'active.lock')))
      FAIL('missing_journal_with_native_lock');
    fs.unlinkSync(GUARD);fsyncDir(JOURNALS);
    return {status:'STALE_GUARD_CLEARED',changed:false};
  }
  const dir=path.join(JOURNALS,txns[0]);
  directory(dir);
  const raw=regular(path.join(dir,'journal.json'),0o600,32768);
  let j;try{j=JSON.parse(raw.toString('utf8'))}
  catch(_){FAIL('journal_parse_invalid')}
  if(j.id!==txns[0]||j.operation!==P.operation)
    FAIL('recovery_journal_identity_mismatch');
  if(['APPLYING','ROLLING_BACK','COMMITTED'].includes(j.status)){
    if(!/^[a-f0-9]{40}$/.test(j.driverGitSha||'')||
       j.driverGitSha!==sourceSha||
       !/^[a-f0-9-]{36}$/i.test(j.permitJti||'')||
       !/^[a-f0-9-]{36}$/i.test(j.requestId||''))
      FAIL('journal_signed_identity_untrusted');
    directory(permit.LEDGER);
    const marker=regular(path.join(permit.LEDGER,j.permitJti+'.json'),
      0o600,32768);
    let receipt;try{receipt=JSON.parse(marker.toString('utf8'))}
    catch(_){FAIL('ledger_invalid')}
    if(receipt.schema!=='prhm.solo-universal-v2.consumed-owner-l4.v1'||
       receipt.jti!==j.permitJti||receipt.request_id!==j.requestId||
       receipt.operation!==P.operation||
       receipt.driver_git_sha!==sourceSha||
       receipt.candidate_digest!==P.candidate_digest||
       receipt.profile_sha256!==P.profile_sha256)
      FAIL('recovery_ledger_not_bound');
  }else if(j.status==='PREPARED'&&j.permitJti!==undefined){
    // Permit was consumed but no active-payload phase was started; safely
    // cancel journal, never modify the already-running Universal pointer.
    directory(permit.LEDGER);
    regular(path.join(permit.LEDGER,j.permitJti+'.json'),0o600,32768);
  }
  let result;
  if(j.status==='PREPARED')result=native.cancelPrepared(CFG,dir);
  else if(['APPLYING','ROLLING_BACK','ROLLED_BACK','COMMITTED'].includes(j.status))
    result=native.recover(CFG,dir);
  else FAIL('unrecognized_recovery_state');
  if(result.status!=='COMMITTED'&&result.status!=='ROLLED_BACK')
    FAIL('recovery_not_terminal');
  // No root guard release on uncertain or unverifiable state.
  fs.unlinkSync(GUARD);fsyncDir(JOURNALS);
  return {status:result.status,changed:result.changed===true,
    profile_registry_owned_by_universal:result.status==='COMMITTED'};
}

/**
 * Fixed-scope callable by a FUTURE independently registered root dispatcher.
 * No built-in CLI or service route. Do not install this candidate by hand.
 * The owner receipt must already exist and be freshly valid when invoked.
 */
async function applyAuthorizedRelease(){
  const host=makeProductionHost();
  const sourceSha=permit.attestSourceSha();
  return contract.coordinateSignedRelease(host,sourceSha);
}
module.exports=Object.freeze({
  JOURNALS,PAYLOAD,SOURCE_BUNDLE,SOURCE_PROFILE,CFG,
  makeProductionHost,applyAuthorizedRelease,reconcileInterruptedRelease,
});
if(require.main===module){
  process.stderr.write('NO_CLI: fixed signed Host Action registration missing\n');
  process.exitCode=64;
}