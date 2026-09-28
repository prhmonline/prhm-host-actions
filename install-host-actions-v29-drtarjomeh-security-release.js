'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const bootstrap=require('./bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js');

const PATHS=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  exec:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  helper:'/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-security-release-deploy-v1.js',
});
const INSTALL_RESULT='/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-security-release-installer-v1/latest.json';
const INSTALL_BACKUP_ROOT='/var/backups/prhm-drtarjomeh-security-release-installer-v1';
const SHA256=/^[a-f0-9]{64}$/;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fail(message){throw new Error(message)}
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const v of Object.values(value))deepFreeze(v)}return value}

function buildBinding({targetHashes,preimages,envPreimage,runtime}){
  if(!(envPreimage==='absent'||SHA256.test(String(envPreimage||''))))fail('env_preimage_invalid');
  if(!Number.isInteger(runtime?.uid)||runtime.uid<=0||!Number.isInteger(runtime?.gid)||runtime.gid<0)fail('runtime_identity_invalid');
  const manifest=bootstrap.freezeManifest(targetHashes,preimages);
  return deepFreeze({schema:'prhm.drtarjomeh-security-release-binding.v1',target_commit:bootstrap.TARGET_COMMIT,expected_release:bootstrap.EXPECTED_RELEASE,manifest,env_preimage:envPreimage,runtime:{uid:runtime.uid,gid:runtime.gid}});
}
function fixtureBinding(){
  const targetHashes={};const preimages={};let i=1;
  for(const rel of Object.keys(bootstrap.PAYLOAD)){
    targetHashes[rel]=(i.toString(16).padStart(2,'0').repeat(32)).slice(0,64);
    preimages[rel]=i%5===0?'absent':{sha256:((i+40).toString(16).padStart(2,'0').repeat(32)).slice(0,64),isFile:true,isSymlink:false};i++;
  }
  return buildBinding({targetHashes,preimages,envPreimage:'absent',runtime:{uid:1001,gid:1001}});
}
function collectBinding(adapter){
  bootstrap.assertExpectedRelease(adapter.productionRealpath());
  const meta=adapter.releaseMetadata();
  if(!meta||meta.isDirectory!==true||meta.isSymlink===true)fail('release_metadata_invalid');
  if(!Number.isInteger(meta.uid)||meta.uid<=0||!Number.isInteger(meta.gid)||meta.gid<0)fail('runtime_identity_invalid');
  const targetHashes={};const preimages={};
  for(const rel of Object.keys(bootstrap.PAYLOAD)){
    const bytes=adapter.targetBytes(rel);targetHashes[rel]=sha(Buffer.from(bytes));
    const observed=adapter.preimage(rel);
    if(!observed||observed.exists===false)preimages[rel]='absent';
    else{
      if(observed.isSymlink===true||observed.isFile!==true||!SHA256.test(String(observed.sha256||'')))fail('preimage_invalid:'+rel);
      preimages[rel]={sha256:observed.sha256,isFile:true,isSymlink:false};
    }
  }
  const env=adapter.envState();let envPreimage='absent';
  if(env?.exists===true){if(env.isSymlink===true||env.isFile!==true||(env.mode&0o777)!==0o600||!SHA256.test(String(env.sha256||'')))fail('env_preimage_invalid');envPreimage=env.sha256}
  return buildBinding({targetHashes,preimages,envPreimage,runtime:{uid:meta.uid,gid:meta.gid}});
}

function assertInstallPreflight(state){
  bootstrap.assertLiveBaseline(state?.hashes||{});
  for(const name of ['api_blue','api_green','mcp_blue','mcp_green'])if(state?.services?.[name]!=='active')fail('control_plane_not_stable:'+name);
  return true;
}
function buildInstallPlan(source,helperSource,helperSha){
  if(!SHA256.test(String(helperSha||'')))fail('helper_sha_invalid');
  if(sha(Buffer.from(helperSource))!==helperSha)fail('helper_sha_mismatch');
  const files={base:bootstrap.buildBaseCandidate(source.base),exec:bootstrap.buildExecCandidate(source.exec,helperSha),policy:bootstrap.buildPolicyCandidate(source.policy),mcp:bootstrap.buildMcpCandidate(source.mcp),helper:helperSource};
  const hashes={};for(const [key,value] of Object.entries(files))hashes[key]=sha(Buffer.from(value));
  return Object.freeze({paths:PATHS,files:Object.freeze(files),sha256:Object.freeze(hashes),production_application_mutation:false,database_mutation:false});
}

