#!/usr/local/bin/prhm-node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const ACTION='readonly_bridge_repair_registration_v1';
const TARGET_ACTION='readonly_bridge_repair_v1';
const OPERATION='host_action.readonly_bridge_repair_v1';
const HELPER_SHA256='068b519c3d0f23bd56eed84750e0cb74e44001250b81a08830e1baf61c928622';
const HELPER_TARGET='/opt/prhm-agent-selfmaint-exec/actions/readonly-bridge-repair-v1.js';
const STAGED_HELPER=path.join(__dirname,'readonly-bridge-repair-v1.js');
const BACKUP_ROOT='/var/backups/prhm-readonly-bridge-registration-v1';

const LIVE=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  exec:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js'
});
const KNOWN_BASELINE=Object.freeze({
  base:null,
  exec:'451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48',
  policy:'494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70',
  mcp:null
});
const CORE_SERVICES=Object.freeze([
  'prhm-company-approval.service',
  'prhm-agent-selfmaint.service',
  'prhm-agent-selfmaint-exec.service'
]);
const MCP_LANES=Object.freeze([
  'prhm-agent-mcp-blue.service',
  'prhm-agent-mcp-green.service'
]);
const MCP_ROUTER='prhm-agent-mcp-router.service';
const LEGACY_MCP='prhm-agent-mcp.service';
const SHA_RE=/^[0-9a-f]{64}$/;

function fail(message){throw new Error(message);}
function sha(bytes){return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');}
function count(text,needle){return String(text).split(needle).length-1;}
function assertSha(value,label){if(!SHA_RE.test(String(value||'')))fail(label+'_sha_invalid');return value;}
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}

function insertSpec(source,marker,entry,label){
  if(count(source,marker)!==1)fail(label+'_spec_anchor_count');
  const start=source.indexOf(marker)+marker.length;
  const end=source.indexOf('\n});',start);
  if(end<0)fail(label+'_spec_close_anchor_missing');
  const before=source.slice(0,end);
  const comma=before.trimEnd().endsWith(',')?'':',';
  return before+comma+'\n  '+entry+source.slice(end);
}

function patchBase(source){
  if(source.includes(TARGET_ACTION)||source.includes(OPERATION))fail('base_already_registered');
  const entry=`${TARGET_ACTION}: { operation: '${OPERATION}', rollback: 'host-action-v2:${TARGET_ACTION}:registration-backup-restore' }`;
  return insertSpec(source,'const HOST_ACTION_V2_SPECS = Object.freeze({',entry,'base');
}

