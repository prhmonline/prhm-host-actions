'use strict';
// Exact-source, no-argument Root-of-Trust worker. MUST ONLY be invoked
// by an independently authorized Host Actions V2 L4 dispatcher under systemd.
// No network downloads, user-selected path, command, release, or credentials.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');

const ACTION='solo_company_runtime_install_v1';
const RELEASE_SHA='0eb43d72aab3f10db22172c8be4c0411cf22d074';
const SOURCE='/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js';
const SOURCE_SHA256='a93abca70f158729e0e22d39717a6e10a4025b18c44bf60a774ce3bf63fa41dd';
const RESULT='/var/lib/prhm-agent-selfmaint-exec/solo-company-runtime-install-v1/root-action-result.json';
const SCHEMA='prhm.solo-runtime-root-result.v1';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const die=m=>{throw new Error(m)};
function environmentPreflight(){
  if(process.getuid?.()!==0)die('root_required');
  if(process.env.PRHM_SOLO_HOST_ACTION_V1!=='fixed-root-transaction-v1')die('host_action_context_missing');
  if(!process.env.INVOCATION_ID)die('transient_systemd_context_missing');
  if(process.env.PORT!=='8123')die('agent2_router_port_mismatch');
  if(process.argv.length!==2)die('no_arguments_allowed');
}
function loadImmutableCore(){
  const st=fs.lstatSync(SOURCE);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(SOURCE)!==SOURCE)die('source_not_regular');
  const bytes=fs.readFileSync(SOURCE);
  if(sha(bytes)!==SOURCE_SHA256)die('solo_runtime_core_sha_mismatch');
  // Load a root-owned snapshot instead of importing the mutable MCP source
  // by path, which would permit a source replacement race after SHA check.
  const dir=fs.mkdtempSync('/run/prhm-solo-root-action-');
  fs.chmodSync(dir,0o700);
  const file=path.join(dir,'install-core.mjs');
  fs.writeFileSync(file,bytes,{mode:0o600,flag:'wx'});
  if(sha(fs.readFileSync(file))!==SOURCE_SHA256)die('snapshot_sha_mismatch');
  return {dir,file};
}
function atomicResult(data){
  fs.mkdirSync(path.dirname(RESULT),{recursive:true,mode:0o700});
  const tmp=RESULT+'.'+process.pid+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(data)+'\n',{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,RESULT);
  fs.chmodSync(RESULT,0o600);
}
function safeCode(error){
  const value=String(error?.code||'solo_runtime_root_install_failed');
  return /^[a-z0-9_]{1,100}$/.test(value)?value:'solo_runtime_root_install_failed';
}
async function run(){
  environmentPreflight();
  let snapshot;
  try{
    snapshot=loadImmutableCore();
    const mod=await import(pathToFileURL(snapshot.file).href);
    if(mod.RELEASE_SHA!==RELEASE_SHA||typeof mod.performAuthorizedRootHostActionV1!=='function')die('root_entrypoint_binding_invalid');
    const out=await mod.performAuthorizedRootHostActionV1();
    if(out?.ok!==true||out.release_sha!==RELEASE_SHA||out.service_active!==true||out.service_enabled!==true)die('root_install_evidence_invalid');
    const result={ok:true,schema_version:SCHEMA,action:ACTION,release_sha:RELEASE_SHA,source_sha256:SOURCE_SHA256,service_active:true,service_enabled:true,rollback_performed:false,dark_mode:out.dark_mode||null};
    atomicResult(result);
    return result;
  }catch(error){
    const result={ok:false,schema_version:SCHEMA,action:ACTION,release_sha:RELEASE_SHA,error:safeCode(error),rollback_performed:error?.rollback_performed===true};
    atomicResult(result);
    process.exitCode=21;
    return result;
  }finally{
    if(snapshot)fs.rmSync(snapshot.dir,{recursive:true,force:true});
  }
}
if(require.main===module){
  run().then(r=>console.log(JSON.stringify({ok:r.ok,action:r.action,release_sha:r.release_sha,rollback_performed:r.rollback_performed,error:r.error||undefined})))
       .catch(()=>{process.exitCode=22});
}
module.exports={ACTION,RELEASE_SHA,SOURCE,SOURCE_SHA256,RESULT,SCHEMA,sha,safeCode,environmentPreflight,loadImmutableCore,run};
