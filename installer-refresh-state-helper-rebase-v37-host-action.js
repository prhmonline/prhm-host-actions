'use strict';

const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');

const ACTION='control_plane_installer_refresh_state_helper_rebase_v37';
const TARGET='/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js';
const BACKUP_ROOT='/var/backups/prhm-installer-refresh-state-helper-rebase-v37';
const CURRENT_SHA='b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e';
const TARGET_SHA='b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb';
const CURRENT_EXPR="const p=path.join(ROOT,'prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js');";
const TARGET_EXPR="const p='/run/prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js';";
const NODE=fs.existsSync('/usr/local/bin/prhm-node')?'/usr/local/bin/prhm-node':process.execPath;

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=m=>{throw new Error(m)};
const count=(s,n)=>String(s).split(String(n)).length-1;

function assertRegular(file,label){
  const st=fs.lstatSync(file);
  if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(file)!==file)fail(label+'_invalid');
  return st;
}
function syntax(bytes){
  const r=cp.spawnSync(NODE,['--check','-'],{input:bytes,encoding:null,timeout:30000,maxBuffer:500000});
  if(r.error||r.status!==0)fail('candidate_syntax_invalid:'+String(r.stderr||r.stdout||r.error||'').slice(-1000));
}
function buildCandidate(source){
  if(typeof source!=='string')fail('source_invalid');
  const current=sha(Buffer.from(source,'utf8'));
  if(current===TARGET_SHA){
    if(count(source,TARGET_EXPR)!==1||count(source,CURRENT_EXPR)!==0)fail('target_state_anchor_invalid');
    const bytes=Buffer.from(source,'utf8'); syntax(bytes);
    return Object.freeze({bytes,sha256:TARGET_SHA,changed:false});
  }
  if(current!==CURRENT_SHA)fail('v37_current_state_sha_mismatch:'+current);
  if(count(source,CURRENT_EXPR)!==1||count(source,TARGET_EXPR)!==0)fail('v37_tmp_path_anchor_mismatch');
  const content=source.replace(CURRENT_EXPR,TARGET_EXPR);
  const bytes=Buffer.from(content,'utf8');
  const next=sha(bytes);
  if(next!==TARGET_SHA)fail('v37_target_state_sha_mismatch:'+next);
  syntax(bytes);
  return Object.freeze({bytes,sha256:next,changed:true});
}
function manifest(){
  return Object.freeze({
    schema_version:'prhm.installer-refresh-state-helper-rebase.v37',
    action:ACTION,
    operation:'host_action.control_plane_installer_refresh_state_helper_rebase_v37',
    target:TARGET,
    current_sha256:CURRENT_SHA,
    target_sha256:TARGET_SHA,
    backup_root:BACKUP_ROOT,
    level:4,
    risk:'critical',
    zero_input:true,
    arbitrary_command:false,
    arbitrary_path:false,
    database_mutation:false,
    production_mutation:false
  });
}
function preflight(){
  assertRegular(TARGET,'state_helper');
  const source=fs.readFileSync(TARGET,'utf8');
  const current=sha(Buffer.from(source,'utf8'));
  const candidate=buildCandidate(source);
  return {
    ok:true,
    action:ACTION,
    preflight_only:true,
    current_sha256:current,
    target_sha256:candidate.sha256,
    would_change:candidate.changed,
    changed:false,
    rollback_performed:false,
    production_mutation:false,
    database_mutation:false,
    arbitrary_command:false,
    arbitrary_path:false
  };
}
function writeFsync(file,bytes,mode){
  const fd=fs.openSync(file,'wx',mode);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function restore(target,preimage,st){
  const tmp=target+'.rollback-'+process.pid+'-'+Date.now()+'.tmp';
  writeFsync(tmp,preimage,st.mode&0o777);
  fs.chownSync(tmp,st.uid,st.gid);
  fs.chmodSync(tmp,st.mode&0o777);
  fs.renameSync(tmp,target);
  if(sha(fs.readFileSync(target))!==sha(preimage))fail('rollback_sha_mismatch');
}
function apply(){
  if(process.getuid&&process.getuid()!==0)fail('root_required');
  const pf=preflight();
  if(!pf.would_change)return {...pf,preflight_only:false,changed:false,production_mutation:false};
  const st=assertRegular(TARGET,'state_helper');
  const preimage=fs.readFileSync(TARGET);
  const candidate=buildCandidate(preimage.toString('utf8'));
  fs.mkdirSync(BACKUP_ROOT,{recursive:true,mode:0o700});
  fs.chmodSync(BACKUP_ROOT,0o700);
  const runDir=path.join(BACKUP_ROOT,'run-'+Date.now()+'-'+process.pid);
  fs.mkdirSync(runDir,{mode:0o700});
  writeFsync(path.join(runDir,'state-helper.preimage.bak'),preimage,0o600);
  let renamed=false;
  try{
    const tmp=TARGET+'.v37-'+process.pid+'-'+Date.now()+'.tmp';
    writeFsync(tmp,candidate.bytes,st.mode&0o777);
    fs.chownSync(tmp,st.uid,st.gid);
    fs.chmodSync(tmp,st.mode&0o777);
    syntax(fs.readFileSync(tmp));
    if(sha(fs.readFileSync(tmp))!==TARGET_SHA)fail('candidate_tmp_sha_mismatch');
    fs.renameSync(tmp,TARGET);
    renamed=true;
    if(sha(fs.readFileSync(TARGET))!==TARGET_SHA)fail('post_write_sha_mismatch');
    const out={
      ok:true,action:ACTION,changed:true,old_sha256:CURRENT_SHA,new_sha256:TARGET_SHA,
      backup_dir:runDir,rollback_performed:false,production_mutation:true,database_mutation:false,
      arbitrary_command:false,arbitrary_path:false
    };
    writeFsync(path.join(runDir,'result.json'),Buffer.from(JSON.stringify(out,null,2)+'\n'),0o600);
    return out;
  }catch(error){
    if(renamed){
      try{restore(TARGET,preimage,st)}
      catch(rb){throw new Error('v37_failed_rollback_failed:'+String(error&&error.message||error)+':'+String(rb&&rb.message||rb))}
    }
    throw new Error('v37_failed'+(renamed?'_rolled_back':'')+':'+String(error&&error.message||error));
  }
}

module.exports=Object.freeze({
  ACTION,TARGET,CURRENT_SHA,TARGET_SHA,CURRENT_EXPR,TARGET_EXPR,
  manifest,preflight,buildCandidate,apply
});

if(require.main===module){
  const mode=process.argv[2]||'preflight';
  if(!['preflight','apply'].includes(mode))fail('unexpected_mode');
  process.stdout.write(JSON.stringify(mode==='apply'?apply():preflight())+'\n');
}
