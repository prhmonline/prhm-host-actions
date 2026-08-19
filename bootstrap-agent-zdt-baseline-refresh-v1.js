#!/usr/local/bin/prhm-node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='agent_zdt_baseline_refresh_v1';
const NODE='/usr/local/bin/prhm-node';
const BACKUP_ROOT='/var/backups/prhm-agent-zdt-baseline-refresh/';
const TARGET_CANONICAL='/home/agent/ssh-mcp-server/ops/agent-zdt/agent-zero-downtime-bootstrap-v1.js';
const TARGET_INSTALLED='/opt/prhm-agent-selfmaint-exec/actions/agent-zero-downtime-bootstrap-v1.js';
const TARGETS=Object.freeze([TARGET_CANONICAL,TARGET_INSTALLED]);
const HELPER_BEFORE='4f1d5a14ae6e13cc25f442dceca7507e8f79088836f4735dcbcad782be126f26';
const BASE_OLD='4d4c9f1a8ff9099165f09a4df0c43735a320b20ca1c0f5c27def299a1fcabb25';
const BASE_NEW='b084b501b2ea572b39336e45673b4d987a6f7cdb10c769a4db3191ce86ca2877';
const EXEC_OLD='372083619c6c5dd813e413d2873a9015c647ce3a5cb5037b3c1cc4e671c2b22a';
const EXEC_NEW='5346b24f88c19121898288bd197a8dbe2a18a8c587402cfcd5a27afcfeadacad';
const EXPECTED_RESULTING_HELPER_SHA='a54e2890eb455c078a4e09e92e007d71545f834dfec7d8d62bb232e1c91406b4';
const PROTECTED=Object.freeze({
  '/home/agent/ssh-mcp-server/server.js':'558ff55244f43ac60178a6fec0eddd4068223318b25308d42cdf79d92203098f',
  '/home/agent/ssh-mcp-server/src/core/registry.js':'cf3681ca4d4632156df2f77886afe59c07da9a86dbcb68f4217577f811b22231',
  '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js':'ebe988fb99794ed3e09b2cefa7496c2d47c967a850b900a117b6b762b388cc34',
  '/home/agent/ssh-mcp-server/src/plugins/selfmaint.js':'fcf4420ab9b9c0b540f0e88f923065e16a331580cd238a097b9b1c53db34b2d0',
  '/home/agent/ssh-agent-api/server.js':'5c6ffbd60a5347ad2f21352de856bde2033b7ad5b3599301afd3139be8791102',
  '/opt/prhm-agent-zdt/router.mjs':'53b904296da0e9d1490bfc7e3ef0b9c1fbad602a1e693141108f016764ebbe78',
  '/opt/prhm-agent-zdt/api-slot-launcher.cjs':'d20793dc79ee6d0ffa2ee4bb3b4d5dc1c66750ba0e04f821acb3a45421dcb5ea'
});

