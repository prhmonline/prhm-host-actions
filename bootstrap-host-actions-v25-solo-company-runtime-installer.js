#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='solo_company_runtime_install_surface_v1';
const EXPECTED_REGISTRY_SHA='73d9560b8758a969f0317fd4438b9b36eb4a1b2e1ee18dcd50d1c2329c52ea6a';
const IMMUTABLE_HOST_ACTIONS_V2_SHA='b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0';
const SOLO_PLUGIN_SHA='60cac9151ab434ff0b5a0f8c86651a226f8478a6c825a0513fd2a88c1c20ea5f';
const SOLO_CORE_SHA='68b0593efea6fe6a403214be57372e48ea767e1cb68b0c47e1498b6e210bd328';
const SOURCE_REPO='/home/agent/sshagent-repo';
const SOURCE_COMMIT='8d5ac81d4e234551953e0e73c653e557bc994cb1';
const SOURCE_PATHS=Object.freeze({
  plugin:'mcp-server/src/plugins/soloCompanyRuntimeInstall.js',
  core:'mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js'
});
const PATHS=Object.freeze({
  registry:'/home/agent/ssh-mcp-server/src/core/registry.js',
  hostActionsV2:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  soloPlugin:'/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstall.js',
  soloCore:'/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js'
});
const IMPORT_ANCHOR="import { registerHonartikIticketPreflightPlugin } from '../plugins/honartikIticketPreflight.js';";
const REGISTER_ANCHOR='  registerHonartikIticketPreflightPlugin(mcp, context);';
const IMPORT_LINE="import { registerSoloCompanyRuntimeInstallPlugin } from '../plugins/soloCompanyRuntimeInstall.js';";
const REGISTER_LINE='  registerSoloCompanyRuntimeInstallPlugin(mcp, context);';
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=m=>{throw new Error(m)};
const count=(s,n)=>s.split(n).length-1;

