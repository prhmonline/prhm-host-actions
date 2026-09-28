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
  if(!Number.isInteger(runtime?.uid)||runtime.uid<0||!Number.isInteger(runtime?.gid)||runtime.gid<0)fail('runtime_identity_invalid');
  const manifest=bootstrap.freezeManifest(targetHashes,preimages);
  return deepFreeze({
    schema:'prhm.drtarjomeh-security-release-binding.v1',
    target_commit:bootstrap.TARGET_COMMIT,
    expected_release:bootstrap.EXPECTED_RELEASE,
    manifest,
    env_preimage:envPreimage,
    runtime:{uid:runtime.uid,gid:runtime.gid},
  });
}
function fixtureBinding(){
  const targetHashes={};const preimages={};let i=1;
  for(const rel of Object.keys(bootstrap.PAYLOAD)){
    targetHashes[rel]=(i.toString(16).padStart(2,'0').repeat(32)).slice(0,64);
    preimages[rel]=i%5===0?'absent':{sha256:((i+40).toString(16).padStart(2,'0').repeat(32)).slice(0,64),isFile:true,isSymlink:false};
    i++;
  }
  return buildBinding({targetHashes,preimages,envPreimage:'absent',runtime:{uid:1001,gid:1001}});
}

function assertInstallPreflight(state){
  bootstrap.assertLiveBaseline(state?.hashes||{});
  for(const name of ['api_blue','api_green','mcp_blue','mcp_green']){
    if(state?.services?.[name]!=='active')fail('control_plane_not_stable:'+name);
  }
  return true;
}

function buildInstallPlan(source,helperSource,helperSha){
  if(!SHA256.test(String(helperSha||'')))fail('helper_sha_invalid');
  const actualHelperSha=sha(Buffer.from(helperSource));
  if(actualHelperSha!==helperSha)fail('helper_sha_mismatch');
  const files={
    base:bootstrap.buildBaseCandidate(source.base),
    exec:bootstrap.buildExecCandidate(source.exec,helperSha),
    policy:bootstrap.buildPolicyCandidate(source.policy),
    mcp:bootstrap.buildMcpCandidate(source.mcp),
    helper:helperSource,
  };
  const hashes={};
  for(const [key,value] of Object.entries(files))hashes[key]=sha(Buffer.from(value));
  return Object.freeze({
    paths:PATHS,
    files:Object.freeze(files),
    sha256:Object.freeze(hashes),
    production_application_mutation:false,
    database_mutation:false,
  });
}

function createFixtureInstallerAdapter(fsState,options={}){
  const source={
    base:[
      'const HOST_ACTION_V2_SPECS = Object.freeze({',
      "  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' }",
      '});',
      'const HOST_ACTION_V2_LEVEL3 = new Set(["control_plane_root_scripts_stage_transport_v1"]);',
    ].join('\n'),
    exec:[
      "const ACTION_SPECS={control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'},};",
      'const applyHostActionV2Original=applyHostActionV2;',
      "applyHostActionV2=async function(action){if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();return applyHostActionV2Original(action);};",
    ].join('\n'),
    policy:JSON.stringify({schema_version:'prhm.approval-policy.v1',version:'2026-09-05.3-autonomous-operator-v1',operations:{},typed_scopes:[]},null,2),
    mcp:"const HostActionV2=z.enum(['control_plane_root_scripts_stage_transport_v1']);",
  };
  const binding=options.binding||fixtureBinding();
  return {
    preflight:()=>({hashes:{base:bootstrap.BASE_SHA,exec:bootstrap.EXEC_SHA,policy:bootstrap.POLICY_SHA,mcp:bootstrap.MCP_SHA},services:{api_blue:'active',api_green:'active',mcp_blue:'active',mcp_green:'active'}}),
    readSources:()=>source,
    binding:()=>binding,
    backup:()=>({...fsState}),
    atomic:(key,value)=>{fsState[key]=value},
    nodeCheck:()=>true,
    jsonCheck:value=>{JSON.parse(value);return true},
    reload:()=>true,
    verifyInstalledHashes:plan=>{if(options.failVerify)return false;for(const key of Object.keys(plan.files)){if(sha(Buffer.from(fsState[key]??''))!==plan.sha256[key])return false}return true},
    rollback:backup=>{for(const key of Object.keys(fsState))delete fsState[key];Object.assign(fsState,backup);return true},
    persistResult:()=>true,
  };
}

function install(adapter,options={}){
  let backup=null;
  let mutated=false;
  try{
    const preflight=adapter.preflight();
    assertInstallPreflight(preflight);
    const source=adapter.readSources();
    const binding=adapter.binding();
    const helperSource=bootstrap.buildHelperSource(binding);
    const helperSha=sha(Buffer.from(helperSource));
    const plan=buildInstallPlan(source,helperSource,helperSha);
    backup=adapter.backup(PATHS);
    for(const key of ['helper','base','exec','policy','mcp']){
      adapter.atomic(key,plan.files[key]);
      mutated=true;
    }
    adapter.nodeCheck(plan.files.base,'base');
    adapter.nodeCheck(plan.files.exec,'exec');
    adapter.nodeCheck(plan.files.mcp,'mcp');
    adapter.nodeCheck(plan.files.helper,'helper');
    adapter.jsonCheck(plan.files.policy);
    adapter.reload();
    if(adapter.verifyInstalledHashes(plan)!==true)fail('verify_installed_hashes_failed');
    const result={ok:true,schema_version:'prhm.host-action-result.v1',action:'drtarjomeh_security_release_installer_v1',installed:true,installed_targets:Object.fromEntries(Object.keys(PATHS).map(k=>[k,PATHS[k]])),helper_sha256:helperSha,helper_bound:true,rollback_performed:false,production_application_mutation:false,database_mutation:false};
    adapter.persistResult(result,INSTALL_RESULT);
    return result;
  }catch(error){
    let rollbackOk=true;
    if(mutated&&backup){try{rollbackOk=adapter.rollback(backup,PATHS)!==false}catch{rollbackOk=false}}
    const result={ok:false,schema_version:'prhm.host-action-result.v1',action:'drtarjomeh_security_release_installer_v1',installed:false,rollback_performed:mutated,rollback_verified:rollbackOk,production_application_mutation:false,database_mutation:false,error:'install_failed'};
    try{adapter.persistResult(result,INSTALL_RESULT)}catch{}
    return result;
  }
}

function execFile(file,args,opt={}){
  const r=cp.spawnSync(file,args,{encoding:'utf8',timeout:opt.timeout||30000,maxBuffer:1024*1024,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LC_ALL:'C'}});
  if(r.error||r.status!==0)fail('exec_failed:'+path.basename(file));
  return String(r.stdout||'').trim();
}

module.exports={PATHS,INSTALL_RESULT,INSTALL_BACKUP_ROOT,buildBinding,fixtureBinding,assertInstallPreflight,buildInstallPlan,createFixtureInstallerAdapter,install,sha,execFile};