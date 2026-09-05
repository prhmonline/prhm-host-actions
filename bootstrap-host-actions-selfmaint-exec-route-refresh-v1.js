#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const ACTION='selfmaint_exec_route_refresh_v1';
const OPERATION='host_action.selfmaint_exec_route_refresh_v1';
const VERSION='1.0.0-selfmaint-exec-route-refresh-v1';
const POLICY_VERSION='2026-09-05.1-selfmaint-exec-route-refresh-v1';
const PATHS=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  executor:'/opt/prhm-agent-selfmaint-exec/server.js',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json'
});
const PREIMAGE=Object.freeze({
  base:'f948c66f71f0e25d08f9bc29ac829cba4351f2f7bfba0ae56d81aba607114602',
  executor:'45c4e8a96b8cc6d88939a4af582b7c1aefbbb2dc3217b67b5317d0950df94c36',
  mcp:'a2f8ff5110a071420f555102201e371fbf3cf2bded31353ddf51ee1848553e16',
  policy:'27be60fd0b43bf02578bc5afa680f22ce51954c3e63c9a8514eb5cca17aee35d'
});
const BACKUP_DIR='/var/backups/prhm-selfmaint-exec-route-refresh-registration-v1';
const RESULT='/var/lib/prhm-agent-selfmaint-exec/selfmaint-exec-route-refresh-registration-v1/latest.json';
function sha(b){return crypto.createHash('sha256').update(b).digest('hex')}
function fail(m){throw new Error(m)}
function count(s,x){return s.split(x).length-1}
function patchBase(source){
  if(source.includes(ACTION))fail('base_action_already_present');
  const a="  control_plane_typed_bootstrap_transport_v1: { operation: 'host_action.control_plane_typed_bootstrap_transport_v1', rollback: 'host-action-v2:control-plane-typed-bootstrap-transport-v1:journal-restore' },";
  if(count(source,a)!==1)fail('base_anchor_invalid');
  return source.replace(a,a+"\n  "+ACTION+": { operation: '"+OPERATION+"', rollback: 'host-action-v2:selfmaint-exec-route-refresh-v1:no-file-mutation' },");
}
function executorBlock(){return `
function applySelfmaintExecRouteRefreshV1(){
  const service='prhm-agent-selfmaint-exec.service';
  const beforeRaw=cp.execFileSync('/usr/bin/systemctl',['show',service,'-p','MainPID','--value'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000}).trim();
  const beforePid=/^\\d+$/.test(beforeRaw)?Number(beforeRaw):null;
  const unit='prhm-selfmaint-exec-route-refresh-'+Date.now();
  const args=['--unit='+unit,'--on-active=2s','--collect','--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectSystem=strict','--property=ProtectHome=true','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictAddressFamilies=AF_UNIX','--property=CapabilityBoundingSet=','--property=AmbientCapabilities=','--property=RestrictNamespaces=true','/usr/bin/systemctl','restart',service];
  cp.execFileSync('/usr/bin/systemd-run',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});
  return {ok:true,schema_version:'prhm.host-action-result.v1',action:'${ACTION}',service,scheduled:true,deferred_seconds:2,before_pid:beforePid,production_application_tree_mutation:false,database_mutation:false,dns_mutation:false,firewall_mutation:false,file_mutation:false,verification_required:['service_active','pid_changed','exec_socket_present','central_offsite_request_reachable'],rollback_performed:false};
}
`;}
function patchExecutor(source){
  if(source.includes("kind:'"+ACTION+"'"))fail('executor_action_already_present');
  const spec="  control_plane_typed_bootstrap_transport_v1:{operation:'host_action.control_plane_typed_bootstrap_transport_v1',kind:'control_plane_typed_bootstrap_transport_v1'},";
  if(count(source,spec)!==1)fail('executor_spec_anchor_invalid');
  let out=source.replace(spec,spec+"\n  "+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'},");
  const blockAnchor='const applyHostActionV2Original=applyHostActionV2;';
  if(count(out,blockAnchor)!==1)fail('executor_block_anchor_invalid');
  out=out.replace(blockAnchor,executorBlock()+"\n"+blockAnchor);
  const dispatch="return applyHostActionV2Original(action);};";
  if(count(out,dispatch)!==1)fail('executor_dispatch_anchor_invalid');
  out=out.replace(dispatch,"if(action==='"+ACTION+"')return applySelfmaintExecRouteRefreshV1();"+dispatch);
  return out;
}
function patchMcp(source){
  if(source.includes("'"+ACTION+"'"))fail('mcp_action_already_present');
  const a="'control_plane_typed_bootstrap_transport_v1'";
  if(count(source,a)!==1)fail('mcp_anchor_invalid');
  return source.replace(a,a+",'"+ACTION+"'");
}
function patchPolicy(text){
  const p=JSON.parse(text);
  if(p.operations?.[OPERATION]||p.typed_scopes?.some(x=>x&&x.action===ACTION))fail('policy_action_already_present');
  if(!p.operations?.['host_action.control_plane_typed_bootstrap_transport_v1'])fail('policy_anchor_missing');
  if(!Array.isArray(p.typed_scopes))fail('policy_typed_scopes_missing');
  p.operations[OPERATION]={level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:POLICY_VERSION,rollback_reference:'host-action-v2:selfmaint-exec-route-refresh-v1:no-file-mutation'};
  p.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:ACTION,risk:'critical',operation:OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  return JSON.stringify(p,null,2)+'\n';
}
function buildPatchedFrom(x){return{base:patchBase(x.base),executor:patchExecutor(x.executor),mcp:patchMcp(x.mcp),policy:patchPolicy(x.policy)}}
function atomic(abs,bytes,mode){fs.mkdirSync(path.dirname(abs),{recursive:true,mode:0o700});const tmp=abs+'.'+process.pid+'.'+Date.now()+'.tmp';fs.writeFileSync(tmp,bytes,{mode,flag:'wx'});fs.renameSync(tmp,abs);fs.chmodSync(abs,mode)}
function restart(s){cp.execFileSync('/usr/bin/systemctl',['restart',s],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000});const r=cp.execFileSync('/usr/bin/systemctl',['is-active',s],{encoding:'utf8',timeout:10000}).trim();if(r!=='active')fail('service_not_active:'+s)}
function readLive(){return Object.fromEntries(Object.entries(PATHS).map(([k,p])=>[k,fs.readFileSync(p,'utf8')]))}
function verifyPreimage(live){for(const [k,v] of Object.entries(live))if(sha(Buffer.from(v))!==PREIMAGE[k])fail('preimage_drift:'+k)}
function execute(){
  const live=readLive();verifyPreimage(live);const patched=buildPatchedFrom(live);
  fs.mkdirSync(BACKUP_DIR,{recursive:true,mode:0o700});const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);for(const [k,v] of Object.entries(live))fs.writeFileSync(path.join(BACKUP_DIR,stamp+'-'+k+'.bak'),v,{mode:0o600,flag:'wx'});
  let mutated=false;
  try{
    atomic(PATHS.base,Buffer.from(patched.base),0o644);atomic(PATHS.executor,Buffer.from(patched.executor),0o644);atomic(PATHS.mcp,Buffer.from(patched.mcp),0o644);atomic(PATHS.policy,Buffer.from(patched.policy),0o640);mutated=true;
    restart('prhm-company-approval.service');restart('prhm-agent-selfmaint.service');restart('prhm-agent-selfmaint-exec.service');restart('prhm-agent-mcp.service');
    const result={ok:true,schema_version:'prhm.host-action-registration-result.v1',action:ACTION,installed:true,control_plane_mutation:true,production_application_tree_mutation:false,database_mutation:false,dns_mutation:false,firewall_mutation:false,rollback_performed:false};atomic(RESULT,Buffer.from(JSON.stringify(result)+'\n'),0o600);return result;
  }catch(e){
    if(mutated){for(const [k,v] of Object.entries(live))atomic(PATHS[k],Buffer.from(v),k==='policy'?0o640:0o644);try{restart('prhm-company-approval.service');restart('prhm-agent-selfmaint.service');restart('prhm-agent-selfmaint-exec.service');restart('prhm-agent-mcp.service')}catch{}e.rollback_performed=true}
    throw e;
  }
}
if(require.main===module){try{if(process.argv.length!==2)fail('unexpected_arguments');process.stdout.write(JSON.stringify(execute())+'\n')}catch(e){process.stderr.write(String(e.stack||e)+'\n');process.exitCode=1}}
module.exports={ACTION,OPERATION,VERSION,POLICY_VERSION,PATHS,PREIMAGE,executorBlock,patchBase,patchExecutor,patchMcp,patchPolicy,buildPatchedFrom,verifyPreimage,execute};
