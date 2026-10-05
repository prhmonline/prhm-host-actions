'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='agent_instant_delivery_mcp_candidate_refresh_v1';
const SOURCE_PATH='/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js';
const TARGET_PATH='/home/agent/candidates/agent3-instant-delivery-v1/mcp/src/plugins/hostActionsV2.js';
const SERVICE='prhm-agent-mcp-instant-delivery-candidate.service';
const SOURCE_SHA256='048e2db190c5548f47967447b3b564eefd0b7203cf6df84beb73c520d481633d';
const TARGET_PREIMAGE_SHA256='b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0';
const BACKUP_ROOT='/var/lib/prhm-agent-instant-delivery-v1/mcp-candidate-refresh-bridge/backups';
const RESULT_DIR='/var/lib/prhm-agent-instant-delivery-v1/mcp-candidate-refresh-bridge';
const RESULT_PATH=path.join(RESULT_DIR,'latest.json');
const NODE='/usr/local/bin/prhm-node';
const SYSTEMCTL='/usr/bin/systemctl';

function fail(message){throw new Error(message)}
function digest(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}
function assertFile(info,label){
  if(!info||info.isSymlink===true)fail(label+'_symlink');
  if(info.isFile!==true)fail(label+'_not_regular');
}
function createAction(adapter){
  const required=['stat','sha256','nodeCheck','readTarget','readSource','backup','atomicReplace','restore','restart','serviceHealthy'];
  for(const name of required)if(!adapter||typeof adapter[name]!=='function')fail('missing_adapter_'+name);

  function preflight(){
    assertFile(adapter.stat('source'),'source');
    assertFile(adapter.stat('target'),'target');
    const sourceSha=adapter.sha256('source');
    if(sourceSha!==SOURCE_SHA256)fail('source_sha_mismatch');
    const targetSha=adapter.sha256('target');
    if(targetSha===SOURCE_SHA256)return{ok:true,already_applied:true,before_sha256:targetSha};
    if(targetSha!==TARGET_PREIMAGE_SHA256)fail('target_sha_mismatch');
    adapter.nodeCheck('source');
    return{ok:true,already_applied:false,before_sha256:targetSha};
  }

  function apply(){
    const pf=preflight();
    if(pf.already_applied)return{
      ok:true,action:ACTION,already_applied:true,mutation:false,
      before_sha256:pf.before_sha256,after_sha256:pf.before_sha256,
      rollback_performed:false,mcp_candidate_mutation:false,
      api_candidate_mutation:false,router_mutation:false,database_mutation:false,
      production_application_mutation:false,
    };
    const preimage=adapter.readTarget();
    const candidate=adapter.readSource();
    const backupId=adapter.backup(preimage);
    let mutated=false;
    try{
      adapter.atomicReplace(candidate);
      mutated=true;
      const installed=adapter.sha256('target');
      if(installed!==SOURCE_SHA256)fail('installed_sha_mismatch');
      adapter.restart(SERVICE);
      if(adapter.serviceHealthy(SERVICE)!==true)fail('mcp_candidate_unhealthy');
      return{
        ok:true,action:ACTION,already_applied:false,mutation:true,
        before_sha256:pf.before_sha256,after_sha256:installed,backup_id:backupId,
        rollback_performed:false,verification:'PASS',mcp_candidate_mutation:true,
        api_candidate_mutation:false,router_mutation:false,database_mutation:false,
        production_application_mutation:false,
      };
    }catch(error){
      if(!mutated)throw error;
      try{
        adapter.restore(preimage);
        const restored=adapter.sha256('target');
        if(restored!==TARGET_PREIMAGE_SHA256)fail('rollback_sha_mismatch');
        adapter.restart(SERVICE);
        if(adapter.serviceHealthy(SERVICE)!==true)fail('rollback_service_unhealthy');
        return{
          ok:false,action:ACTION,status:'FAILED_ROLLED_BACK',error:String(error&&error.message||error),
          before_sha256:pf.before_sha256,after_sha256:restored,backup_id:backupId,
          rollback_performed:true,verification:'ROLLBACK_PASS',mcp_candidate_mutation:false,
          api_candidate_mutation:false,router_mutation:false,database_mutation:false,
          production_application_mutation:false,
        };
      }catch(rollbackError){
        throw new Error('candidate_refresh_failed_and_rollback_failed:'+String(error&&error.message||error)+':'+String(rollbackError&&rollbackError.message||rollbackError));
      }
    }
  }
  return Object.freeze({preflight,apply});
}

