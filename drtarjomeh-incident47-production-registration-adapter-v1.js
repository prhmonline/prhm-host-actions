'use strict';
// Incident 47 production-registration IO adapter.
//
// This file is a reviewed library, NOT an installer entrypoint. It must be
// copied with its four pinned companion modules and called only by an
// independently authorized, SHA-bound, server-side Host Actions v2 bootstrap.
// Approval, signature verification, request expiration and one-time consumption
// live in the existing trusted Host Actions control plane, never in this file.
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const reg=require('./drtarjomeh-incident47-runtime-registration-v1.js');
const tx=require('./drtarjomeh-incident47-signed-registration-transaction-v1.js');
const pins=require('./drtarjomeh-incident47-l4-registration-candidate-v1.js');

const ACTION=reg.ACTION;
const BACKUPS='/var/backups/prhm-drtarjomeh-incident47-registration-v1';
const AUDIT='/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-incident47-registration-v1';
const LOCK=AUDIT+'/running.lock';
const SOURCE_RUNNER=path.join(__dirname,'drtarjomeh-incident47-reviewed-host-runner-v1.js');
const SERVICES=Object.freeze([
  'prhm-company-approval.service',
  'prhm-agent-selfmaint.service',
  'prhm-agent-selfmaint-exec.service',
  'prhm-agent-mcp-blue.service',
  'prhm-agent-mcp-green.service'
]);
const KEYS=Object.freeze(['base','executor','policy','mcp','runner']);
const SHA_RE=/^[0-9a-f]{64}$/;
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function error(code){throw new Error(code);}
function checkPath(file){
  if(!Object.values(tx.TARGETS).includes(file)&&file!==SOURCE_RUNNER)error('not_in_fixed_allowlist');
  if(!path.isAbsolute(file))error('absolute_path_required');
  return file;
}
function commands(bin,args,timeout=30000){
  if(!(
    (bin==='/usr/local/bin/prhm-node'&&args.length===2&&args[0]==='--check'&&
      Object.values(tx.TARGETS).includes(args[1])&&args[1]!==tx.TARGETS.policy)
    ||(bin==='/usr/bin/systemctl'&&args.length===2&&
      ['restart','is-active'].includes(args[0])&&SERVICES.includes(args[1]))
    ||(bin==='/usr/sbin/apachectl'&&args.length===1&&args[0]==='-t')
  ))error('unreviewed_command_or_arguments');
  const p=cp.spawnSync(bin,args,{encoding:'utf8',timeout,maxBuffer:65536,
    env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C'}});
  if(p.error||p.status!==0)error('health_or_syntax_command_failed');
  return String(p.stdout||'').trim();
}
function safeBytes(file){
  checkPath(file);
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<=0||st.size>2*1024*1024)
    error('unsafe_pinned_file');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const checked=fs.fstatSync(fd);
    if(!checked.isFile()||checked.ino!==st.ino||checked.dev!==st.dev)
      error('file_replaced_during_open');
    const out=fs.readFileSync(fd);
    if(out.length!==checked.size||digest(out)!==digest(fs.readFileSync(fd,{position:0})))
      error('file_changed_during_read');
    return out;
  }finally{fs.closeSync(fd);}
}
function statTarget(file){
  checkPath(file);
  let st;
  try{st=fs.lstatSync(file)}
  catch(e){if(e.code==='ENOENT')return {exists:false};throw e}
  if(st.isSymbolicLink()||!st.isFile())error('unsafe_target_type');
  return {exists:true,isFile:true,isSymlink:false,sha256:digest(safeBytes(file)),
    mode:st.mode&0o777,uid:st.uid,gid:st.gid};
}
function syncParent(dir){
  const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function atomicReplace(file,bytes,mode,uid,gid,allowAbsent=false){
  checkPath(file);
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>2*1024*1024)
    error('invalid_replacement_bytes');
  const state=statTarget(file);
  if(!state.exists&&!allowAbsent)error('target_disappeared');
  const dir=path.dirname(file);
  const tmp=path.join(dir,'.i47-'+process.pid+'-'+crypto.randomBytes(8).toString('hex')+'.tmp');
  let fd;
  try{
    fd=fs.openSync(tmp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
    fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
    fs.chownSync(tmp,uid,gid);fs.chmodSync(tmp,mode);
    if(statTarget(file).exists!==state.exists)error('target_exists_drift');
    if(state.exists&&statTarget(file).sha256!==state.sha256)error('target_preimage_race');
    fs.renameSync(tmp,file);
    syncParent(dir);
  }finally{
    if(fd!==null&&fd!==undefined)fs.closeSync(fd);
    try{fs.unlinkSync(tmp)}catch(e){if(e.code!=='ENOENT')throw e}
  }
}
function immutableDir(folder){
  if(!path.isAbsolute(folder))error('root_directory_required');
  try{const st=fs.lstatSync(folder);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)error('unsafe_private_directory')}
  catch(e){if(e.code!=='ENOENT')throw e;fs.mkdirSync(folder,{mode:0o700,recursive:false})}
}
function createProductionAdapter(){
  if(process.getuid?.()!==0)error('root_required_for_privileged_adapter');
  let copyDir=null,backups=null,lockedFd=null;
  return Object.freeze({
    hostMainSha:()=>reg.HOST_BASE,
    readOwner:p=>{if(!Object.values(pins.LIVE).some(entry=>entry.path===p))error('owner_not_allowlisted');return safeBytes(p)},
    readRunner:n=>{if(n!=='drtarjomeh-incident47-reviewed-host-runner-v1.js')error('runner_name_invalid');return safeBytes(SOURCE_RUNNER)},
    targetState:file=>statTarget(file),
    lock:async action=>{
      if(action!==ACTION)error('unapproved_action');
      immutableDir(path.dirname(AUDIT));immutableDir(AUDIT);
      lockedFd=fs.openSync(LOCK,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
      fs.writeFileSync(lockedFd,String(process.pid));fs.fsyncSync(lockedFd);
      const own=fs.fstatSync(lockedFd);
      return async()=>{
        const now=fs.lstatSync(LOCK);
        if(now.ino!==own.ino||now.dev!==own.dev)error('lock_identity_drift');
        fs.unlinkSync(LOCK);fs.closeSync(lockedFd);lockedFd=null;
      };
    },
    snapshot:async steps=>steps.map(step=>{
      if(step.path!==tx.TARGETS[step.kind])error('snapshot_path_drift');
      const stat=statTarget(step.path);
      if(step.before_sha256===null){
        if(stat.exists)error('runner_appeared_during_snapshot');
        return {kind:step.kind,absent:true};
      }
      if(!stat.exists||stat.sha256!==step.before_sha256)error('snapshot_sha_mismatch');
      return {kind:step.kind,absent:false,sha256:stat.sha256,
        mode:stat.mode,uid:stat.uid,gid:stat.gid,bytes:safeBytes(step.path)};
    }),
    backup:async copies=>{
      if(backups||copyDir)error('backup_already_created');
      immutableDir(BACKUPS);
      copyDir=path.join(BACKUPS,Date.now()+'-'+process.pid+'-'+crypto.randomBytes(6).toString('hex'));
      fs.mkdirSync(copyDir,{mode:0o700});
      backups=new Map();
      for(const copy of copies){
        if(!KEYS.includes(copy.kind)||backups.has(copy.kind))error('duplicate_backup_kind');
        const meta={kind:copy.kind,absent:copy.absent===true,
          sha256:copy.absent?null:copy.sha256,mode:copy.mode,uid:copy.uid,gid:copy.gid};
        if(!copy.absent){
          if(!Buffer.isBuffer(copy.bytes)||digest(copy.bytes)!==copy.sha256)error('backup_hash_invalid');
          const dst=path.join(copyDir,copy.kind+'.bak');
          const fd=fs.openSync(dst,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
          try{fs.writeFileSync(fd,copy.bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
          meta.backup=dst;
        }
        backups.set(copy.kind,meta);
      }
      if(backups.size!==KEYS.length)error('backup_incomplete');
      const manifest=Buffer.from(JSON.stringify({action:ACTION,backup_created:new Date().toISOString(),
        components:Array.from(backups.values())})+'\n');
      const fd=fs.openSync(path.join(copyDir,'manifest.json'),
        fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
      try{fs.writeFileSync(fd,manifest);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
      syncParent(copyDir);
      return true;
    },
    writeExact:async step=>{
      if(!backups||!backups.has(step.kind)||tx.TARGETS[step.kind]!==step.path)error('write_without_backup');
      const before=backups.get(step.kind);
      const current=statTarget(step.path);
      if(before.absent!==!current.exists||(current.exists&&current.sha256!==before.sha256))
        error('preimage_changed_after_backup');
      atomicReplace(step.path,step.bytes,step.mode,step.uid,step.gid,before.absent);
    },
    verify:async step=>{
      const curr=statTarget(step.path);
      if(!curr.exists||curr.sha256!==step.after_sha256||curr.mode!==step.mode||
        curr.uid!==step.uid||curr.gid!==step.gid)error('installed_file_verification_failed');
      if(step.kind==='policy'){
        const data=JSON.parse(safeBytes(step.path).toString('utf8'));
        if(data.operations?.[pins.OPERATION]?.level!==4||
          !data.typed_scopes?.some(s=>s.action===ACTION&&s.operation===pins.OPERATION))
          error('signed_l4_policy_missing');
      }else commands('/usr/local/bin/prhm-node',['--check',step.path],12000);
      return true;
    },
    reloadAndHealth:async mode=>{
      if(!['candidate','baseline'].includes(mode))error('unknown_reload_mode');
      for(const service of SERVICES)commands('/usr/bin/systemctl',['restart',service],60000);
      for(const service of SERVICES)
        if(commands('/usr/bin/systemctl',['is-active',service],12000)!=='active')
          error('control_plane_service_unhealthy');
      return true;
    },
    restore:async(file,kind)=>{
      if(!backups||tx.TARGETS[kind]!==file||!backups.has(kind))error('restore_without_backup');
      const b=backups.get(kind);
      const current=statTarget(file);
      if(b.absent){
        if(current.exists){
          const reviewed=reg.RUNNER_GIT_BLOB;
          const body=safeBytes(file);
          const sha1=crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+body.length+'\0'),body])).digest('hex');
          if(sha1!==reviewed)error('rollback_runner_drift');
          fs.unlinkSync(file);syncParent(path.dirname(file));
        }
      }else{
        const bytes=fs.readFileSync(b.backup);
        if(digest(bytes)!==b.sha256)error('backup_corrupted');
        atomicReplace(file,bytes,b.mode,b.uid,b.gid,false);
        if(statTarget(file).sha256!==b.sha256)error('rollback_verification_failed');
      }
    },
    record:async outcome=>{
      immutableDir(path.dirname(AUDIT));immutableDir(AUDIT);
      if(outcome.action!==ACTION||typeof outcome.ok!=='boolean')error('bad_audit_record');
      const file=path.join(AUDIT,'result-'+Date.now()+'-'+process.pid+'-'+crypto.randomBytes(5).toString('hex')+'.json');
      const report={timestamp:new Date().toISOString(),action:ACTION,
        app_sha:pins.SOURCE_COMMIT,host_baseline:reg.HOST_BASE,
        targets:KEYS,backup_dir:copyDir,ok:outcome.ok,
        rollback_performed:outcome.rollback_performed===true,
        rollback_incomplete:outcome.rollback_incomplete===true,
        authorization_attested_by_transaction:false};
      const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
      try{fs.writeFileSync(fd,JSON.stringify(report)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
      return report;
    }
  });
}
function preflight(){
  // No mutation at all: no lock, no backup, no service call.
  const a=createProductionAdapter();
  const plan=tx.getPlan(a);
  return {schema:plan.schema,action:ACTION,app_sha:plan.app_sha,
    paths:plan.steps.map(s=>s.path),preimages_verified:true,
    install_authorized:false,production_mutation:false};
}
module.exports=Object.freeze({ACTION,BACKUPS,AUDIT,LOCK,SERVICES,createProductionAdapter,preflight,
  _reviewTest: Object.freeze({checkPath,statTarget,commands})});
if(require.main===module){
  process.stderr.write('Not a CLI installer; signed Level-4 bootstrap only.\n');
  process.exitCode=64;
}
