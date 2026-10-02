#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const PREFLIGHT_ACTION='moeinshow_wallet_cutover_preflight_v1';
const APPLY_ACTION='moeinshow_wallet_cutover_apply_v1';
const PREFLIGHT_OPERATION='host_action.moeinshow_wallet_cutover_preflight_v1';
const APPLY_OPERATION='host_action.moeinshow_wallet_cutover_apply_v1';
const POLICY_VERSION='2026-09-29.1-moeinshow-wallet-cutover-v1';
const PREFLIGHT_ROLLBACK='host-action-v2:moeinshow-wallet-cutover-preflight-v1:none';
const APPLY_ROLLBACK='host-action-v2:moeinshow-wallet-cutover-apply-v1:auto-rollback';
const MOEINSHOW_TARGET_SHA='b6e072a3c98e2228298c1e56f13dc303601cfa4c';

const BASE_SHA='ad2f0fc6924238e7bb7bff6d69a517c366ce82fbafb116bb0a2d31d78c5ed32f';
const EXEC_SHA='0de54e05cecc83fac0c327ce590001d24bab0759e45b231a185c3497a1e00a40';
const POLICY_SHA='aad8b3262a86c31f6d746f0bcfbd3eada6187c4e671b51ca79957b6ca6c3340c';
const MCP_SHA='9104941907ed6f1819e461276be6d26bb17514a9a9c045b8c11c046dd1c88f85';
const MCP_SAFE_SHA='103dfdf49f95794e84dfa40d97d1622aabb2efb7a373809010262def63fd00d8';
const MCP_INSTANT_SHA='b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0';
const MCP_SAFE_SOURCE_SHA=MCP_INSTANT_SHA;

const HELPER_SHA='e3b0740c6311736ecfbf62c39f6db585367bf96458dc6bb39aacf65eff633b0b';
const HELPER_SOURCE_PATH=path.join(__dirname,'moeinshow-wallet-cutover-v1.helper.js');

const PATHS=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  exec:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  mcpSafe:'/home/agent/candidates/agent3-safe-delivery-profile-expansion/mcp/src/plugins/hostActionsV2.js',
  mcpInstant:'/home/agent/candidates/agent3-instant-delivery-v1/mcp/src/plugins/hostActionsV2.js',
  mcpSafeSource:'/home/agent/candidates/agent3-safe-delivery-profile-expansion-source/mcp/src/plugins/hostActionsV2.js',
  mcpPointer:'/var/lib/prhm-agent-zdt/mcp-active',
  helper:'/opt/prhm-agent-selfmaint-exec/actions/moeinshow-wallet-cutover-v1.js'
});
const INSTALL_BACKUP_ROOT='/var/backups/prhm-moeinshow-wallet-cutover-v29-installer';
const INSTALL_RESULT='/var/lib/prhm-agent-selfmaint-exec/moeinshow-wallet-cutover-v29-installer/latest.json';

function fail(m){throw new Error(m)}
function sha(v){return crypto.createHash('sha256').update(v).digest('hex')}
function count(s,n){return s.split(n).length-1}
function once(s,a,r,label){const n=count(s,a);if(n!==1)fail('anchor_count:'+label+':'+n);return s.replace(a,r)}
function helperSource(){const h=fs.readFileSync(HELPER_SOURCE_PATH,'utf8');if(sha(h)!==HELPER_SHA)fail('helper_source_sha_mismatch');return h}