function patchExec(source){
  if(source.includes(TARGET_ACTION)||source.includes(OPERATION))fail('exec_already_registered');
  let out=insertSpec(
    source,
    'const HOST_ACTION_V2_SPECS = Object.freeze({',
    `${TARGET_ACTION}:{operation:'${OPERATION}',kind:'${TARGET_ACTION}'}`,
    'exec'
  );
  const insertionMarker='const applyHostActionV2Original=applyHostActionV2;';
  if(count(out,insertionMarker)!==1)fail('exec_apply_original_anchor_count');
  const runner=`const READONLY_BRIDGE_REPAIR_HELPER='${HELPER_TARGET}';\n`+
    `const READONLY_BRIDGE_REPAIR_HELPER_SHA='${HELPER_SHA256}';\n`+
    `function applyReadonlyBridgeRepairV1(){const c=require('node:crypto'),b=fs.readFileSync(READONLY_BRIDGE_REPAIR_HELPER),s=c.createHash('sha256').update(b).digest('hex');if(s!==READONLY_BRIDGE_REPAIR_HELPER_SHA)throw new Error('readonly_bridge_helper_sha_mismatch');const a=['--wait','--collect','--pipe','--quiet','--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=ProtectSystem=strict','--property=ProtectHome=true','--property=ProtectKernelTunables=true','--property=ProtectKernelModules=true','--property=ProtectControlGroups=true','--property=RestrictNamespaces=true','--property=RestrictSUIDSGID=true','--property=CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER','--property=AmbientCapabilities=','--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=ReadWritePaths=/etc/prhm-readonly-http.env /var/backups/prhm-readonly-bridge-repair-v1','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',READONLY_BRIDGE_REPAIR_HELPER,'--apply'];const r=cp.spawnSync('/usr/bin/systemd-run',a,{encoding:'utf8',timeout:180000,maxBuffer:1048576});if(r.error||r.status!==0)throw new Error('readonly_bridge_repair_helper_failed:'+String(r.stderr||r.stdout||r.error||'').slice(-1000));const lines=String(r.stdout||'').trim().split(/\\r?\\n/).filter(Boolean);let x=null;for(let i=lines.length-1;i>=0;i--){try{x=JSON.parse(lines[i]);break}catch{}}if(!x||x.ok!==true||x.action!=='${TARGET_ACTION}'||x.schema_version!=='prhm.host-action-result.v1'||x.installed!==true||x.current_port!==8141||x.recovery_port!==8140||x.rollback_performed!==false||x.database_mutation!==false||x.recovery_mutation!==false||x.agent_api_mutation!==false||x.mcp_mutation!==false||x.dns_mutation!==false||x.firewall_mutation!==false)throw new Error('readonly_bridge_repair_result_invalid');return x}\n`;
  out=out.replace(insertionMarker,runner+insertionMarker);
  const dispatcher="applyHostActionV2=async function(action){";
  if(count(out,dispatcher)!==1)fail('exec_dispatcher_anchor_count');
  out=out.replace(dispatcher,dispatcher+`if(action==='${TARGET_ACTION}')return applyReadonlyBridgeRepairV1();`);
  return out;
}

function patchPolicy(source){
  let policy;try{policy=JSON.parse(source);}catch{fail('policy_json_invalid');}
  if(!policy||typeof policy!=='object'||Array.isArray(policy))fail('policy_object_invalid');
  if(policy.default_deny!==true||policy.one_time_use!==true)fail('policy_fail_closed_contract_missing');
  if(!policy.levels||Number(policy.levels?.['4']?.max_ttl_seconds)!==180)fail('policy_level4_contract_mismatch');
  if(!policy.operations||typeof policy.operations!=='object'||Array.isArray(policy.operations))fail('policy_operations_invalid');
  if(!Array.isArray(policy.typed_scopes))fail('policy_typed_scopes_invalid');
  if(Object.prototype.hasOwnProperty.call(policy.operations,OPERATION))fail('policy_already_registered');
  if(policy.typed_scopes.some(x=>x&&(x.action===TARGET_ACTION||x.operation===OPERATION)))fail('policy_scope_already_registered');
  policy.operations[OPERATION]={level:4,risk:'critical'};
  policy.typed_scopes.push({
    action:TARGET_ACTION,
    environment:'production',
    operation:OPERATION,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}],
    project:'control_plane',
    risk:'critical',
    tool:'host_action_v2_apply'
  });
  return JSON.stringify(policy,null,2)+'\n';
}

function patchMcp(source){
  if(source.includes(TARGET_ACTION))fail('mcp_already_registered');
  const marker='const HostActionV2=z.enum([';
  if(count(source,marker)!==1)fail('mcp_enum_anchor_count');
  const start=source.indexOf(marker)+marker.length;
  const end=source.indexOf(']);',start);
  if(end<0)fail('mcp_enum_close_anchor_missing');
  const before=source.slice(0,end);
  const comma=before.trimEnd().endsWith('[')||before.trimEnd().endsWith(',')?'':',';
  return before+comma+`'${TARGET_ACTION}'`+source.slice(end);
}

function buildCandidates(owners){
  for(const key of ['base','exec','policy','mcp'])if(typeof owners?.[key]!=='string')fail('owner_source_missing:'+key);
  return {base:patchBase(owners.base),exec:patchExec(owners.exec),policy:patchPolicy(owners.policy),mcp:patchMcp(owners.mcp)};
}