function createFixtureInstallerAdapter(fsState,options={}){
  const source={
    base:['const HOST_ACTION_V2_SPECS = Object.freeze({',"  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' }",'});','const HOST_ACTION_V2_LEVEL3 = new Set(["control_plane_root_scripts_stage_transport_v1"]);'].join('\n'),
    exec:["const ACTION_SPECS={control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'},};",'const applyHostActionV2Original=applyHostActionV2;',"applyHostActionV2=async function(action){if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();return applyHostActionV2Original(action);};"].join('\n'),
    policy:JSON.stringify({schema_version:'prhm.approval-policy.v1',version:'2026-09-05.3-autonomous-operator-v1',operations:{},typed_scopes:[]},null,2),
    mcp:"const HostActionV2=z.enum(['control_plane_root_scripts_stage_transport_v1']);",
  };
  const binding=options.binding||fixtureBinding();
  return {preflight:()=>({hashes:{base:bootstrap.BASE_SHA,exec:bootstrap.EXEC_SHA,policy:bootstrap.POLICY_SHA,mcp:bootstrap.MCP_SHA},services:{api_blue:'active',api_green:'active',mcp_blue:'active',mcp_green:'active'}}),readSources:()=>source,binding:()=>binding,backup:()=>({...fsState}),atomic:(key,value)=>{fsState[key]=value},nodeCheck:()=>true,jsonCheck:value=>{JSON.parse(value);return true},reload:()=>true,verifyInstalledHashes:plan=>{if(options.failVerify)return false;for(const key of Object.keys(plan.files))if(sha(Buffer.from(fsState[key]??''))!==plan.sha256[key])return false;return true},rollback:backup=>{for(const key of Object.keys(fsState))delete fsState[key];Object.assign(fsState,backup);return true},persistResult:()=>true};
}