function productionAdapter(){
  let targetMeta=null;
  const fixedPath=which=>which==='source'?SOURCE_PATH:which==='target'?TARGET_PATH:fail('unknown_fixed_path');
  const statInfo=file=>{const st=fs.lstatSync(file);return{isFile:st.isFile(),isSymlink:st.isSymbolicLink(),mode:st.mode&0o777,uid:st.uid,gid:st.gid}};
  const run=(exe,args,label,timeout=60000)=>{const r=cp.spawnSync(exe,args,{encoding:'utf8',timeout,maxBuffer:1024*1024,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C'}});if(r.error||r.status!==0)fail(label);return String(r.stdout||'').trim()};
  const atomicWrite=(bytes,suffix)=>{
    if(!targetMeta)targetMeta=statInfo(TARGET_PATH);
    const dir=path.dirname(TARGET_PATH);
    const tmp=path.join(dir,'.hostActionsV2.js.'+suffix+'.'+process.pid+'.'+Date.now()+'.tmp');
    let fd;
    try{
      fd=fs.openSync(tmp,'wx',targetMeta.mode||0o644);
      fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      fs.chmodSync(tmp,targetMeta.mode||0o644);fs.chownSync(tmp,targetMeta.uid,targetMeta.gid);
      fs.renameSync(tmp,TARGET_PATH);
      const dfd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(dfd)}finally{fs.closeSync(dfd)}
    }catch(error){try{if(fd!==undefined)fs.closeSync(fd)}catch{}try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{}throw error}
  };
  return{
    stat(which){const info=statInfo(fixedPath(which));if(which==='target')targetMeta=info;return info},
    sha256(which){return digest(fs.readFileSync(fixedPath(which)))},
    nodeCheck(which){run(NODE,['--check',fixedPath(which)],'node_check_failed',30000);return true},
    readTarget(){return fs.readFileSync(TARGET_PATH)},
    readSource(){return fs.readFileSync(SOURCE_PATH)},
    backup(bytes){fs.mkdirSync(BACKUP_ROOT,{recursive:true,mode:0o700});const stamp=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14)+'Z';const file=path.join(BACKUP_ROOT,'hostActionsV2.js.'+stamp+'.'+TARGET_PREIMAGE_SHA256+'.bak');const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}return file},
    atomicReplace(bytes){atomicWrite(bytes,'candidate');return true},
    restore(bytes){atomicWrite(bytes,'rollback');return true},
    restart(service){if(service!==SERVICE)fail('service_not_allowlisted');run(SYSTEMCTL,['restart',SERVICE],'service_restart_failed',60000);return true},
    serviceHealthy(service){if(service!==SERVICE)fail('service_not_allowlisted');return run(SYSTEMCTL,['is-active',SERVICE],'service_health_failed',15000)==='active'},
  };
}

function executeMode(mode,adapter=productionAdapter()){
  if(mode==='preflight'){
    const out=createAction(adapter).preflight();
    return{...out,action:ACTION,mode:'preflight',mutation:false,production_mutation:false,mcp_candidate_mutation:false,api_candidate_mutation:false,router_mutation:false,database_mutation:false,production_application_mutation:false};
  }
  if(mode==='apply')return createAction(adapter).apply();
  fail('mode_not_allowlisted');
}
function persistResult(out){
  if(process.env.PRHM_MCP_CANDIDATE_REFRESH_RESULT!=='1')return null;
  fs.mkdirSync(RESULT_DIR,{recursive:true,mode:0o700});
  const bytes=Buffer.from(JSON.stringify({...out,recorded_at:new Date().toISOString()},null,2)+'\n','utf8');
  const tmp=RESULT_PATH+'.'+process.pid+'.'+Date.now()+'.tmp';
  fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(tmp,RESULT_PATH);fs.chmodSync(RESULT_PATH,0o600);
  return RESULT_PATH;
}

module.exports=Object.freeze({ACTION,SOURCE_PATH,TARGET_PATH,SERVICE,SOURCE_SHA256,TARGET_PREIMAGE_SHA256,BACKUP_ROOT,RESULT_PATH,createAction,productionAdapter,executeMode,persistResult});

if(require.main===module){
  const args=process.argv.slice(2);
  const flag=args.length===0?'--apply':args.length===1?args[0]:null;
  const mode=flag==='--preflight'?'preflight':flag==='--apply'?'apply':null;
  try{
    if(!mode)fail('unexpected_arguments');
    const out=executeMode(mode);
    persistResult(out);
    process.stdout.write(JSON.stringify(out)+'\n');
    if(out&&out.ok===false)process.exitCode=1;
  }catch(error){
    const out={ok:false,action:ACTION,mode:mode||'invalid',error:String(error&&error.message||error),production_mutation:false,mcp_candidate_mutation:false,production_application_mutation:false,database_mutation:false,api_candidate_mutation:false,router_mutation:false};
    try{persistResult(out)}catch{}
    process.stdout.write(JSON.stringify(out)+'\n');process.exitCode=1;
  }
}