function validateMap(map,keys,label){
  if(!map||typeof map!=='object'||Array.isArray(map))fail(label+'_map_invalid');
  const actual=Object.keys(map).sort(),expected=[...keys].sort();
  if(actual.join(',')!==expected.join(','))fail(label+'_keyset_invalid');
  for(const key of keys)assertSha(map[key],label+'_'+key);
  return map;
}

function buildRegistrationPlan(current,candidate){
  validateMap(current,['base','exec','policy','mcp'],'current');
  validateMap(candidate,['base','exec','policy','mcp','helper'],'candidate');
  if(candidate.helper!==HELPER_SHA256)fail('candidate_helper_sha_mismatch');
  const core={
    schema_version:'prhm.readonly-bridge-registration-plan.v1',
    action:ACTION,
    target_action:TARGET_ACTION,
    operation:OPERATION,
    helper_sha256:HELPER_SHA256,
    current_sha256:{...current},
    candidate_sha256:{...candidate}
  };
  return {...core,plan_sha256:sha(Buffer.from(canonical(core),'utf8'))};
}

function assertPlanStillValid(plan,current,candidate){
  const fresh=buildRegistrationPlan(current,candidate);
  if(!plan||plan.plan_sha256!==fresh.plan_sha256||canonical(plan)!==canonical(fresh))fail('registration_plan_drift');
  return true;
}

function assertRoot(){if(process.getuid&&process.getuid()!==0)fail('root_required');}
function readRegular(file,label){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink())fail(label+'_not_regular');
  if(fs.realpathSync(file)!==file)fail(label+'_realpath_mismatch');
  const bytes=fs.readFileSync(file),text=bytes.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(bytes))fail(label+'_not_utf8');
  return {st,bytes,text,sha256:sha(bytes)};
}
function readOwners(){return Object.fromEntries(Object.entries(LIVE).map(([k,file])=>[k,readRegular(file,k)]));}
function assertKnownBaseline(current){
  for(const key of ['exec','policy'])if(current[key]!==KNOWN_BASELINE[key])fail('known_baseline_drift:'+key+':'+current[key]);
  return true;
}
function nodeSyntax(source,label){
  const r=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:Buffer.from(source,'utf8'),encoding:'utf8',timeout:30000,maxBuffer:512*1024});
  if(r.error||r.status!==0)fail(label+'_syntax_invalid:'+String(r.stderr||r.stdout||r.error||'').slice(-500));
}
function verifyHelper(){
  const h=readRegular(STAGED_HELPER,'staged_helper');
  if(h.sha256!==HELPER_SHA256)fail('staged_helper_sha_mismatch:'+h.sha256);
  nodeSyntax(h.text,'staged_helper');
  return h;
}
function serviceState(service){
  const r=cp.spawnSync('/usr/bin/systemctl',['is-active',service],{encoding:'utf8',timeout:10000,maxBuffer:65536});
  return String(r.stdout||'').trim();
}
function assertServiceTopology(){
  for(const service of [...CORE_SERVICES,...MCP_LANES,MCP_ROUTER])if(serviceState(service)!=='active')fail('required_service_not_active:'+service);
  if(serviceState(LEGACY_MCP)==='active')fail('legacy_mcp_unexpectedly_active');
}
function health(url){
  const r=cp.spawnSync('/usr/bin/curl',['-fsS','--max-time','8',url],{encoding:'utf8',timeout:12000,maxBuffer:131072});
  if(r.error||r.status!==0)fail('health_failed:'+url);
  let body;try{body=JSON.parse(r.stdout);}catch{fail('health_json_invalid:'+url);}
  if(body?.ok!==true)fail('health_not_ok:'+url);
  return body;
}
function assertMcpHealth(){for(const port of [8123,8124,8125])health('http://127.0.0.1:'+port+'/health');}