function productionDeps(){
  const prodPointer='/home/drtarjomeh/domains/drtarjomeh.ir/public_html';
  const releasesRoot='/home/drtarjomeh/domains/drtarjomeh.ir/releases';
  const sourceRepository='/home/drtarjomeh/domains/drtarjomeh.ir/repository';
  const envPath='/etc/drtarjomeh/production.env';
  const services=Object.freeze({api_blue:'prhm-agent-api-blue.service',api_green:'prhm-agent-api-green.service',mcp_blue:'prhm-agent-mcp-blue.service',mcp_green:'prhm-agent-mcp-green.service'});
  const restartServices=Object.freeze(['prhm-company-approval.service','prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service','prhm-agent-mcp-blue.service','prhm-agent-mcp-green.service']);
  const run=(file,args,opt={})=>cp.spawnSync(file,args,{encoding:opt.encoding===null?null:'utf8',timeout:opt.timeout||60000,maxBuffer:opt.maxBuffer||16*1024*1024,cwd:opt.cwd,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C'}});
  const must=(r,label)=>{if(r.error||r.status!==0)fail(label);return r};
  const read=file=>fs.readFileSync(file,'utf8');
  const inspect=file=>{if(!fs.existsSync(file))return{exists:false};const st=fs.lstatSync(file);return{exists:true,isFile:st.isFile(),isSymlink:st.isSymbolicLink(),mode:st.mode&0o777,uid:st.uid,gid:st.gid,sha256:st.isFile()&&!st.isSymbolicLink()?sha(fs.readFileSync(file)):null}};
  const expectedRoot=path.join(releasesRoot,bootstrap.EXPECTED_RELEASE);
  const deps={
    productionRealpath:()=>fs.realpathSync(prodPointer),
    releaseMetadata:()=>{const st=fs.lstatSync(expectedRoot);return{isDirectory:st.isDirectory(),isSymlink:st.isSymbolicLink(),uid:st.uid,gid:st.gid}},
    targetBytes:rel=>{bootstrap.assertSafeRelativePath(rel);const r=must(run('/usr/bin/git',['-C',sourceRepository,'show',bootstrap.TARGET_COMMIT+':'+rel],{encoding:null}),'target_read_failed:'+rel);return Buffer.from(r.stdout)},
    preimage:rel=>{bootstrap.assertSafeRelativePath(rel);return inspect(path.join(expectedRoot,rel))},
    envState:()=>inspect(envPath),
    preflight:()=>({hashes:{base:sha(Buffer.from(read(PATHS.base))),exec:sha(Buffer.from(read(PATHS.exec))),policy:sha(Buffer.from(read(PATHS.policy))),mcp:sha(Buffer.from(read(PATHS.mcp)))},services:Object.fromEntries(Object.entries(services).map(([k,s])=>{const r=run('/usr/bin/systemctl',['is-active',s],{timeout:10000});return[k,String(r.stdout||'').trim()]}))}),
    readSources:()=>({base:read(PATHS.base),exec:read(PATHS.exec),policy:read(PATHS.policy),mcp:read(PATHS.mcp)}),
    binding:()=>collectBinding(deps),
    backup:()=>{
      const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);const dir=path.join(INSTALL_BACKUP_ROOT,stamp+'-'+process.pid);fs.mkdirSync(dir,{recursive:true,mode:0o700});const entries={};
      for(const [key,file] of Object.entries(PATHS)){const info=inspect(file);entries[key]={existed:info.exists,mode:info.mode,uid:info.uid,gid:info.gid};if(info.exists){if(info.isSymlink||!info.isFile)fail('backup_target_invalid:'+key);const dst=path.join(dir,key+'.bak');fs.copyFileSync(file,dst,fs.constants.COPYFILE_EXCL);fs.chmodSync(dst,0o600);entries[key].backup=dst}}
      return{dir,entries};
    },
    atomic:(key,value)=>{
      const file=PATHS[key];if(!file)fail('atomic_target_invalid');const old=inspect(file);if(old.exists&&(old.isSymlink||!old.isFile))fail('atomic_target_invalid:'+key);fs.mkdirSync(path.dirname(file),{recursive:true});const mode=key==='helper'?0o700:(old.mode||0o644);const uid=old.exists?old.uid:0;const gid=old.exists?old.gid:0;const tmp=file+'.drt-v29-'+process.pid+'-'+Date.now()+'.tmp';let fd;try{fd=fs.openSync(tmp,'wx',mode);fs.writeFileSync(fd,value);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.chmodSync(tmp,mode);fs.chownSync(tmp,uid,gid);fs.renameSync(tmp,file)}catch(e){try{if(fd!==undefined)fs.closeSync(fd)}catch{}try{fs.unlinkSync(tmp)}catch{}throw e}
    },
    nodeCheck:(text,label)=>{const tmp='/tmp/prhm-drt-v29-'+process.pid+'-'+label+'.js';try{fs.writeFileSync(tmp,text,{mode:0o600,flag:'wx'});must(run('/usr/local/bin/prhm-node',['--check',tmp],{timeout:10000}),'node_syntax_invalid:'+label)}finally{try{fs.unlinkSync(tmp)}catch{}}},
    jsonCheck:value=>{JSON.parse(value);return true},
    reload:()=>{for(const service of restartServices)must(run('/usr/bin/systemctl',['restart',service],{timeout:60000}),'service_restart_failed:'+service);for(const service of restartServices){const r=run('/usr/bin/systemctl',['is-active',service],{timeout:10000});if(String(r.stdout||'').trim()!=='active')fail('service_not_active:'+service)}return true},
    verifyInstalledHashes:plan=>Object.entries(plan.sha256).every(([key,expected])=>inspect(PATHS[key]).sha256===expected),
    rollback:backup=>{let ok=true;for(const [key,file] of Object.entries(PATHS)){const e=backup.entries[key];try{if(e.existed){fs.copyFileSync(e.backup,file);fs.chmodSync(file,e.mode);fs.chownSync(file,e.uid,e.gid)}else if(fs.existsSync(file))fs.unlinkSync(file)}catch{ok=false}}try{for(const service of restartServices)must(run('/usr/bin/systemctl',['restart',service],{timeout:60000}),'rollback_restart_failed')}catch{ok=false}return ok},
    persistResult:(result,file=INSTALL_RESULT)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);return true},
  };
  return deps;
}