function buildPolicyCandidate(source){
  const p=JSON.parse(source);
  if(p.schema_version!=='prhm.approval-policy.v1')fail('policy_schema_mismatch');
  p.version=POLICY_VERSION;p.operations=p.operations||{};p.typed_scopes=Array.isArray(p.typed_scopes)?p.typed_scopes:[];
  for(const op of [PREFLIGHT_OPERATION,APPLY_OPERATION])if(p.operations[op])fail('policy_operation_already_present:'+op);
  for(const action of [PREFLIGHT_ACTION,APPLY_ACTION])if(p.typed_scopes.some(x=>x&&x.action===action))fail('policy_scope_already_present:'+action);
  p.operations[PREFLIGHT_OPERATION]={level:3,risk:'high',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:300,policy_version:POLICY_VERSION,rollback_reference:PREFLIGHT_ROLLBACK};
  p.operations[APPLY_OPERATION]={level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:300,policy_version:POLICY_VERSION,rollback_reference:APPLY_ROLLBACK};
  p.typed_scopes.push({tool:'host_action_v2_apply_level3',project:'control_plane',environment:'production',action:PREFLIGHT_ACTION,risk:'high',operation:PREFLIGHT_OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  p.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:APPLY_ACTION,risk:'critical',operation:APPLY_OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  return JSON.stringify(p,null,2)+'\n';
}

function buildBaseCandidate(source){
  for(const a of [PREFLIGHT_ACTION,APPLY_ACTION])if(source.includes(a))fail('base_action_already_present:'+a);
  const anchor="  mcp_candidate_schema_compare_v1: { operation: 'host_action.mcp_candidate_schema_compare_v1', rollback: 'host-action-v2:mcp-candidate-schema-compare-v1:auto-backup' },";
  const add=anchor+"\n  "+PREFLIGHT_ACTION+": { operation: '"+PREFLIGHT_OPERATION+"', rollback: '"+PREFLIGHT_ROLLBACK+"' },\n  "+APPLY_ACTION+": { operation: '"+APPLY_OPERATION+"', rollback: '"+APPLY_ROLLBACK+"' },";
  let out=once(source,anchor,add,'base_spec');
  const re=/const HOST_ACTION_V2_LEVEL3 = new Set\((\[[^;]+\])\);/;
  const m=out.match(re);if(!m)fail('base_level3_set_missing');
  let arr;try{arr=JSON.parse(m[1])}catch{fail('base_level3_set_parse_failed')}
  if(!arr.includes(PREFLIGHT_ACTION))arr.push(PREFLIGHT_ACTION);if(arr.includes(APPLY_ACTION))fail('apply_must_not_be_level3');
  out=out.replace(re,'const HOST_ACTION_V2_LEVEL3 = new Set('+JSON.stringify(arr)+');');return out;
}

function buildMcpCandidate(source){
  for(const a of [PREFLIGHT_ACTION,APPLY_ACTION])if(source.includes("'"+a+"'"))fail('mcp_action_already_present:'+a);
  const re=/const HostActionV2=z\.enum\(\[([\s\S]*?)\]\);/;const m=source.match(re);if(!m)fail('mcp_enum_anchor_missing');
  const body=m[1].trim();const addition=(body.endsWith(',')?'':',')+"'"+PREFLIGHT_ACTION+"','"+APPLY_ACTION+"'";
  return source.replace(re,'const HostActionV2=z.enum(['+body+addition+']);');
}

function buildExecCandidate(source){
  for(const a of [PREFLIGHT_ACTION,APPLY_ACTION])if(source.includes(a))fail('exec_action_already_present:'+a);
  const spec="  mcp_candidate_schema_compare_v1:{operation:'host_action.mcp_candidate_schema_compare_v1',kind:'mcp_candidate_schema_compare_v1'},";
  let out=once(source,spec,spec+"\n  "+PREFLIGHT_ACTION+":{operation:'"+PREFLIGHT_OPERATION+"',kind:'"+PREFLIGHT_ACTION+"'},\n  "+APPLY_ACTION+":{operation:'"+APPLY_OPERATION+"',kind:'"+APPLY_ACTION+"'},",'exec_spec');
  const fn=[
    "const MOEINSHOW_WALLET_HELPER='/opt/prhm-agent-selfmaint-exec/actions/moeinshow-wallet-cutover-v1.js';",
    "const MOEINSHOW_WALLET_RESULT_DIR='/var/lib/prhm-agent-selfmaint-exec/moeinshow-wallet-cutover-v1';",
    "const MOEINSHOW_WALLET_RESULT=MOEINSHOW_WALLET_RESULT_DIR+'/latest.json';",
    "function runMoeinshowWalletCutoverPhase(action,phase){",
    "  if(!fs.existsSync(MOEINSHOW_WALLET_HELPER))throw new Error('moeinshow_wallet_helper_missing');",
    "  ensureDir(MOEINSHOW_WALLET_RESULT_DIR,0o700);try{if(fs.existsSync(MOEINSHOW_WALLET_RESULT))fs.unlinkSync(MOEINSHOW_WALLET_RESULT)}catch{}",
    "  const unit='prhm-'+action+'-'+Date.now();",
    "  const rw=phase==='--apply'?'/home/moeinshow/domains/dashboard.moeinshow.com/public_html '+MOEINSHOW_WALLET_RESULT_DIR+' /var/backups/prhm-moeinshow-wallet-cutover-v1 /run':MOEINSHOW_WALLET_RESULT_DIR+' /run';",
    "  const args=['--wait','--collect','--quiet','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=AmbientCapabilities=','--property=ReadWritePaths='+rw,'--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',MOEINSHOW_WALLET_HELPER,phase];",
    "  cp.execFileSync('/usr/bin/systemd-run',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:600000,maxBuffer:1024*1024});",
    "  if(!fs.existsSync(MOEINSHOW_WALLET_RESULT))throw new Error('moeinshow_wallet_result_missing');const r=readJson(MOEINSHOW_WALLET_RESULT);",
    "  if(r.ok!==true||r.schema_version!=='prhm.host-action-result.v1'||r.action!==action||r.token_redacted!==true||r.saman_untouched!==true||r.mediana_untouched!==true)throw new Error('moeinshow_wallet_result_invalid');",
    "  if(action==='"+PREFLIGHT_ACTION+"'&&(r.preflight_only!==true||r.production_application_mutation!==false||r.database_mutation!==false))throw new Error('moeinshow_wallet_preflight_result_invalid');",
    "  if(action==='"+APPLY_ACTION+"'&&(r.wallet_enabled!==true||r.machine_credential_scopes?.length!==1||r.machine_credential_scopes[0]!=='config:read'||r.rollback_performed!==false))throw new Error('moeinshow_wallet_apply_result_invalid');",
    "  return r;",
    "}",
    "function applyMoeinshowWalletCutoverPreflightV1(){return runMoeinshowWalletCutoverPhase('"+PREFLIGHT_ACTION+"','--preflight')}",
    "function applyMoeinshowWalletCutoverV1(){return runMoeinshowWalletCutoverPhase('"+APPLY_ACTION+"','--apply')}",
    ""
  ].join('\n');
  const anchor='async function applyHostActionV2(action){';
  out=once(out,anchor,fn+anchor+"if(action==='"+PREFLIGHT_ACTION+"')return applyMoeinshowWalletCutoverPreflightV1();if(action==='"+APPLY_ACTION+"')return applyMoeinshowWalletCutoverV1();",'exec_apply');
  return out;
}

function buildInstallPlan(current){
  const expected={base:BASE_SHA,exec:EXEC_SHA,policy:POLICY_SHA,mcp:MCP_SHA,mcpSafe:MCP_SAFE_SHA,mcpInstant:MCP_INSTANT_SHA,mcpSafeSource:MCP_SAFE_SOURCE_SHA};for(const k of Object.keys(expected)){if(typeof current[k]!=='string')fail('install_source_missing:'+k);const actual=sha(current[k]);if(actual!==expected[k])fail('install_preimage_sha_mismatch:'+k+':'+actual)}
  const next={base:buildBaseCandidate(current.base),exec:buildExecCandidate(current.exec),policy:buildPolicyCandidate(current.policy),mcp:buildMcpCandidate(current.mcp),mcpSafe:buildMcpCandidate(current.mcpSafe),mcpInstant:buildMcpCandidate(current.mcpInstant),mcpSafeSource:buildMcpCandidate(current.mcpSafeSource),helper:helperSource()};
  return{ok:true,next,post_sha256:Object.fromEntries(Object.entries(next).map(([k,v])=>[k,sha(v)])),helper_sha256:HELPER_SHA};
}
function regularOrMissing(file){if(!fs.existsSync(file))return null;const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(file)!==file)fail('target_not_regular:'+file);return st}
function nodeCheck(text,label){const f='/tmp/prhm-v29-'+process.pid+'-'+label+'.js';try{fs.writeFileSync(f,text,{mode:0o600,flag:'wx'});const r=cp.spawnSync(process.execPath,['--check',f],{encoding:'utf8',timeout:10000});if(r.error||r.status!==0)fail('node_syntax_invalid:'+label+':'+String(r.stderr||''))}finally{try{fs.unlinkSync(f)}catch{}}}
function preflight(){
  const current={base:fs.readFileSync(PATHS.base,'utf8'),exec:fs.readFileSync(PATHS.exec,'utf8'),policy:fs.readFileSync(PATHS.policy,'utf8'),mcp:fs.readFileSync(PATHS.mcp,'utf8'),mcpSafe:fs.readFileSync(PATHS.mcpSafe,'utf8'),mcpInstant:fs.readFileSync(PATHS.mcpInstant,'utf8'),mcpSafeSource:fs.readFileSync(PATHS.mcpSafeSource,'utf8')};const plan=buildInstallPlan(current);
  const pointer=String(fs.readFileSync(PATHS.mcpPointer,'utf8')).trim();if(pointer!=='8132')fail('unexpected_active_mcp_pointer:'+pointer);
  nodeCheck(plan.next.base,'base');nodeCheck(plan.next.exec,'exec');nodeCheck(plan.next.mcp,'mcp');nodeCheck(plan.next.mcpSafe,'mcp-safe');nodeCheck(plan.next.mcpInstant,'mcp-instant');nodeCheck(plan.next.mcpSafeSource,'mcp-safe-source');nodeCheck(plan.next.helper,'helper');JSON.parse(plan.next.policy);
  for(const port of [8123,8132,8134]){if(!endpointOk(port,'/health','ok')||!endpointOk(port,'/ready','ready'))fail('mcp_endpoint_unhealthy:'+port)}
  return{ok:true,schema_version:'prhm.moeinshow-wallet-cutover-installer-preflight.v1',preflight_only:true,helper_sha256:HELPER_SHA,post_sha256:plan.post_sha256,mcp_topology:{public:8123,active:8132,standby:8134},production_application_mutation:false,database_mutation:false,control_plane_mutation:false};
}
function atomicWrite(file,text,mode,uid,gid){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o755});const tmp=file+'.v29-'+process.pid+'-'+Date.now()+'.tmp';let fd;try{fd=fs.openSync(tmp,'wx',mode);fs.writeFileSync(fd,text);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.chmodSync(tmp,mode);if(Number.isInteger(uid)&&Number.isInteger(gid))fs.chownSync(tmp,uid,gid);fs.renameSync(tmp,file)}catch(e){try{if(fd!==undefined)fs.closeSync(fd)}catch{}try{fs.unlinkSync(tmp)}catch{}throw e}}
function active(service){return String(cp.spawnSync('/usr/bin/systemctl',['is-active',service],{encoding:'utf8',timeout:10000}).stdout||'').trim()==='active'}
function restart(service){const r=cp.spawnSync('/usr/bin/systemctl',['restart',service],{encoding:'utf8',timeout:60000});if(r.error||r.status!==0)fail('service_restart_failed:'+service)}
function endpointOk(port,route,key){const r=cp.spawnSync('/usr/bin/curl',['-fsS','--max-time','3','http://127.0.0.1:'+port+route],{encoding:'utf8',timeout:5000,maxBuffer:200000});if(r.error||r.status!==0)return false;try{return JSON.parse(String(r.stdout||'{}'))[key]===true}catch{return false}}
function install(){
  if(process.getuid&&process.getuid()!==0)fail('root_required');const pf=preflight();
  const current={base:fs.readFileSync(PATHS.base,'utf8'),exec:fs.readFileSync(PATHS.exec,'utf8'),policy:fs.readFileSync(PATHS.policy,'utf8'),mcp:fs.readFileSync(PATHS.mcp,'utf8'),mcpSafe:fs.readFileSync(PATHS.mcpSafe,'utf8'),mcpInstant:fs.readFileSync(PATHS.mcpInstant,'utf8'),mcpSafeSource:fs.readFileSync(PATHS.mcpSafeSource,'utf8')};const plan=buildInstallPlan(current);
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+process.pid;const backup=path.join(INSTALL_BACKUP_ROOT,stamp);fs.mkdirSync(backup,{recursive:true,mode:0o700});
  const targets=['base','exec','policy','mcp','mcpSafe','mcpInstant','mcpSafeSource'];const meta={};for(const k of targets){const st=regularOrMissing(PATHS[k]);meta[k]={mode:st.mode&0o777,uid:st.uid,gid:st.gid};fs.writeFileSync(path.join(backup,k+'.bak'),current[k],{mode:0o600,flag:'wx'})}
  const helperSt=regularOrMissing(PATHS.helper);const helperOld=helperSt?fs.readFileSync(PATHS.helper):null;if(helperOld)fs.writeFileSync(path.join(backup,'helper.bak'),helperOld,{mode:0o600,flag:'wx'});
  let mutated=false;const services=['prhm-company-approval.service','prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service','prhm-agent-mcp-safe-delivery-candidate.service','prhm-agent-mcp-instant-delivery-candidate.service'];
  try{
    atomicWrite(PATHS.helper,plan.next.helper,0o700,helperSt?.uid??0,helperSt?.gid??0);for(const k of targets)atomicWrite(PATHS[k],plan.next[k],meta[k].mode,meta[k].uid,meta[k].gid);mutated=true;
    for(const s of services)restart(s);for(const s of services)if(!active(s))fail('service_not_active:'+s);
    for(const port of [8123,8132,8134]){if(!endpointOk(port,'/health','ok')||!endpointOk(port,'/ready','ready'))fail('post_install_mcp_unhealthy:'+port)}
    if(String(fs.readFileSync(PATHS.mcpPointer,'utf8')).trim()!=='8132')fail('post_install_active_pointer_changed');
    for(const k of targets)if(sha(fs.readFileSync(PATHS[k]))!==plan.post_sha256[k])fail('post_sha_mismatch:'+k);if(sha(fs.readFileSync(PATHS.helper))!==HELPER_SHA)fail('post_sha_mismatch:helper');
    return{ok:true,schema_version:'prhm.host-action-installer-result.v1',installed:true,target_actions:[PREFLIGHT_ACTION,APPLY_ACTION],backup_dir:backup,helper_sha256:HELPER_SHA,post_sha256:plan.post_sha256,production_application_mutation:false,database_mutation:false,rollback_performed:false,preflight:pf};
  }catch(error){
    const rb=[];if(mutated){for(const k of targets)try{atomicWrite(PATHS[k],current[k],meta[k].mode,meta[k].uid,meta[k].gid)}catch(e){rb.push(k+':'+e.message)}try{if(helperOld)atomicWrite(PATHS.helper,helperOld,helperSt.mode&0o777,helperSt.uid,helperSt.gid);else fs.unlinkSync(PATHS.helper)}catch(e){if(e.code!=='ENOENT')rb.push('helper:'+e.message)}for(const s of services)try{restart(s)}catch(e){rb.push('restart:'+s+':'+e.message)}}
    if(rb.length)fail('install_failed_rollback_failed:'+String(error&&error.message||error)+':'+rb.join('|'));fail('install_failed_rolled_back:'+String(error&&error.message||error));
  }
}
function selftest(){
  const p=JSON.stringify({schema_version:'prhm.approval-policy.v1',version:'x',operations:{},typed_scopes:[]});
  const b="const HOST_ACTION_V2_SPECS = Object.freeze({\n  mcp_candidate_schema_compare_v1: { operation: 'host_action.mcp_candidate_schema_compare_v1', rollback: 'host-action-v2:mcp-candidate-schema-compare-v1:auto-backup' },\n});\nconst HOST_ACTION_V2_LEVEL3 = new Set([\"mcp_candidate_schema_compare_v1\"]);";
  const e="const HOST_ACTION_V2_SPECS = Object.freeze({\n  mcp_candidate_schema_compare_v1:{operation:'host_action.mcp_candidate_schema_compare_v1',kind:'mcp_candidate_schema_compare_v1'},\n});\nasync function applyHostActionV2(action){if(action==='mcp_candidate_schema_compare_v1')return applyMcpCandidateSchemaCompareV1();return applyHostActionV2Original(action);}";
  const m="const HostActionV2=z.enum(['mcp_candidate_schema_compare_v1']);";
  buildPolicyCandidate(p);buildBaseCandidate(b);buildExecCandidate(e);buildMcpCandidate(m);nodeCheck(helperSource(),'helper-selftest');
  return{ok:true,target_sha:MOEINSHOW_TARGET_SHA,helper_sha256:HELPER_SHA};
}
function main(){const a=process.argv.slice(2);if(a.length>1)fail('unexpected_arguments');let r;if(a[0]==='--selftest-only')r=selftest();else if(a[0]==='--preflight-only')r=preflight();else if(a.length===0)r=install();else fail('unexpected_argument:'+a[0]);if(a.length===0){fs.mkdirSync(path.dirname(INSTALL_RESULT),{recursive:true,mode:0o700});const tmp=INSTALL_RESULT+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(r,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,INSTALL_RESULT)}process.stdout.write(JSON.stringify(r)+'\n')}

module.exports={PREFLIGHT_ACTION,APPLY_ACTION,PREFLIGHT_OPERATION,APPLY_OPERATION,MOEINSHOW_TARGET_SHA,BASE_SHA,EXEC_SHA,POLICY_SHA,MCP_SHA,MCP_SAFE_SHA,MCP_INSTANT_SHA,MCP_SAFE_SOURCE_SHA,HELPER_SHA,PATHS,helperSource,buildPolicyCandidate,buildBaseCandidate,buildMcpCandidate,buildExecCandidate,buildInstallPlan,preflight,install,selftest,sha};
if(require.main===module){try{main()}catch(error){console.error(String(error&&error.stack||error));process.exit(1)}}