function fail(message){throw new Error(message);}
function shaBuf(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function shaFile(file){return shaBuf(fs.readFileSync(file));}
function safeRegular(file){const s=fs.lstatSync(file);return s.isFile()&&!s.isSymbolicLink();}
function count(text,needle){return text.split(needle).length-1;}
function validSha(value){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function replaceExactlyOnce(text,oldValue,newValue,label){
  if(count(text,oldValue)!==1)fail('replacement_count_invalid:'+label);
  if(count(text,newValue)!==0)fail('new_literal_already_present:'+label);
  return text.replace(oldValue,newValue);
}
function parseMode(args){
  if(args.length!==1||!['--preflight-only','--apply'].includes(args[0]))fail('unexpected_arguments');
  return args[0];
}
function statMeta(file){const s=fs.lstatSync(file);return{mode:s.mode&0o777,uid:s.uid,gid:s.gid};}
function verifyProtected(){
  for(const [file,expected] of Object.entries(PROTECTED)){
    if(!fs.existsSync(file))fail('missing:'+file);
    if(!safeRegular(file))fail('unsafe_protected_file:'+file);
    const actual=shaFile(file);
    if(actual!==expected)fail('protected_sha_mismatch:'+file+':'+actual);
  }
  return true;
}
function syntaxCheck(bytes,label){
  const tmp='/tmp/prhm-agent-zdt-baseline-refresh-'+label+'-'+process.pid+'-'+Date.now()+'.js';
  try{
    fs.writeFileSync(tmp,bytes,{flag:'wx',mode:0o600});
    const r=cp.spawnSync(NODE,['--check',tmp],{encoding:'utf8',timeout:30000,maxBuffer:131072,env:{PATH:'/usr/local/bin:/usr/bin:/bin',LC_ALL:'C'}});
    if(r.error)fail('candidate_syntax_exec_failed:'+label);
    if(r.status!==0)fail('candidate_syntax_failed:'+label+':'+String(r.stderr||'').slice(-600));
  }finally{try{fs.unlinkSync(tmp);}catch{}}
  return true;
}
function deriveOne(buffer){
  const text=buffer.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(buffer))fail('helper_not_utf8');
  let candidate=replaceExactlyOnce(text,BASE_OLD,BASE_NEW,'base');
  candidate=replaceExactlyOnce(candidate,EXEC_OLD,EXEC_NEW,'executor');
  if(count(candidate,BASE_OLD)!==0||count(candidate,EXEC_OLD)!==0)fail('old_literal_remains');
  if(count(candidate,BASE_NEW)!==1||count(candidate,EXEC_NEW)!==1)fail('new_literal_count_invalid');
  return Buffer.from(candidate,'utf8');
}
function inspectAndDerive(){
  if(process.getuid&&process.getuid()!==0)fail('must_run_as_root');
  if(!fs.existsSync(NODE))fail('missing:'+NODE);
  const originals=[];
  const metas=[];
  for(const file of TARGETS){
    if(!fs.existsSync(file))fail('missing:'+file);
    if(!safeRegular(file))fail('unsafe_target_file:'+file);
    const actual=shaFile(file);
    if(actual!==HELPER_BEFORE)fail('target_sha_mismatch:'+file+':'+actual);
    originals.push(fs.readFileSync(file));
    metas.push(statMeta(file));
  }
  if(!originals[0].equals(originals[1]))fail('helpers_not_byte_identical');
  verifyProtected();
  const candidates=originals.map(deriveOne);
  if(!candidates[0].equals(candidates[1]))fail('candidate_helpers_not_byte_identical');
  syntaxCheck(candidates[0],'canonical');
  syntaxCheck(candidates[1],'installed');
  const candidateSha=shaBuf(candidates[0]);
  return{originals,candidates,metas,candidateSha,candidateBytes:candidates[0].length};
}
function preflightResult(state){
  const pinned=validSha(EXPECTED_RESULTING_HELPER_SHA);
  return{
    ok:true,
    action:ACTION,
    preflight_only:true,
    production_mutation:false,
    database_mutation:false,
    service_restart_reload:false,
    target_count:2,
    target_sha_match:true,
    runtime_baseline_match:true,
    other_protected_sha_match:true,
    replacement_count_per_file:2,
    candidate_syntax_ok:true,
    candidate_sha256:state.candidateSha,
    candidate_bytes:state.candidateBytes,
    resulting_sha_pinned:pinned,
    resulting_sha_match:pinned?state.candidateSha===EXPECTED_RESULTING_HELPER_SHA:null,
    rollback_performed:false
  };
}
function fsyncDir(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function atomicWrite(file,bytes,meta,label){
  const dir=path.dirname(file);
  const tmp=file+'.agent-zdt-baseline-refresh-'+label+'-'+process.pid+'-'+Date.now()+'.tmp';
  let fd=null;
  try{
    fd=fs.openSync(tmp,'wx',meta.mode);
    fs.writeFileSync(fd,bytes);
    fs.fsyncSync(fd);
    fs.fchmodSync(fd,meta.mode);
    fs.fchownSync(fd,meta.uid,meta.gid);
    fs.closeSync(fd);fd=null;
    fs.renameSync(tmp,file);
    fsyncDir(dir);
  }finally{
    if(fd!==null)try{fs.closeSync(fd);}catch{}
    try{fs.unlinkSync(tmp);}catch{}
  }
}
function writeJson(file,value){
  const data=Buffer.from(JSON.stringify(value,null,2)+'\n');
  const dir=path.dirname(file);
  const tmp=file+'.'+process.pid+'.tmp';
  let fd=null;
  try{
    fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,data);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(tmp,file);fsyncDir(dir);
  }finally{if(fd!==null)try{fs.closeSync(fd);}catch{};try{fs.unlinkSync(tmp);}catch{}}
}
function backupState(state){
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const dir=path.join(BACKUP_ROOT,stamp);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.chmodSync(dir,0o700);
  const files=[];
  for(let i=0;i<TARGETS.length;i++){
    const dst=path.join(dir,i===0?'canonical.js':'installed.js');
    fs.copyFileSync(TARGETS[i],dst,fs.constants.COPYFILE_EXCL);fs.chmodSync(dst,0o600);
    files.push({source:TARGETS[i],backup:dst,sha256:shaBuf(state.originals[i]),mode:state.metas[i].mode,uid:state.metas[i].uid,gid:state.metas[i].gid});
  }
  writeJson(path.join(dir,'manifest.json'),{action:ACTION,created_at:new Date().toISOString(),files});
  return{dir,files};
}
function rollback(backup){
  for(let i=0;i<TARGETS.length;i++){
    const meta=backup.files[i];
    const bytes=fs.readFileSync(meta.backup);
    atomicWrite(TARGETS[i],bytes,{mode:meta.mode,uid:meta.uid,gid:meta.gid},'rollback-'+i);
  }
  for(const file of TARGETS){
    const actual=shaFile(file);
    if(actual!==HELPER_BEFORE)fail('rollback_sha_mismatch:'+file+':'+actual);
  }
  if(!fs.readFileSync(TARGETS[0]).equals(fs.readFileSync(TARGETS[1])))fail('rollback_helpers_not_byte_identical');
  return true;
}
function verifyApplied(state){
  if(!validSha(EXPECTED_RESULTING_HELPER_SHA))fail('resulting_helper_sha_unpinned');
  if(state.candidateSha!==EXPECTED_RESULTING_HELPER_SHA)fail('resulting_helper_sha_mismatch:candidate');
  for(const file of TARGETS){
    if(!safeRegular(file))fail('unsafe_target_after_write:'+file);
    const actual=shaFile(file);
    if(actual!==EXPECTED_RESULTING_HELPER_SHA)fail('resulting_helper_sha_mismatch:'+file+':'+actual);
    const text=fs.readFileSync(file,'utf8');
    if(count(text,BASE_OLD)!==0||count(text,EXEC_OLD)!==0)fail('old_literal_after_write');
    if(count(text,BASE_NEW)!==1||count(text,EXEC_NEW)!==1)fail('new_literal_after_write_count_invalid');
    syntaxCheck(fs.readFileSync(file),'post-'+path.basename(path.dirname(file)));
  }
  if(!fs.readFileSync(TARGETS[0]).equals(fs.readFileSync(TARGETS[1])))fail('candidate_helpers_not_byte_identical');
  verifyProtected();
  return true;
}
function apply(){
  const state=inspectAndDerive();
  if(!validSha(EXPECTED_RESULTING_HELPER_SHA))fail('resulting_helper_sha_unpinned');
  if(state.candidateSha!==EXPECTED_RESULTING_HELPER_SHA)fail('resulting_helper_sha_mismatch:candidate');
  const backup=backupState(state);
  let mutationStarted=false;
  try{
    mutationStarted=true;
    atomicWrite(TARGET_CANONICAL,state.candidates[0],state.metas[0],'canonical');
    atomicWrite(TARGET_INSTALLED,state.candidates[1],state.metas[1],'installed');
    verifyApplied(state);
    return{
      ok:true,action:ACTION,preflight_only:false,production_mutation:true,database_mutation:false,service_restart_reload:false,
      target_count:2,target_sha_match:true,runtime_baseline_match:true,other_protected_sha_match:true,replacement_count_per_file:2,candidate_syntax_ok:true,
      original_helper_sha256:HELPER_BEFORE,resulting_helper_sha256:EXPECTED_RESULTING_HELPER_SHA,backup_directory:backup.dir,rollback_performed:false
    };
  }catch(error){
    if(mutationStarted){
      try{rollback(backup);}catch(rb){throw new Error('apply_failed_and_rollback_failed:'+String(error&&error.message||error)+':'+String(rb&&rb.message||rb));}
    }
    throw error;
  }
}
function main(){
  try{
    const mode=parseMode(process.argv.slice(2));
    if(mode==='--preflight-only'){
      const state=inspectAndDerive();
      process.stdout.write(JSON.stringify(preflightResult(state))+'\n');
      return;
    }
    process.stdout.write(JSON.stringify(apply())+'\n');
  }catch(error){
    process.stderr.write(String(error&&error.message||error).slice(0,1000)+'\n');
    process.exitCode=1;
  }
}

module.exports={ACTION,parseMode,count,replaceExactlyOnce,deriveOne,preflightResult};
if(require.main===module)main();