function readBytes(file){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(file)!==file)fail('not_regular:'+file);
  return fs.readFileSync(file);
}
function shaFile(file){return H(readBytes(file));}
function replaceOnce(source,anchor,replacement,label){
  if(count(source,anchor)!==1)fail(label+'_anchor_'+count(source,anchor));
  return source.replace(anchor,replacement);
}
function patchRegistry(source){
  if(source.includes(IMPORT_LINE)||source.includes(REGISTER_LINE))fail('already_patched');
  let out=replaceOnce(source,IMPORT_ANCHOR,IMPORT_ANCHOR+'\n'+IMPORT_LINE,'registry_import');
  out=replaceOnce(out,REGISTER_ANCHOR,REGISTER_ANCHOR+'\n'+REGISTER_LINE,'registry_register');
  if(count(out,IMPORT_LINE)!==1||count(out,REGISTER_LINE)!==1)fail('registry_postcondition');
  return out;
}
function sourceGitShowArgs(sourcePath){
  if(!Object.values(SOURCE_PATHS).includes(sourcePath))fail('source_path_not_allowlisted');
  return ['-c','safe.directory='+SOURCE_REPO,'-C',SOURCE_REPO,'show',SOURCE_COMMIT+':'+sourcePath];
}
function sourceBytes(sourcePath,wantSha,label){
  const r=cp.spawnSync('/usr/bin/git',sourceGitShowArgs(sourcePath),{
    encoding:null,timeout:20000,maxBuffer:1024*1024,
    env:{PATH:'/usr/bin:/bin',LC_ALL:'C',HOME:'/nonexistent'}
  });
  if(r.error||r.status!==0)fail('source_git_show_'+label+':'+String(r.stderr||r.error?.message||r.status));
  const bytes=Buffer.from(r.stdout||Buffer.alloc(0));
  if(H(bytes)!==wantSha)fail('source_'+label+'_sha_mismatch:'+H(bytes));
  return bytes;
}
function syntaxSource(label,bytes){
  const file='/tmp/prhm-v25-'+label+'-'+process.pid+'-'+Date.now()+'.mjs';
  fs.writeFileSync(file,bytes,{mode:0o600,flag:'wx'});
  try{
    const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check',file],{encoding:'utf8',timeout:20000,maxBuffer:120000});
    if(r.error||r.status!==0)fail('syntax_'+label+':'+String(r.stderr||r.stdout||r.error?.message||''));
  }finally{try{fs.unlinkSync(file)}catch{}}
}
function planExistingSoloState(state){
  const pluginExists=Boolean(state.pluginExists),coreExists=Boolean(state.coreExists);
  if(pluginExists&&state.pluginSha!==SOLO_PLUGIN_SHA)fail('installed_solo_plugin_sha_mismatch');
  if(coreExists&&state.coreSha!==SOLO_CORE_SHA)fail('installed_solo_core_sha_mismatch');
  return {
    pluginAlreadyValid:pluginExists,
    coreAlreadyValid:coreExists,
    createPlugin:!pluginExists,
    createCore:!coreExists
  };
}
function filesystemSoloState(){
  const pluginExists=fs.existsSync(PATHS.soloPlugin),coreExists=fs.existsSync(PATHS.soloCore);
  return planExistingSoloState({
    pluginExists,
    pluginSha:pluginExists?shaFile(PATHS.soloPlugin):null,
    coreExists,
    coreSha:coreExists?shaFile(PATHS.soloCore):null
  });
}
function registryBindingState(source){
  const imports=count(source,IMPORT_LINE),registers=count(source,REGISTER_LINE);
  if((imports===0&&registers!==0)||(imports!==0&&registers===0)||imports>1||registers>1)fail('installed_registry_binding_invalid');
  return {bound:imports===1&&registers===1};
}
function validateInstalled(){
  const state=filesystemSoloState();
  const registry=readBytes(PATHS.registry).toString('utf8');
  const binding=registryBindingState(registry);
  if(!state.pluginAlreadyValid||!state.coreAlreadyValid||!binding.bound)return null;
  if(shaFile(PATHS.hostActionsV2)!==IMMUTABLE_HOST_ACTIONS_V2_SHA)fail('host_actions_v2_drift');
  return {
    ok:true,action:ACTION,already_installed:true,
    solo_plugin_sha256:SOLO_PLUGIN_SHA,solo_core_sha256:SOLO_CORE_SHA,
    host_actions_v2_sha256:IMMUTABLE_HOST_ACTIONS_V2_SHA,
    requires_zdt_refresh:true,production_application_mutation:false,database_mutation:false
  };
}
function preflight(){
  const prior=validateInstalled();
  if(prior)return {...prior,preflight_only:true};
  const registrySha=shaFile(PATHS.registry);
  if(registrySha!==EXPECTED_REGISTRY_SHA)fail('registry_baseline_sha_mismatch:'+registrySha);
  const hostSha=shaFile(PATHS.hostActionsV2);
  if(hostSha!==IMMUTABLE_HOST_ACTIONS_V2_SHA)fail('host_actions_v2_sha_mismatch:'+hostSha);
  const plugin=sourceBytes(SOURCE_PATHS.plugin,SOLO_PLUGIN_SHA,'plugin');
  const core=sourceBytes(SOURCE_PATHS.core,SOLO_CORE_SHA,'core');
  const patched=patchRegistry(readBytes(PATHS.registry).toString('utf8'));
  syntaxSource('plugin',plugin);syntaxSource('core',core);syntaxSource('registry',Buffer.from(patched));
  const state=filesystemSoloState();
  return {
    ok:true,action:ACTION,preflight_only:true,already_installed:false,
    baseline_match:true,current_registry_sha256:EXPECTED_REGISTRY_SHA,
    host_actions_v2_sha256:IMMUTABLE_HOST_ACTIONS_V2_SHA,
    candidate_registry_sha256:H(Buffer.from(patched)),
    solo_plugin_sha256:SOLO_PLUGIN_SHA,solo_core_sha256:SOLO_CORE_SHA,
    source_commit:SOURCE_COMMIT,plugin_already_valid:state.pluginAlreadyValid,
    core_already_valid:state.coreAlreadyValid,requires_zdt_refresh:true,
    production_application_mutation:false,database_mutation:false,service_control:false
  };
}
function atomicCreate(file,bytes,mode,uid,gid){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o755});
  const tmp=file+'.v25-'+process.pid+'-'+Date.now()+'.tmp';
  const fd=fs.openSync(tmp,'wx',mode);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  fs.chmodSync(tmp,mode);if(Number.isInteger(uid)&&Number.isInteger(gid))fs.chownSync(tmp,uid,gid);
  fs.renameSync(tmp,file);
}
function atomicReplace(file,bytes,st){
  const tmp=file+'.v25-'+process.pid+'-'+Date.now()+'.tmp';
  const fd=fs.openSync(tmp,'wx',st.mode&0o777);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  fs.chownSync(tmp,st.uid,st.gid);fs.renameSync(tmp,file);
}
function install(){
  const prior=validateInstalled();if(prior)return prior;
  const pf=preflight();
  const registryBytes=readBytes(PATHS.registry),registryStat=fs.statSync(PATHS.registry);
  const plugin=sourceBytes(SOURCE_PATHS.plugin,SOLO_PLUGIN_SHA,'plugin');
  const core=sourceBytes(SOURCE_PATHS.core,SOLO_CORE_SHA,'core');
  const patched=Buffer.from(patchRegistry(registryBytes.toString('utf8')));
  const state=filesystemSoloState();
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
  const backupDir='/var/backups/prhm-host-actions-v25-solo-runtime-installer-'+stamp;
  fs.mkdirSync(backupDir,{recursive:false,mode:0o700});
  const backup=path.join(backupDir,'registry.js.bak');
  fs.writeFileSync(backup,registryBytes,{flag:'wx',mode:0o600});
  let pluginCreated=false,coreCreated=false,registryChanged=false;
  try{
    if(state.createCore){atomicCreate(PATHS.soloCore,core,0o644,registryStat.uid,registryStat.gid);coreCreated=true;}
    if(shaFile(PATHS.soloCore)!==SOLO_CORE_SHA)fail('solo_core_post_sha');
    if(state.createPlugin){atomicCreate(PATHS.soloPlugin,plugin,0o644,registryStat.uid,registryStat.gid);pluginCreated=true;}
    if(shaFile(PATHS.soloPlugin)!==SOLO_PLUGIN_SHA)fail('solo_plugin_post_sha');
    atomicReplace(PATHS.registry,patched,registryStat);registryChanged=true;
    if(shaFile(PATHS.hostActionsV2)!==IMMUTABLE_HOST_ACTIONS_V2_SHA)fail('host_actions_v2_changed');
    const final=validateInstalled();if(!final)fail('final_validation_incomplete');
    return {...final,installed:true,already_installed:false,backup_dir:backupDir,
      registry_sha256:shaFile(PATHS.registry),preflight:pf,source_commit:SOURCE_COMMIT,
      requires_zdt_refresh:true,service_control:false,rollback_performed:false};
  }catch(error){
    const rb=[];
    if(registryChanged)try{atomicReplace(PATHS.registry,fs.readFileSync(backup),registryStat)}catch(e){rb.push('registry:'+e.message)}
    if(pluginCreated)try{fs.unlinkSync(PATHS.soloPlugin)}catch(e){rb.push('plugin:'+e.message)}
    if(coreCreated)try{fs.unlinkSync(PATHS.soloCore)}catch(e){rb.push('core:'+e.message)}
    if(rb.length)fail('install_failed_and_rollback_failed:'+String(error.message||error)+':'+rb.join('|'));
    fail('install_failed_rolled_back:'+String(error.message||error));
  }
}
if(require.main===module){
  const arg=process.argv[2];
  const out=arg==='--preflight-only'?preflight():arg==='--apply'?install():fail('mode_required');
  console.log(JSON.stringify(out));
}
module.exports={ACTION,EXPECTED_REGISTRY_SHA,IMMUTABLE_HOST_ACTIONS_V2_SHA,SOLO_PLUGIN_SHA,SOLO_CORE_SHA,SOURCE_REPO,SOURCE_COMMIT,SOURCE_PATHS,PATHS,patchRegistry,sourceGitShowArgs,planExistingSoloState,preflight,install};
