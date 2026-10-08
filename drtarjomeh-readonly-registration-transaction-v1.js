'use strict';
// Transaction engine for the fixed DrTarjomeh read-only audit registration.
// NOT a self-authorizing action. There is deliberately NO --install CLI.
// A separately registered, authenticated Level-4 Host Action must call installBound().
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const candidate=require('./drtarjomeh-readonly-registration-candidate-v1.js');
const pins=require('./drtarjomeh-preflight-agent3-live-pins-check-v1.js');
const manifest=require('./drtarjomeh-preflight-agent3-registration-pins-v1.json');
const OPERATION='host_action.drtarjomeh_readonly_registration_install_v1';
const APPROVAL='CONFIRM_LEVEL_4_CRITICAL';
const BACKUP_ROOT='/var/backups/prhm-drt-readonly-registration-v1';
const EXACT_TARGETS=Object.freeze([
  '/opt/prhm-agent-readonly-actions/drtarjomeh-current-release-preflight-v1.js',
  '/home/agent/ssh-agent-api/drtarjomeh-preflight-agent-api-route-v1.js',
  '/home/agent/ssh-mcp-server/src/plugins/drtarjomeh-preflight-mcp-adapter-v1.mjs',
  '/home/agent/ssh-agent-api/honartikIticketV14PreflightRoutes.js',
  '/home/agent/ssh-mcp-server/src/plugins/honartikIticketPreflight.js'
]);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(s){throw new Error(s);}
function exactApproval(approved){
  // The trusted approval handler MUST attest this object using a server-side
  // one-time consumed Level-4 request. This comparison is NOT authentication.
  if(!approved||approved.operation!==OPERATION||approved.level!==4||
     approved.second_confirmation!==APPROVAL||approved.one_time_consumed!==true||
     approved.production_scope!=='control_plane'||
     approved.source_commit!=='69de3224ab08969102cb518164d576086af924aa')
    fail('trusted_level4_approval_required');
  return true;
}
function assertParentsReal(fsImpl,target){
  if(!path.isAbsolute(target)||path.normalize(target)!==target)fail('target_path_invalid');
  let p=path.dirname(target);
  for(;;){
    let st;
    try{st=fsImpl.lstatSync(p);}catch{fail('target_parent_missing');}
    if(!st.isDirectory()||st.isSymbolicLink())fail('target_parent_unsafe');
    const next=path.dirname(p);if(next===p)break;p=next;
  }
}
function inspect(fsImpl,entry){
  assertParentsReal(fsImpl,entry.target);
  try{
    const s=fsImpl.lstatSync(entry.target);
    if(s.isSymbolicLink()||!s.isFile())fail('target_not_regular');
    const bytes=fsImpl.readFileSync(entry.target);
    if(entry.old_sha256==='ABSENT')fail('target_already_present');
    if(sha(bytes)!==entry.old_sha256)fail('target_preimage_sha_drift');
    return {exists:true,bytes,mode:s.mode&0o777,uid:s.uid,gid:s.gid};
  }catch(e){
    if(e.code!=='ENOENT')throw e;
    if(entry.old_sha256!=='ABSENT')fail('expected_target_missing');
    const p=fsImpl.lstatSync(path.dirname(entry.target));
    return {exists:false,bytes:null,mode:0o644,uid:p.uid,gid:p.gid};
  }
}
function safeWrite(fsImpl,file,bytes,mode,uid,gid){
  const fd=fsImpl.openSync(file,'wx',mode);
  try{
    let offset=0;
    while(offset<bytes.length){
      const n=fsImpl.writeSync(fd,bytes,offset,bytes.length-offset,offset);
      if(!Number.isInteger(n)||n<=0)fail('short_atomic_write');
      offset+=n;
    }
    fsImpl.fchmodSync(fd,mode);
    if(typeof uid==='number'&&typeof gid==='number')fsImpl.fchownSync(fd,uid,gid);
    fsImpl.fsyncSync(fd);
  }finally{fsImpl.closeSync(fd);}
}
function generateEntries({readFs=fs,readArtifact}={}){
  if(pins.validateManifest()!==true)fail('pins_manifest_invalid');
  const src=readArtifact||((name)=>fs.readFileSync(path.join(__dirname,name)));
  // This checks ALL four current owners, including untouched guard files.
  candidate.verifyLiveInputs(readFs);
  const plan=candidate.buildPlan(readFs,src);
  if(plan.files.length!==5||JSON.stringify(plan.files.map(x=>x.target))!==JSON.stringify(EXACT_TARGETS))fail('plan_target_drift');
  const apiOriginal=candidate.readBoundOwner(readFs,'/home/agent/ssh-agent-api','honartikIticketV14PreflightRoutes.js');
  const mcpOriginal=candidate.readBoundOwner(readFs,'/home/agent/ssh-mcp-server','src/plugins/honartikIticketPreflight.js');
  const content=[
    Buffer.from(src('drtarjomeh-current-release-preflight-v1.js')),
    Buffer.from(src('drtarjomeh-preflight-agent-api-route-v1.js')),
    Buffer.from(src('drtarjomeh-preflight-mcp-adapter-v1.mjs')),
    Buffer.from(candidate.buildApi(apiOriginal)),
    Buffer.from(candidate.buildMcp(mcpOriginal))
  ];
  return plan.files.map((target,i)=>{
    if(sha(content[i])!==target.sha256)fail('candidate_byte_mismatch');
    const old=i<3?'ABSENT':i===3?pins.EXPECTED_PREIMAGES[1].sha256:pins.EXPECTED_PREIMAGES[3].sha256;
    return {target:target.target,old_sha256:old,new_sha256:target.sha256,bytes:content[i],mode:0o644};
  });
}
function validateEntries(entries,targets=EXACT_TARGETS){
  if(!Array.isArray(entries)||entries.length!==5)fail('entry_count_invalid');
  if(JSON.stringify(entries.map(x=>x.target))!==JSON.stringify(targets))fail('entry_target_drift');
  for(const e of entries){
    if(!Buffer.isBuffer(e.bytes)||sha(e.bytes)!==e.new_sha256||e.mode!==0o644||
       (e.old_sha256!=='ABSENT'&&!/^[a-f0-9]{64}$/.test(e.old_sha256)))
      fail('entry_bytes_or_sha_invalid');
  }
}
function executePrepared(entries,{io=fs,backupRoot=BACKUP_ROOT,verifyApproval,activate,targets=EXACT_TARGETS}={}){
  // Caller supplied by authenticated control-plane executor, never by HTTP input.
  if(typeof verifyApproval!=='function'||typeof activate!=='function')fail('trusted_host_action_required');
  exactApproval(verifyApproval());
  validateEntries(entries,targets);
  if(!path.isAbsolute(backupRoot))fail('backup_root_invalid');
  assertParentsReal(io,backupRoot+'/placeholder');
  const snapshots=entries.map(e=>inspect(io,e));
  const lock=path.join(backupRoot,'install.lock');
  let lockFd;
  try{lockFd=io.openSync(lock,'wx',0o600);}catch{fail('installer_lock_busy_or_missing_root');}
  const txn='tx-'+crypto.randomBytes(12).toString('hex');
  const folder=path.join(backupRoot,txn);
  const installed=[],staged=[];
  let activated=false,phase='INIT';
  try{
    io.mkdirSync(folder,{mode:0o700});
    // Persist ALL old bytes before the first production mutation.
    for(let i=0;i<snapshots.length;i++){
      if(snapshots[i].exists)safeWrite(io,path.join(folder,'before-'+i),snapshots[i].bytes,0o600,null,null);
    }
    const journal={schema:'prhm.drtarjomeh.readonly-registration-journal.v1',
      action:OPERATION,source_commit:'69de3224ab08969102cb518164d576086af924aa',
      entries:entries.map((e,i)=>({target:e.target,old:e.old_sha256,new:e.new_sha256,existed:snapshots[i].exists})),
      status:'BACKUP_COMPLETE'};
    safeWrite(io,path.join(folder,'manifest.json'),Buffer.from(JSON.stringify(journal)+'\n'),0o600,null,null);
    // Staging uses exclusive temp names in the SAME filesystem as each destination.
    for(let i=0;i<entries.length;i++){
      const tmp=entries[i].target+'.prhm-drt-stage-'+txn;
      safeWrite(io,tmp,entries[i].bytes,entries[i].mode,snapshots[i].uid,snapshots[i].gid);
      staged.push(tmp);
      if(sha(io.readFileSync(tmp))!==entries[i].new_sha256)fail('staged_sha_drift');
    }
    phase='STAGED';
    for(let i=0;i<entries.length;i++){
      inspect(io,entries[i]); // immediately fail closed on concurrent drift
      io.renameSync(staged[i],entries[i].target);
      installed.push(i);
      if(sha(io.readFileSync(entries[i].target))!==entries[i].new_sha256)fail('installed_sha_drift');
    }
    phase='FILES_COMMITTED';
    // Trusted fixed callback restarts exactly API and MCP and verifies their
    // health plus the authenticated new read-only audit tool/route contract.
    const health=activate('activate');
    activated=true;
    if(!health||health.api_ok!==true||health.mcp_ok!==true||
       health.audit_contract_ok!==true)fail('postinstall_health_failed');
    safeWrite(io,path.join(folder,'outcome.json'),
      Buffer.from(JSON.stringify({status:'INSTALLED_VERIFIED',api_ok:true,mcp_ok:true,
        audit_contract_ok:true,transaction:txn})+'\n'),0o600,null,null);
    return {ok:true,status:'INSTALLED_VERIFIED',transaction:txn,
      files:entries.map(e=>({target:e.target,sha256:e.new_sha256})),
      approval_level:4,production_app_mutation:false,database_mutation:false,
      provider_credentials_rotated:false,rollback:false,backup_directory:folder};
  }catch(error){
    const rollback_errors=[];
    // Do not overwrite a third party change made since our atomic writes.
    for(const i of [...installed].reverse()){
      try{
        const e=entries[i],now=io.readFileSync(e.target);
        if(sha(now)!==e.new_sha256)fail('rollback_target_modified_externally');
        if(snapshots[i].exists){
          const restore=e.target+'.prhm-drt-restore-'+txn;
          safeWrite(io,restore,snapshots[i].bytes,snapshots[i].mode,snapshots[i].uid,snapshots[i].gid);
          io.renameSync(restore,e.target);
          if(sha(io.readFileSync(e.target))!==e.old_sha256)fail('rollback_sha_mismatch');
        }else io.unlinkSync(e.target);
      }catch(e){rollback_errors.push(String(e.message||e));}
    }
    if(installed.length>0){
      try{const health=activate('rollback');if(!health||health.api_ok!==true||health.mcp_ok!==true)fail('rollback_health_failed');}
      catch(e){rollback_errors.push(String(e.message||e));}
    }
    let state=rollback_errors.length?'ROLLBACK_INCOMPLETE':'ROLLED_BACK';
    try{
      if(io.existsSync(folder)){
        safeWrite(io,path.join(folder,'outcome.json'),
          Buffer.from(JSON.stringify({status:state,phase,
            cause:String(error.message||error).slice(0,160),
            rollback_errors:rollback_errors.map(x=>String(x).slice(0,120))})+'\n'),
          0o600,null,null);
      }
    }catch(e){rollback_errors.push('audit_outcome_write_failed');state='ROLLBACK_INCOMPLETE';}
    const wrapped=new Error(state+':'+String(error.message||error)+':phase='+phase+
      (rollback_errors.length?':'+rollback_errors.join('|'):''));
    wrapped.rollback_status=state;
    wrapped.backup_directory=folder;
    throw wrapped;
  }finally{
    // Retain backed up evidence in 0700 directory for audit/recovery.
    for(const tmp of staged){try{io.unlinkSync(tmp);}catch{}}
    try{io.closeSync(lockFd);}catch{}
    try{io.unlinkSync(lock);}catch{}
  }
}
function installBound({verifyApproval,activate,readFs=fs,readArtifact,io=fs}={}){
  // No remote path, command, actor, environment, service or payload accepted.
  // Host Action v2 approval policy must authenticate verifyApproval externally.
  const entries=generateEntries({readFs,readArtifact});
  return executePrepared(entries,{verifyApproval,activate,io});
}
if(require.main===module){
  // CLI cannot mutate; even --install is rejected.
  process.stderr.write('Library-only: use signed Level-4 Host Action; no CLI install mode\n');
  process.exitCode=2;
}
module.exports=Object.freeze({EXACT_TARGETS,OPERATION,APPROVAL,BACKUP_ROOT,exactApproval,
  assertParentsReal,inspect,generateEntries,validateEntries,executePrepared,installBound});