function install(adapter,options={}){
  let backup=null;let mutated=false;
  try{
    const preflight=adapter.preflight();assertInstallPreflight(preflight);
    const source=adapter.readSources();const binding=adapter.binding();const helperSource=bootstrap.buildHelperSource(binding);const helperSha=sha(Buffer.from(helperSource));const plan=buildInstallPlan(source,helperSource,helperSha);
    backup=adapter.backup(PATHS);
    for(const key of ['helper','base','exec','policy','mcp']){adapter.atomic(key,plan.files[key]);mutated=true}
    adapter.nodeCheck(plan.files.base,'base');adapter.nodeCheck(plan.files.exec,'exec');adapter.nodeCheck(plan.files.mcp,'mcp');adapter.nodeCheck(plan.files.helper,'helper');adapter.jsonCheck(plan.files.policy);adapter.reload();
    if(adapter.verifyInstalledHashes(plan)!==true)fail('verify_installed_hashes_failed');
    const result={ok:true,schema_version:'prhm.host-action-result.v1',action:'drtarjomeh_security_release_installer_v1',installed:true,installed_targets:Object.fromEntries(Object.keys(PATHS).map(k=>[k,PATHS[k]])),helper_sha256:helperSha,helper_bound:true,rollback_performed:false,production_application_mutation:false,database_mutation:false};adapter.persistResult(result,INSTALL_RESULT);return result;
  }catch(error){
    let rollbackOk=true;if(mutated&&backup){try{rollbackOk=adapter.rollback(backup,PATHS)!==false}catch{rollbackOk=false}}
    const result={ok:false,schema_version:'prhm.host-action-result.v1',action:'drtarjomeh_security_release_installer_v1',installed:false,rollback_performed:mutated,rollback_verified:rollbackOk,production_application_mutation:false,database_mutation:false,error:'install_failed'};try{adapter.persistResult(result,INSTALL_RESULT)}catch{}return result;
  }
}
function execFile(file,args,opt={}){const r=cp.spawnSync(file,args,{encoding:'utf8',timeout:opt.timeout||30000,maxBuffer:1024*1024,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C'}});if(r.error||r.status!==0)fail('exec_failed:'+path.basename(file));return String(r.stdout||'').trim()}
function main(){const args=process.argv.slice(2);if(args.length>1)fail('unexpected_arguments');const deps=productionDeps();if(args[0]==='--preflight-only'){const pf=deps.preflight();assertInstallPreflight(pf);const binding=deps.binding();process.stdout.write(JSON.stringify({ok:true,preflight:true,target_commit:binding.target_commit,expected_release:binding.expected_release,payload_count:Object.keys(binding.manifest).length,env_preimage:binding.env_preimage==='absent'?'absent':'present',runtime_uid:binding.runtime.uid,runtime_gid:binding.runtime.gid,credential_values_returned:false})+'\n');return}if(args.length!==0)fail('unexpected_argument:'+args[0]);const result=install(deps);process.exitCode=result.ok?0:1;process.stdout.write(JSON.stringify(result)+'\n')}

module.exports={PATHS,INSTALL_RESULT,INSTALL_BACKUP_ROOT,buildBinding,fixtureBinding,collectBinding,assertInstallPreflight,buildInstallPlan,createFixtureInstallerAdapter,productionDeps,install,sha,execFile};
if(require.main===module){try{main()}catch(error){console.error(String(error&&error.message||error));process.exit(1)}}