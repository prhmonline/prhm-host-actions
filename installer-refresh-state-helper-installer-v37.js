'use strict';

const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');

const ACTION='control_plane_installer_refresh_state_helper_install_v37';
const TARGET='/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js';
const BACKUP_ROOT='/var/backups/prhm-installer-refresh-state-helper-rebase-v37';
const CURRENT_SHA='b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e';
const TARGET_SHA='b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb';
const CURRENT_EXPR="const p=path.join(ROOT,'prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js');";
const TARGET_EXPR="const p='/run/prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js';";

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=m=>{throw new Error(m)};

function manifest(){
  return {
    schema_version:'prhm.installer-refresh-state-helper-install.v37',
    action:ACTION,
    target:TARGET,
    backup_root:BACKUP_ROOT,
    current_sha256:CURRENT_SHA,
    target_sha256:TARGET_SHA,
    zero_input:true,
    arbitrary_path:false,
    arbitrary_command:false,
    production_mutation:false,
    database_mutation:false
  };
}

function buildCandidate(source){
  if(typeof source!=='string')fail('v37_installer_source_invalid');
  const h=sha(Buffer.from(source,'utf8'));
  if(h===TARGET_SHA){
    return {changed:false,sha256:TARGET_SHA,content:source};
  }
  if(h!==CURRENT_SHA)fail('v37_installer_preimage_mismatch:'+h);
  const count=source.split(CURRENT_EXPR).length-1;
  if(count!==1)fail('v37_installer_anchor_'+count);
  const content=source.replace(CURRENT_EXPR,TARGET_EXPR);
  const outSha=sha(Buffer.from(content,'utf8'));
  if(outSha!==TARGET_SHA)fail('v37_installer_target_sha_mismatch:'+outSha);
  return {changed:true,sha256:outSha,content};
}

function assertRegular(file,label){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(file)!==file)fail(label+'_invalid');
  return st;
}

function syntaxBytes(bytes,label,nodeBin='/usr/local/bin/prhm-node'){
  const r=cp.spawnSync(nodeBin,['--check','-'],{
    input:bytes,encoding:null,timeout:30000,maxBuffer:1000000
  });
  if(r.error||r.status!==0)fail(label+'_syntax_invalid:'+String(r.stderr||r.stdout||r.error||'').slice(-1000));
}

