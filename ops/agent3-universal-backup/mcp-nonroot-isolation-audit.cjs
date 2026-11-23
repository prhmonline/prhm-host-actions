'use strict';
/**
 * READ-ONLY fixed-scope MCP privilege isolation audit for prhm-production.
 *
 * No writes, accounts, chmod/chown, restarts, approval traffic, or user-
 * supplied paths/commands. Reports metadata only; never file content,
 * service environments, process arguments, keys, tokens or source bytes.
 *
 * This is a migration planning gate, NOT permission to deploy Native v3.
 */
const fs=require('node:fs');
const cp=require('node:child_process');
const {constants}=fs;
const PATHS=Object.freeze({
 plugin:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
 workspace:'/home/prhm/projects/generated/rahekomak',
 runDirectory:'/run/prhm-agent-selfmaint-exec',
 socket:'/run/prhm-agent-selfmaint-exec/exec.sock'
});
const UNITS=Object.freeze([
 'prhm-agent-selfmaint-exec',
 'prhm-agent-mcp-blue',
 'prhm-agent-mcp-green'
]);
const TARGET_ACCOUNT='prhm-mcp';
function deny(reason){throw Error('agent3_mcp_isolation_audit_denied:'+reason);}
function entry(path){
 const st=fs.lstatSync(path);
 if(st.isSymbolicLink())deny('symlink_in_fixed_path');
 const kind=st.isDirectory()?'directory':st.isSocket()?'socket':st.isFile()?'file':'other';
 if(kind==='other')deny('unsupported_fixed_path_type');
 return Object.freeze({uid:st.uid,gid:st.gid,mode:st.mode&0o777,kind});
}
function parseService(output){
 if(typeof output!=='string'||output.length>16000)deny('invalid_service_response');
 const props={};
 for(const line of output.trim().split('\n')){
  const idx=line.indexOf('=');
  if(idx<1)continue;
  const key=line.slice(0,idx);
  if(['User','Group','ActiveState','SubState','NoNewPrivileges',
       'ProtectSystem','WorkingDirectory'].includes(key))props[key]=line.slice(idx+1);
 }
 return Object.freeze({
  user:props.User||'root',group:props.Group||'root',
  active:props.ActiveState==='active'&&props.SubState==='running',
  no_new_privileges:props.NoNewPrivileges==='yes',
  protect_system:props.ProtectSystem||'unset',
  // boolean only; do not print arbitrary WorkingDirectory source.
  workdir_matches:props.WorkingDirectory==='/home/agent/ssh-mcp-server'
 });
}
function targetIdentity(){
 try{
  const output=cp.execFileSync('/usr/bin/id',['-u',TARGET_ACCOUNT],{
   encoding:'utf8',timeout:3500,maxBuffer:200,stdio:['ignore','pipe','ignore']
  }).trim();
  const uid=Number(output);
  if(!Number.isSafeInteger(uid)||uid<0)deny('target_account_invalid_uid');
  return Object.freeze({present:true,nonroot:uid!==0});
 }catch(e){
  if(e.message&&e.message.startsWith('agent3_mcp_isolation_audit_denied:'))throw e;
  if(e.status===1)return Object.freeze({present:false,nonroot:false});
  deny('target_account_lookup_failed');
 }
}
function evaluate({paths,units,account}={}){
 if(!paths||!units||!account)deny('complete_fixed_evidence_required');
 if(Object.keys(paths).sort().join('|')!==Object.keys(PATHS).sort().join('|')||
    Object.keys(units).sort().join('|')!==[...UNITS].sort().join('|'))
  deny('fixed_scope_only');
 for(const [name,kind] of [['plugin','file'],['workspace','directory'],
    ['runDirectory','directory'],['socket','socket']]){
  const p=paths[name];
  if(!p||p.kind!==kind||!Number.isInteger(p.uid)||
     !Number.isInteger(p.gid)||!Number.isInteger(p.mode)||
     p.mode<0||p.mode>0o777)deny('invalid_metadata:'+name);
 }
 const problems=[];
 function block(flag,id){if(flag)problems.push(id);}
 const mcp=UNITS.slice(1).map(n=>units[n]);
 if(mcp.some(v=>!v||typeof v.user!=='string')||
    !units[UNITS[0]]||typeof units[UNITS[0]].user!=='string')
  deny('missing_service_identity');
 block(units[UNITS[0]].active!==true||mcp.some(x=>x.active!==true),'SERVICE_NOT_ACTIVE');
 block(mcp.some(x=>x.user==='root'),'ROOT_RUNNING_MCP');
 block(!account.present,'DEDICATED_MCP_ACCOUNT_ABSENT');
 block(account.present&&!account.nonroot,'DEDICATED_MCP_ACCOUNT_IS_ROOT');
 block(paths.plugin.uid===0&&(paths.plugin.mode&0o077)===0,
   'ROOT_ONLY_PLUGIN_READ');
 block(paths.workspace.uid===0&&(paths.workspace.mode&0o007)===0,
   'WORKSPACE_NONROOT_ACCESS_UNVERIFIED');
 block(paths.runDirectory.uid===0&&(paths.runDirectory.mode&0o007)===0,
   'SOCKET_DIRECTORY_NONROOT_ACCESS_UNVERIFIED');
 block(paths.socket.uid===0&&paths.socket.gid===0&&(paths.socket.mode&0o007)===0,
   'ROOT_GROUP_ONLY_SOCKET');
 block(mcp.some(x=>!x.workdir_matches),'MCP_WORKDIR_DRIFT');
 block(mcp.some(x=>!x.no_new_privileges),'MCP_NO_NEW_PRIVILEGES_MISSING');
 // Deliberately never claim readiness based on DAC permissions alone.
 const mandatory=[
  'independent_server_owned_SO_PEERCRED_implementation_review',
  'least_privilege_MCP_file_and_project_dependency_validation',
  'new_dedicated_nonroot_user_and_exact_socket_group_only_after_review',
  'Blue_Green_isolated_compatibility_tests_and_health',
  'separate_account_systemd_acl_and_owner_file_rollback',
  'four_owner_manifest_and_single_use_signed_Level4_approval'
 ];
 return Object.freeze({
  schema:'prhm.agent3.mcp-nonroot-readonly-audit.v1',
  host:'prhm-production',
  mode:'READ_ONLY_METADATA_ONLY',
  target_account:TARGET_ACCOUNT,
  target_account_present:account.present,
  service_users:Object.freeze(Object.fromEntries(UNITS.map(n=>[n,units[n].user]))),
  path_metadata:Object.freeze(Object.fromEntries(Object.keys(PATHS).map(k=>[
   k,{uid:paths[k].uid,gid:paths[k].gid,mode:paths[k].mode.toString(8).padStart(3,'0')}
  ]))),
  blockers:Object.freeze(problems),
  mandatory_security_gates:Object.freeze(mandatory),
  nonroot_migration_ready:false,
  native_v3_registration_ready:false,
  production_mutation:false,
  approval_requested:false,
  approval_consumed:false
 });
}
function run(){
 if(process.getuid?.()!==0)deny('root_readonly_metadata_required');
 const paths=Object.fromEntries(Object.entries(PATHS).map(([name,p])=>[name,entry(p)]));
 const units=Object.fromEntries(UNITS.map(n=>{
  const output=cp.execFileSync('/usr/bin/systemctl',
   ['show',n,'--property=User,Group,ActiveState,SubState,NoNewPrivileges,ProtectSystem,WorkingDirectory',
    '--no-pager'],
   {encoding:'utf8',timeout:6500,maxBuffer:16000,stdio:['ignore','pipe','ignore']});
  return [n,parseService(output)];
 }));
 return evaluate({paths,units,account:targetIdentity()});
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--check'){
  process.stderr.write('read-only --check only; no apply or install\n');
  process.exitCode=64;
 }else{
  try{process.stdout.write(JSON.stringify(run())+'\n');}
  catch(e){process.stderr.write(String(e.message||e)+'\n');process.exitCode=78;}
 }
}
module.exports=Object.freeze({PATHS,UNITS,TARGET_ACCOUNT,parseService,evaluate,run});