function prepare(){
  assertRoot();
  assertServiceTopology();
  assertMcpHealth();
  const owners=readOwners();
  const current=Object.fromEntries(Object.entries(owners).map(([k,v])=>[k,v.sha256]));
  assertKnownBaseline(current);
  const helper=verifyHelper();
  const sources=Object.fromEntries(Object.entries(owners).map(([k,v])=>[k,v.text]));
  const candidates=buildCandidates(sources);
  nodeSyntax(candidates.base,'base_candidate');
  nodeSyntax(candidates.exec,'exec_candidate');
  nodeSyntax(candidates.mcp,'mcp_candidate');
  try{JSON.parse(candidates.policy);}catch{fail('policy_candidate_json_invalid');}
  const candidate=Object.fromEntries(Object.entries(candidates).map(([k,v])=>[k,sha(Buffer.from(v,'utf8'))]));
  candidate.helper=helper.sha256;
  const plan=buildRegistrationPlan(current,candidate);
  return {owners,candidates,helper,plan};
}

function preflight(){
  const p=prepare();
  return {
    ok:true,
    schema_version:'prhm.readonly-bridge-registration-preflight.v1',
    action:ACTION,
    target_action:TARGET_ACTION,
    preflight_only:true,
    production_mutation:false,
    database_mutation:false,
    application_mutation:false,
    legacy_mcp_mutation:false,
    router_mutation:false,
    ...p.plan
  };
}

function ensureDir(dir,mode){fs.mkdirSync(dir,{recursive:true,mode});fs.chmodSync(dir,mode);}
function backupAll(prep){
  const dir=path.join(BACKUP_ROOT,new Date().toISOString().replace(/[:.]/g,'-')+'-'+prep.plan.plan_sha256.slice(0,12));
  ensureDir(dir,0o700);
  const files={};
  for(const [key,file] of Object.entries(LIVE)){
    const dst=path.join(dir,key+'.bak');
    fs.writeFileSync(dst,prep.owners[key].bytes,{mode:0o600,flag:'wx'});fs.chownSync(dst,0,0);fs.chmodSync(dst,0o600);files[key]=dst;
  }
  const helperExisted=fs.existsSync(HELPER_TARGET);
  let helperBackup=null;
  if(helperExisted){helperBackup=path.join(dir,'helper.bak');const b=fs.readFileSync(HELPER_TARGET);fs.writeFileSync(helperBackup,b,{mode:0o600,flag:'wx'});fs.chownSync(helperBackup,0,0);fs.chmodSync(helperBackup,0o600);}
  return {dir,files,helperExisted,helperBackup};
}
function atomicReplace(file,bytes,stat,modeOverride=null){
  const dir=path.dirname(file),tmp=path.join(dir,'.'+path.basename(file)+'.readonly-registration-'+process.pid+'-'+Date.now()+'.tmp');
  let fd;
  try{
    fd=fs.openSync(tmp,'wx',modeOverride??(stat.mode&0o777));fs.writeFileSync(fd,Buffer.from(bytes));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.chownSync(tmp,stat.uid,stat.gid);fs.chmodSync(tmp,modeOverride??(stat.mode&0o777));fs.renameSync(tmp,file);
  }finally{if(fd!==undefined){try{fs.closeSync(fd)}catch{}}try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{}}
}
function installHelper(bytes){
  ensureDir(path.dirname(HELPER_TARGET),0o700);
  const fake={uid:0,gid:0,mode:0o700};atomicReplace(HELPER_TARGET,bytes,fake,0o700);
  if(sha(fs.readFileSync(HELPER_TARGET))!==HELPER_SHA256)fail('helper_postwrite_sha_mismatch');
}
function restart(service){
  const r=cp.spawnSync('/usr/bin/systemctl',['restart',service],{encoding:'utf8',timeout:90000,maxBuffer:131072});
  if(r.error||r.status!==0)fail('service_restart_failed:'+service+':'+String(r.stderr||r.stdout||r.error||'').slice(-400));
  if(serviceState(service)!=='active')fail('service_not_active_after_restart:'+service);
}
function restartControlPlane(){
  for(const service of CORE_SERVICES)restart(service);
  restart(MCP_LANES[0]);health('http://127.0.0.1:8124/health');health('http://127.0.0.1:8123/health');
  restart(MCP_LANES[1]);health('http://127.0.0.1:8125/health');health('http://127.0.0.1:8123/health');
  if(serviceState(LEGACY_MCP)==='active')fail('legacy_mcp_became_active');
}
function verifyInstalled(prep){
  for(const [key,file] of Object.entries(LIVE))if(sha(fs.readFileSync(file))!==prep.plan.candidate_sha256[key])fail('postwrite_sha_mismatch:'+key);
  if(sha(fs.readFileSync(HELPER_TARGET))!==HELPER_SHA256)fail('postwrite_sha_mismatch:helper');
  assertServiceTopology();assertMcpHealth();
  return true;
}
function rollback(prep,backup){
  for(const [key,file] of Object.entries(LIVE))atomicReplace(file,fs.readFileSync(backup.files[key]),prep.owners[key].st);
  if(backup.helperExisted)atomicReplace(HELPER_TARGET,fs.readFileSync(backup.helperBackup),{uid:0,gid:0,mode:0o700},0o700);else try{fs.unlinkSync(HELPER_TARGET)}catch(e){if(e.code!=='ENOENT')throw e;}
  restartControlPlane();
  for(const [key,file] of Object.entries(LIVE))if(sha(fs.readFileSync(file))!==prep.plan.current_sha256[key])fail('rollback_sha_mismatch:'+key);
  return true;
}

