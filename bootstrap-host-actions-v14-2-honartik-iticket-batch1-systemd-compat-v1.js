#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const TARGET='/opt/prhm-agent-selfmaint-exec/server.js';
const SERVICE='prhm-agent-selfmaint-exec.service';
const OLD_SHA='c9b8b9b0a103783c60c43dede3334cf8775d25489cdc2a0fe97b5f406515ba3e';
const NEEDLE=",'--property=RestrictSUIDSGID=true'";
function sha(v){return crypto.createHash('sha256').update(v).digest('hex');}
function patchSource(source){
  if(sha(Buffer.from(source))!==OLD_SHA) throw new Error('executor_sha_mismatch');
  if(source.split(NEEDLE).length-1!==1) throw new Error('compat_anchor_count_mismatch');
  return source.replace(NEEDLE,'');
}
function atomic(file,bytes,mode){const tmp=file+'.'+process.pid+'.'+Date.now()+'.tmp';fs.writeFileSync(tmp,bytes,{mode,flag:'wx'});fs.renameSync(tmp,file);fs.chmodSync(file,mode);}
function active(){return cp.execFileSync('/usr/bin/systemctl',['is-active',SERVICE],{encoding:'utf8'}).trim()==='active';}
function execute(){
  const original=fs.readFileSync(TARGET); const st=fs.statSync(TARGET); const source=original.toString('utf8');
  const patched=Buffer.from(patchSource(source),'utf8');
  const backup='/var/backups/prhm-honartik-iticket-v14-2-systemd-compat-'+Date.now(); fs.mkdirSync(backup,{recursive:true,mode:0o700});
  const backupFile=path.join(backup,'server.js'); fs.writeFileSync(backupFile,original,{mode:0o600,flag:'wx'});
  let mutated=false;
  try{
    cp.execFileSync('/usr/local/bin/prhm-node',['--check','-'],{input:patched,encoding:'utf8'});
    atomic(TARGET,patched,st.mode&0o777); mutated=true;
    cp.execFileSync('/usr/bin/systemctl',['restart',SERVICE],{stdio:'pipe'});
    if(!active()) throw new Error('executor_service_inactive_after_restart');
    const installed=fs.readFileSync(TARGET); if(installed.includes(Buffer.from(NEEDLE))) throw new Error('compat_property_still_present');
    return {ok:true,schema_version:'prhm.control-plane-upgrade-result.v1',upgrade:'honartik_iticket_batch1_systemd_compat_v1',old_sha256:OLD_SHA,new_sha256:sha(installed),backup_dir:backup,control_plane_mutation:true,production_application_tree_mutation:false,database_mutation:false,external_network:false,token_read:false,rollback:{performed:false}};
  }catch(e){
    if(mutated){atomic(TARGET,original,st.mode&0o777);try{cp.execFileSync('/usr/bin/systemctl',['restart',SERVICE],{stdio:'pipe'});}catch{} }
    throw e;
  }
}
if(require.main===module){try{process.stdout.write(JSON.stringify(execute())+'\n');}catch(e){process.stderr.write(String(e.stack||e)+'\n');process.exitCode=1;}}
module.exports={TARGET,SERVICE,OLD_SHA,NEEDLE,sha,patchSource,execute};