function atomicReplace(file,bytes,st,suffix){
  const tmp=path.join(path.dirname(file),'.'+path.basename(file)+'.'+suffix+'-'+process.pid+'-'+Date.now()+'.tmp');
  let fd;
  try{
    fd=fs.openSync(tmp,'wx',st.mode&0o777);
    fs.writeFileSync(fd,bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd=undefined;
    fs.chownSync(tmp,st.uid,st.gid);
    fs.chmodSync(tmp,st.mode&0o777);
    fs.renameSync(tmp,file);
    let dfd;
    try{dfd=fs.openSync(path.dirname(file),'r');fs.fsyncSync(dfd)}finally{if(dfd!==undefined)fs.closeSync(dfd)}
  }catch(error){
    try{if(fd!==undefined)fs.closeSync(fd)}catch{}
    try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{}
    throw error;
  }
}

function inspect(file){
  const st=assertRegular(file,'state_helper');
  const bytes=fs.readFileSync(file);
  const current=sha(bytes);
  if(current!==CURRENT_SHA&&current!==TARGET_SHA)fail('v37_installer_preimage_mismatch:'+current);
  return {st,bytes,sha256:current};
}

function preflight(){
  const before=inspect(TARGET);
  const candidate=buildCandidate(before.bytes.toString('utf8'));
  syntaxBytes(Buffer.from(candidate.content,'utf8'),'candidate');
  return {
    ok:true,
    action:ACTION,
    preflight_only:true,
    current_sha256:before.sha256,
    candidate_sha256:candidate.sha256,
    would_change:candidate.changed,
    production_mutation:false,
    database_mutation:false,
    arbitrary_path:false,
    arbitrary_command:false
  };
}

function applyToPath({target,backupRoot,failAfterRename=false,production=false,nodeBin='/usr/local/bin/prhm-node'}){
  let before=null,renamed=false,rollback=false,candidate=null,backupDir=null;
  try{
    before=inspect(target);
    candidate=buildCandidate(before.bytes.toString('utf8'));
    syntaxBytes(Buffer.from(candidate.content,'utf8'),'candidate',nodeBin);
    if(!candidate.changed){
      return {
        ok:true,action:ACTION,changed:false,old_sha256:before.sha256,new_sha256:before.sha256,
        backup_dir:null,rollback_performed:false,production_mutation:false,database_mutation:false
      };
    }
    fs.mkdirSync(backupRoot,{recursive:true,mode:0o700});
    backupDir=path.join(backupRoot,'run-'+Date.now()+'-'+process.pid);
    fs.mkdirSync(backupDir,{mode:0o700});
    fs.writeFileSync(path.join(backupDir,'state-helper.preimage.bak'),before.bytes,{mode:0o600,flag:'wx'});
    const next=Buffer.from(candidate.content,'utf8');
    atomicReplace(target,next,before.st,'candidate');
    renamed=true;
    if(failAfterRename)fail('v37_injected_after_rename');
    const final=inspect(target);
    if(final.sha256!==TARGET_SHA)fail('v37_installer_postwrite_sha_mismatch:'+final.sha256);
    syntaxBytes(final.bytes,'postwrite',nodeBin);
    return {
      ok:true,action:ACTION,changed:true,old_sha256:before.sha256,new_sha256:final.sha256,
      backup_dir:backupDir,rollback_performed:false,production_mutation:production===true,database_mutation:false
    };
  }catch(error){
    if(renamed&&before){
      try{
        const now=assertRegular(target,'state_helper_rollback_target');
        atomicReplace(target,before.bytes,{...now,mode:before.st.mode,uid:before.st.uid,gid:before.st.gid},'rollback');
        if(sha(fs.readFileSync(target))!==before.sha256)fail('v37_installer_rollback_sha_mismatch');
        rollback=true;
      }catch(rb){
        throw new Error('v37_installer_failed_rollback_failed:'+String(error&&error.message||error)+':'+String(rb&&rb.message||rb));
      }
    }
    return {
      ok:false,action:ACTION,changed:false,
      old_sha256:before&&before.sha256||null,new_sha256:null,
      backup_dir:backupDir,rollback_performed:rollback,production_mutation:false,database_mutation:false,
      error:String(error&&error.message||error)
    };
  }
}

function apply(){
  if(process.getuid&&process.getuid()!==0)fail('root_required');
  preflight();
  const out=applyToPath({target:TARGET,backupRoot:BACKUP_ROOT,production:true});
  if(out.ok!==true)fail('v37_installer_apply_failed:'+out.error);
  return out;
}

function reviewedCurrentForFixture(){
  const p=path.join(__dirname,'safeFiles-installer-refresh-l4-binding-repair-surface-v1.js');
  const src=fs.readFileSync(p,'utf8');
  const mark='const STATE_SCRIPT=String.raw'+String.fromCharCode(96);
  const a=src.indexOf(mark)+mark.length;
  const b=src.indexOf(String.fromCharCode(96)+';\nfunction runState',a);
  if(a<mark.length||b<=a)fail('v37_fixture_state_anchor_missing');
  const target=src.slice(a,b);
  if(sha(Buffer.from(target,'utf8'))!==TARGET_SHA)fail('v37_fixture_target_sha_mismatch');
  const count=target.split(TARGET_EXPR).length-1;
  if(count!==1)fail('v37_fixture_target_anchor_'+count);
  const current=target.replace(TARGET_EXPR,CURRENT_EXPR);
  if(sha(Buffer.from(current,'utf8'))!==CURRENT_SHA)fail('v37_fixture_current_sha_mismatch');
  return current;
}

function makeFixture(){
  const root=fs.mkdtempSync('/tmp/prhm-installer-refresh-state-v37-');
  const target=path.join(root,'state-helper.js');
  fs.writeFileSync(target,reviewedCurrentForFixture(),{mode:0o640});
  return {root,target,backupRoot:path.join(root,'backups')};
}

function rollbackFixture(){
  const f=makeFixture();
  try{
    const before=sha(fs.readFileSync(f.target));
    const r=applyToPath({target:f.target,backupRoot:f.backupRoot,failAfterRename:true,nodeBin:process.execPath});
    return {...r,target_restored:sha(fs.readFileSync(f.target))===before};
  }finally{fs.rmSync(f.root,{recursive:true,force:true})}
}

function successFixture(){
  const f=makeFixture();
  try{
    const first=applyToPath({target:f.target,backupRoot:f.backupRoot,nodeBin:process.execPath});
    const firstSha=sha(fs.readFileSync(f.target));
    const second=applyToPath({target:f.target,backupRoot:f.backupRoot,nodeBin:process.execPath});
    const secondSha=sha(fs.readFileSync(f.target));
    return {first,second,first_sha:firstSha,second_sha:secondSha,target_sha256:TARGET_SHA};
  }finally{fs.rmSync(f.root,{recursive:true,force:true})}
}

module.exports={
  manifest,
  buildCandidate,
  preflight,
  apply,
  __test:Object.freeze({rollbackFixture,successFixture})
};

if(require.main===module){
  const mode=process.argv[2]||'preflight';
  if(!['preflight','apply'].includes(mode))fail('unexpected_arguments');
  const out=mode==='apply'?apply():preflight();
  process.stdout.write(JSON.stringify(out)+'\n');
}