function apply(planSha){
  assertSha(planSha,'requested_plan');
  const prep=prepare();
  if(prep.plan.plan_sha256!==planSha)fail('registration_plan_sha_mismatch');
  assertPlanStillValid(prep.plan,prep.plan.current_sha256,prep.plan.candidate_sha256);
  const backup=backupAll(prep);
  let mutated=false;
  try{
    installHelper(prep.helper.bytes);mutated=true;
    for(const key of ['base','exec','policy','mcp'])atomicReplace(LIVE[key],Buffer.from(prep.candidates[key],'utf8'),prep.owners[key].st);
    restartControlPlane();verifyInstalled(prep);
    return {
      ok:true,schema_version:'prhm.host-action-result.v1',action:ACTION,target_action:TARGET_ACTION,installed:true,
      plan_sha256:prep.plan.plan_sha256,backup_path:backup.dir,current_sha256:prep.plan.current_sha256,
      candidate_sha256:prep.plan.candidate_sha256,rollback_performed:false,production_mutation:true,
      database_mutation:false,application_mutation:false,recovery_mutation:false,dns_mutation:false,firewall_mutation:false,
      router_mutation:false,legacy_mcp_mutation:false,mcp_lanes_restarted:[...MCP_LANES]
    };
  }catch(error){
    if(!mutated)throw error;
    try{rollback(prep,backup);}catch(rb){fail('registration_failed_and_rollback_failed:'+String(error?.message||error)+':'+String(rb?.message||rb));}
    fail('registration_failed_rolled_back:'+String(error?.message||error));
  }
}

function run(argv=process.argv.slice(2)){
  if(argv.length===1&&argv[0]==='--preflight-only')return preflight();
  if(argv.length===2&&argv[0]==='--apply')return apply(argv[1]);
  fail('unexpected_arguments');
}

if(require.main===module){
  try{process.stdout.write(JSON.stringify(run())+'\n');}
  catch(error){process.stderr.write(JSON.stringify({ok:false,action:ACTION,error:String(error?.message||error).slice(0,1200)})+'\n');process.exitCode=1;}
}

module.exports={ACTION,TARGET_ACTION,OPERATION,HELPER_SHA256,HELPER_TARGET,STAGED_HELPER,BACKUP_ROOT,LIVE,KNOWN_BASELINE,CORE_SERVICES,MCP_LANES,MCP_ROUTER,LEGACY_MCP,sha,canonical,patchBase,patchExec,patchPolicy,patchMcp,buildCandidates,buildRegistrationPlan,assertPlanStillValid,preflight,apply,run};
