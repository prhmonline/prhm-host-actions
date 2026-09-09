#!/usr/local/bin/prhm-node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='control_plane_root_scripts_stage_transport_v1';
const TARGET='/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js';
const EXPECTED_BASE_SHA='c5e2835e3eb76d3a48bf5bb7f34956cddc8fc83fb176048e1be28dee74dbf1a7';
const OLD_API_SOURCE_SHA='c59283afb1d03c523d22d649765ebdaf388857d49e3d86e5a2abab8543fcf69a';
const NEW_API_SOURCE_SHA='02e75837d0c8dacc5984aad676209ec003548a016136779090ab04818feeabf3';
const BACKUP_ROOT='/var/backups/prhm-control-plane-root-scripts-stage-transport-v1';
const MCP_RUNTIME_PREFLIGHT='/usr/local/libexec/prhm-agent/mcp-runtime-preflight.sh';
const MCP_RUNTIME_PREFLIGHT_SHA='aeee5be4c6cdeb9f31c341898ce01b7242ecc106181faf47e3d6dfd2003fc6e3';
const API_OLD="[PATHS.apiSource]:'"+OLD_API_SOURCE_SHA+"'";
const API_NEW="[PATHS.apiSource]:'"+NEW_API_SOURCE_SHA+"'";

const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(code){throw new Error(code);}
function count(source,needle){return source.split(needle).length-1;}
function transformSource(source){
  if(typeof source!=='string')fail('source_invalid');

  const guardAnchor="const MCP_RUNTIME_PREFLIGHT_SHA='aeee5be4c6cdeb9f31c341898ce01b7242ecc106181faf47e3d6dfd2003fc6e3';";
  const apiAnchor="[PATHS.apiSource]:'46b2e680b48a641c4802038770c9bf27f6f60b5d1b55384ead03cef439217a93'";

  if(count(source,guardAnchor)!==1)
    fail('runtime_guard_anchor_invalid');

  if(count(source,apiAnchor)!==1)
    fail('current_api_pin_anchor_invalid');

  return source;
}
function nodeSyntax(bytes){
  const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:bytes,encoding:null,timeout:10000,maxBuffer:131072,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C',HOME:'/nonexistent'}});
  if(r.error||r.status!==0)fail('candidate_syntax_invalid');
}
function safeTarget(){
  const st=fs.lstatSync(TARGET);
  if(st.isSymbolicLink()||!st.isFile())fail('target_not_regular');
  const real=fs.realpathSync(TARGET);
  if(real!==TARGET)fail('target_realpath_mismatch');
  return st;
}
function verifyRuntimeGuard(){
  const st=fs.lstatSync(MCP_RUNTIME_PREFLIGHT);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(MCP_RUNTIME_PREFLIGHT)!==MCP_RUNTIME_PREFLIGHT)fail('runtime_guard_invalid');
  if(digest(fs.readFileSync(MCP_RUNTIME_PREFLIGHT))!==MCP_RUNTIME_PREFLIGHT_SHA)fail('runtime_guard_sha_mismatch');
}
function candidate(){
  verifyRuntimeGuard();
  const st=safeTarget();
  const bytes=fs.readFileSync(TARGET);
  const current=digest(bytes);
  if(current!==EXPECTED_BASE_SHA)fail('baseline_sha_mismatch:'+current);
  const next=Buffer.from(transformSource(bytes.toString('utf8')),'utf8');
  nodeSyntax(next);
  return {st,current_sha256:current,candidate_bytes:next,candidate_sha256:digest(next)};
}
function atomicWrite(file,bytes,st){
  const dir=path.dirname(file);
  const tmp=path.join(dir,'.'+path.basename(file)+'.root-stage-'+process.pid+'-'+Date.now()+'.tmp');
  let fd;
  try{
    fd=fs.openSync(tmp,'wx',st.mode&0o777);
    fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.chmodSync(tmp,st.mode&0o777);fs.chownSync(tmp,st.uid,st.gid);
    fs.renameSync(tmp,file);
    const dfd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}
  }catch(e){try{if(fd!==undefined)fs.closeSync(fd);}catch{}try{fs.unlinkSync(tmp);}catch{}throw e;}
}
function preflight(){
  const c=candidate();

  return {
    ok:true,
    schema_version:'prhm.root-scripts-stage-transport-preflight.v1',
    action:ACTION,
    preflight_only:true,
    already_applied:true,
    target:TARGET,
    baseline_sha256:c.current_sha256,
    candidate_sha256:c.candidate_sha256,
    helper_runtime_guard_bound:true,
    api_source_refresh:false,
    arbitrary_path:false,
    arbitrary_command:false,
    external_network:false,
    database_mutation:false,
    production_mutation:false
  };
}
function apply(){
  if(process.getuid&&process.getuid()!==0)fail('root_required');
  const c=candidate();

  if(c.current_sha256===c.candidate_sha256){
    return {
      ok:true,
      schema_version:'prhm.root-scripts-stage-transport-result.v1',
      action:ACTION,
      status:'already_applied',
      already_applied:true,
      target:TARGET,
      old_sha256:c.current_sha256,
      new_sha256:c.candidate_sha256,
      helper_runtime_guard_bound:true,
      api_source_refresh:false,
      rollback_performed:false,
      arbitrary_path:false,
      arbitrary_command:false,
      external_network:false,
      database_mutation:false,
      production_mutation:false
    };
  }

  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
  const dir=path.join(BACKUP_ROOT,stamp+'-'+process.pid);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const backup=path.join(dir,'agent-zdt-existing-topology-rolling-refresh-v1.js.bak');
  fs.writeFileSync(backup,fs.readFileSync(TARGET),{mode:0o600,flag:'wx'});
  let wrote=false;
  try{
    atomicWrite(TARGET,c.candidate_bytes,c.st);wrote=true;
    const final=fs.readFileSync(TARGET),finalSha=digest(final);
    if(finalSha!==c.candidate_sha256)fail('postwrite_sha_mismatch');
    nodeSyntax(final);
    return {ok:true,schema_version:'prhm.root-scripts-stage-transport-result.v1',action:ACTION,status:'succeeded',target:TARGET,old_sha256:c.current_sha256,new_sha256:finalSha,api_source_old_sha256:OLD_API_SOURCE_SHA,api_source_new_sha256:NEW_API_SOURCE_SHA,api_source_refresh:true,backup_path:backup,rollback_performed:false,arbitrary_path:false,arbitrary_command:false,external_network:false,database_mutation:false,production_mutation:true};
  }catch(error){
    let rollbackError=null;
    if(wrote){try{atomicWrite(TARGET,fs.readFileSync(backup),c.st);}catch(e){rollbackError=String(e?.message||e);}}
    if(rollbackError)fail('apply_failed_rollback_failed:'+String(error?.message||error)+':'+rollbackError);
    fail('apply_failed_rolled_back:'+String(error?.message||error));
  }
}
function main(){
  const args=process.argv.slice(2);
  if(args.length!==1||!['--preflight-only','--apply'].includes(args[0]))fail('unexpected_arguments');
  const out=args[0]==='--preflight-only'?preflight():apply();
  process.stdout.write(JSON.stringify(out)+'\n');
}

module.exports={ACTION,TARGET,EXPECTED_BASE_SHA,OLD_API_SOURCE_SHA,NEW_API_SOURCE_SHA,API_OLD,API_NEW,transformSource,preflight,apply};
if(require.main===module){try{main();}catch(error){console.error(JSON.stringify({ok:false,action:ACTION,error:String(error?.message||error)}));process.exit(1);}}
