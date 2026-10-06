'use strict';
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');

const ACTION='control_plane_installer_refresh_state_helper_rebase_v37';
const TARGET='/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js';
const BACKUP_ROOT='/var/backups/prhm-installer-refresh-state-helper-rebase-v37';
const CURRENT_STATE_SHA='b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e';
const TARGET_STATE_SHA='b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb';
const CURRENT_TMP_EXPR="const p=path.join(ROOT,'prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js');";
const TARGET_TMP_EXPR="const p='/run/prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js';";

const shaBytes=b=>crypto.createHash('sha256').update(b).digest('hex');
const shaFile=p=>shaBytes(fs.readFileSync(p));
const fail=m=>{throw new Error(m)};

function manifest(){
  return {
    schema_version:'prhm.installer-refresh-state-helper-rebase.v37',
    action:ACTION,
    target:TARGET,
    current_sha256:CURRENT_STATE_SHA,
    target_sha256:TARGET_STATE_SHA,
    backup_root:BACKUP_ROOT,
    replacement_count:1,
    zero_input:true,
    production_mutation:false,
    database_mutation:false,
    arbitrary_command:false,
    arbitrary_path:false
  };
}

function assertRegular(file,label){
  const st=fs.lstatSync(file);
  if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(file)!==file)fail(label+'_invalid');
  return st;
}

function syntaxBytes(bytes){
  const bin=fs.existsSync('/usr/local/bin/prhm-node')?'/usr/local/bin/prhm-node':process.execPath;
  const r=cp.spawnSync(bin,['--check','-'],{input:bytes,encoding:null,timeout:30000,maxBuffer:500000});
  if(r.error||r.status!==0)fail('candidate_syntax_invalid:'+String(r.stderr||r.stdout||r.error||'').slice(-1000));
}

function transformSource(source){
  if(typeof source!=='string')fail('source_invalid');
  const before=Buffer.from(source,'utf8');
  const actual=shaBytes(before);
  if(actual!==CURRENT_STATE_SHA)fail('current_state_sha_mismatch:'+actual);
  const count=source.split(CURRENT_TMP_EXPR).length-1;
  if(count!==1)fail('tmp_path_anchor_count:'+count);
  const content=source.replace(CURRENT_TMP_EXPR,TARGET_TMP_EXPR);
  const bytes=Buffer.from(content,'utf8');
  const next=shaBytes(bytes);
  if(next!==TARGET_STATE_SHA)fail('target_state_sha_mismatch:'+next);
  if(content.includes(CURRENT_TMP_EXPR))fail('old_tmp_path_remains');
  if(content.split(TARGET_TMP_EXPR).length-1!==1)fail('target_tmp_path_postcondition');
  syntaxBytes(bytes);
  return {content,bytes,old_sha256:actual,new_sha256:next,replacement_count:1};
}

function preflightPath(target){
  assertRegular(target,'target');
  const current=shaFile(target);
  if(current===TARGET_STATE_SHA){
    return {ok:true,current_sha256:current,target_sha256:TARGET_STATE_SHA,would_change:false,already_current:true};
  }
  if(current!==CURRENT_STATE_SHA)fail('target_preimage_sha_mismatch:'+current);
  const candidate=transformSource(fs.readFileSync(target,'utf8'));
  return {ok:true,current_sha256:current,target_sha256:candidate.new_sha256,would_change:true,already_current:false};
}

function preflight(){
  const r=preflightPath(TARGET);
  return {
    ...r,
    action:ACTION,
    preflight_only:true,
    changed:false,
    rollback_performed:false,
    production_mutation:false,
    database_mutation:false,
    arbitrary_command:false,
    arbitrary_path:false
  };
}

function writeExclusive(file,bytes,mode,uid,gid){
  const fd=fs.openSync(file,'wx',mode);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  fs.chownSync(file,uid,gid);
  fs.chmodSync(file,mode);
}

function restore(target,preimage,st){
  const tmp=target+'.rollback-'+process.pid+'-'+Date.now()+'.tmp';
  writeExclusive(tmp,preimage,st.mode&0o777,st.uid,st.gid);
  fs.renameSync(tmp,target);
  if(shaFile(target)!==shaBytes(preimage))fail('rollback_sha_mismatch');
}

function applyToPath({target,backup_root,production=false,inject_after_rename=false}){
  let renamed=false;
  let rolledBack=false;
  let preimage=null;
  let st=null;
  let runDir=null;
  try{
    const pf=preflightPath(target);
    if(!pf.would_change){
      return {
        ok:true,action:ACTION,changed:false,already_current:true,
        old_sha256:TARGET_STATE_SHA,new_sha256:TARGET_STATE_SHA,
        rollback_performed:false,production_mutation:false,database_mutation:false
      };
    }

    st=assertRegular(target,'target');
    preimage=fs.readFileSync(target);
    const candidate=transformSource(preimage.toString('utf8'));
    fs.mkdirSync(backup_root,{recursive:true,mode:0o700});
    runDir=path.join(backup_root,'run-'+Date.now()+'-'+process.pid);
    fs.mkdirSync(runDir,{mode:0o700});
    writeExclusive(path.join(runDir,'preimage.bak'),preimage,0o600,process.getuid?process.getuid():st.uid,process.getgid?process.getgid():st.gid);

    const tmp=target+'.v37-'+process.pid+'-'+Date.now()+'.tmp';
    writeExclusive(tmp,candidate.bytes,st.mode&0o777,st.uid,st.gid);
    if(shaFile(tmp)!==TARGET_STATE_SHA)fail('candidate_tmp_sha_mismatch');
    fs.renameSync(tmp,target);
    renamed=true;

    if(inject_after_rename)fail('injected_after_rename');
    if(shaFile(target)!==TARGET_STATE_SHA)fail('post_write_sha_mismatch');

    const out={
      ok:true,action:ACTION,changed:true,already_current:false,
      old_sha256:CURRENT_STATE_SHA,new_sha256:TARGET_STATE_SHA,
      replacement_count:1,backup_dir:runDir,rollback_performed:false,
      production_mutation:production===true,database_mutation:false,
      arbitrary_command:false,arbitrary_path:false
    };
    writeExclusive(path.join(runDir,'result.json'),Buffer.from(JSON.stringify(out,null,2)+'\n'),0o600,process.getuid?process.getuid():st.uid,process.getgid?process.getgid():st.gid);
    return out;
  }catch(error){
    if(renamed&&preimage&&st){
      try{restore(target,preimage,st);rolledBack=true}
      catch(rb){throw new Error('rebase_failed_rollback_failed:'+String(error&&error.message||error)+':'+String(rb&&rb.message||rb))}
    }
    return {
      ok:false,action:ACTION,changed:false,rollback_performed:rolledBack,
      production_mutation:false,database_mutation:false,
      error:String(error&&error.message||error).slice(0,1200)
    };
  }
}

function apply(){
  if(process.getuid&&process.getuid()!==0)fail('root_required');
  const out=applyToPath({target:TARGET,backup_root:BACKUP_ROOT,production:true});
  if(out.ok!==true)fail('rebase_apply_failed:'+out.error);
  return out;
}

module.exports=Object.freeze({
  ACTION,TARGET,BACKUP_ROOT,CURRENT_STATE_SHA,TARGET_STATE_SHA,CURRENT_TMP_EXPR,TARGET_TMP_EXPR,
  manifest,preflight,apply,
  __test:Object.freeze({transformSource,applyToPath})
});

if(require.main===module){
  try{
    const mode=process.argv[2]||'preflight';
    if(!['preflight','apply'].includes(mode)||process.argv.length>3)fail('unexpected_arguments');
    const out=mode==='apply'?apply():preflight();
    process.stdout.write(JSON.stringify(out)+'\n');
  }catch(error){
    process.stderr.write(String(error&&error.stack||error)+'\n');
    process.exit(1);
  }
}
