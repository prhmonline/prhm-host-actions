'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const core = require('./safe-delivery-profile-enable-next-v1.js');

const ACTION = core.ACTION;
const OPERATION = core.OPERATION;
const POLICY_VERSION = '2026-10-05.1-safe-delivery-profile-enable-next-v1';
const CURRENT_POLICY_VERSION = '2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';
const POLICY_SHA = 'aad8b3262a86c31f6d746f0bcfbd3eada6187c4e671b51ca79957b6ca6c3340c';
const BASE_SHA = 'ad2f0fc6924238e7bb7bff6d69a517c366ce82fbafb116bb0a2d31d78c5ed32f';
const EXEC_SHA = 'a988dfcd706d3a032bd4d0d60a85c78b7fd6cdbea4e81b5e6c21212a6cd754a4';
const MCP_SHA = '8f24b6ed70644c1eda7b255a47ccf0d4fabfe03ac7c73dd8799ff9aeb5294075';
const CANDIDATE_MCP_SHA = '103dfdf49f95794e84dfa40d97d1622aabb2efb7a373809010262def63fd00d8';
const PATHS = Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  exec:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  canonicalMcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  candidateMcp:'/home/agent/candidates/agent3-safe-delivery-profile-expansion/mcp/src/plugins/hostActionsV2.js',
  helper:'/opt/prhm-agent-selfmaint-exec/actions/safe-delivery-profile-enable-next-v1.js'
});
const SERVICES = Object.freeze(['prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service','prhm-agent-mcp-safe-delivery-candidate.service']);
const INSTALL_BACKUP_ROOT = '/var/backups/prhm-safe-delivery-profile-enable-next-v30-installer';
const HELPER_REPO_SHA = '2336fb61076c43409951f7240ad6d9b3613db41ccb83bce3a2cacfc531de8979';
const HELPER_SOURCE_PATH = path.join(__dirname, 'safe-delivery-profile-enable-next-helper-v1.js');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code){ throw new Error(code); }
function once(source, anchor, replacement, label){ const count=source.split(anchor).length-1; if(count!==1) fail(label+'_anchor_count_'+count); return source.replace(anchor,replacement); }

function buildPolicyCandidate(source){
  const policy = JSON.parse(source);
  if (policy.schema_version !== 'prhm.approval-policy.v1' || policy.version !== CURRENT_POLICY_VERSION) fail('policy_baseline_mismatch');
  if (policy.operations?.[OPERATION] || policy.typed_scopes?.some(scope => scope?.action === ACTION)) fail('already_present');
  if (!Array.isArray(policy.typed_scopes)) fail('policy_typed_scopes_invalid');
  policy.version = POLICY_VERSION;
  policy.operations[OPERATION] = { level:4, risk:'critical', requires_second_confirmation:true, one_time_use:true,
    requested_approver:'mohammad', expires_seconds:180, policy_version:POLICY_VERSION,
    rollback_reference:'host-action-v2:safe-delivery-profile-enable-next-v1:profile-state-preimage-restore' };
  policy.typed_scopes.push({ tool:'host_action_v2_apply', project:'control_plane', environment:'production', action:ACTION,
    risk:'critical', operation:OPERATION, principals:[{ principal_id:'mohammad', roles:['mcp-operator'] }] });
  return JSON.stringify(policy,null,2)+'\n';
}
function buildMcpCandidate(source){
  if (source.includes("'safe_delivery_profile_enable_next_v1'")) fail('already_present');
  const anchor = "'control_plane_root_scripts_stage_transport_v1']);";
  return once(source, anchor, "'control_plane_root_scripts_stage_transport_v1','safe_delivery_profile_enable_next_v1']);", 'mcp_enum');
}
function buildBaseCandidate(source){
  if (source.includes('safe_delivery_profile_enable_next_v1')) fail('already_present');
  const anchor = "  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' }\n});";
  const replacement = "  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' },\n  safe_delivery_profile_enable_next_v1: { operation: 'host_action.safe_delivery_profile_enable_next_v1', rollback: 'host-action-v2:safe-delivery-profile-enable-next-v1:profile-state-preimage-restore' }\n});";
  return once(source, anchor, replacement, 'base_spec');
}
function buildExecCandidate(source, helperSha){
  if (!/^[a-f0-9]{64}$/.test(String(helperSha))) fail('helper_sha_invalid');
  if (source.includes('safe_delivery_profile_enable_next_v1')) fail('already_present');
  const specAnchor = "  agent_zdt_source_sha_refresh_publisher_v1:{operation:'host_action.agent_zdt_source_sha_refresh_publisher_v1',kind:'agent_zdt_source_sha_refresh_publisher_v1'}\n});";
  const specReplacement = "  agent_zdt_source_sha_refresh_publisher_v1:{operation:'host_action.agent_zdt_source_sha_refresh_publisher_v1',kind:'agent_zdt_source_sha_refresh_publisher_v1'},\n  safe_delivery_profile_enable_next_v1:{operation:'host_action.safe_delivery_profile_enable_next_v1',kind:'safe_delivery_profile_enable_next_v1'}\n});";
  let out = once(source, specAnchor, specReplacement, 'exec_spec');
  const applyAnchor = 'applyHostActionV2=async function(action){';
  const fn = "const SAFE_DELIVERY_ENABLE_NEXT_HELPER='/opt/prhm-agent-selfmaint-exec/actions/safe-delivery-profile-enable-next-v1.js';\n"+
    "const SAFE_DELIVERY_ENABLE_NEXT_RESULT_ROOT='/var/lib/prhm-agent-selfmaint-exec/safe-delivery-profile-enable-next-v1';\n"+
    "const SAFE_DELIVERY_ENABLE_NEXT_RESULT=SAFE_DELIVERY_ENABLE_NEXT_RESULT_ROOT+'/latest.json';\n"+
    "function applySafeDeliveryProfileEnableNextV1(){const bytes=fs.readFileSync(SAFE_DELIVERY_ENABLE_NEXT_HELPER);const actual=require('node:crypto').createHash('sha256').update(bytes).digest('hex');if(actual!=='"+helperSha+"')throw new Error('safe_delivery_enable_next_helper_sha_mismatch');fs.mkdirSync(SAFE_DELIVERY_ENABLE_NEXT_RESULT_ROOT,{recursive:true,mode:0o700});try{if(fs.existsSync(SAFE_DELIVERY_ENABLE_NEXT_RESULT))fs.unlinkSync(SAFE_DELIVERY_ENABLE_NEXT_RESULT)}catch{}const unit='prhm-safe-delivery-enable-next-v1-'+Date.now();const args=['--wait','--collect','--quiet','--unit='+unit,'--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true','--property=PrivateTmp=true','--property=ProtectSystem=strict','--property=ProtectHome=read-only','--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=ReadWritePaths=/var/lib/prhm-agent-instant-delivery-v1/instant-delivery /var/lib/prhm-agent-selfmaint-exec/safe-delivery-profile-enable-next-v1','--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/usr/local/bin/prhm-node',SAFE_DELIVERY_ENABLE_NEXT_HELPER];cp.execFileSync('/usr/bin/systemd-run',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:1024*1024});const result=readJson(SAFE_DELIVERY_ENABLE_NEXT_RESULT);if(!result||result.ok!==true||result.schema_version!=='prhm.host-action-result.v1'||result.action!=='safe_delivery_profile_enable_next_v1'||result.database_mutation!==false||result.production_application_mutation!==false||result.rollback_performed!==false)throw new Error('safe_delivery_enable_next_result_invalid');return result}\n";
  out = once(out, applyAnchor, fn + applyAnchor + "if(action==='safe_delivery_profile_enable_next_v1')return applySafeDeliveryProfileEnableNextV1();", 'exec_apply');
  return out;
}
function buildHelperSource(){ const bytes=fs.readFileSync(HELPER_SOURCE_PATH); if(sha256(bytes)!==HELPER_REPO_SHA) fail('helper_repo_sha_mismatch'); return bytes.toString('utf8'); }
function assertSource(name, bytes, expected){ if(sha256(bytes)!==expected) fail(name+'_sha_mismatch'); }
function buildInstallPlan(sources){
  for (const key of ['base','exec','policy','canonicalMcp','candidateMcp']) if (typeof sources[key] !== 'string') fail('install_source_missing_'+key);
  assertSource('base',Buffer.from(sources.base),BASE_SHA); assertSource('exec',Buffer.from(sources.exec),EXEC_SHA);
  assertSource('policy',Buffer.from(sources.policy),POLICY_SHA); assertSource('canonical_mcp',Buffer.from(sources.canonicalMcp),MCP_SHA);
  assertSource('candidate_mcp',Buffer.from(sources.candidateMcp),CANDIDATE_MCP_SHA);
  const helper = buildHelperSource(); const helperSha = sha256(Buffer.from(helper));
  const candidates = {
    base:buildBaseCandidate(sources.base), exec:buildExecCandidate(sources.exec,helperSha), policy:buildPolicyCandidate(sources.policy),
    canonicalMcp:buildMcpCandidate(sources.canonicalMcp), candidateMcp:buildMcpCandidate(sources.candidateMcp), helper
  };
  return { helper_sha256:helperSha, candidates, candidate_sha256:Object.fromEntries(Object.entries(candidates).map(([k,v])=>[k,sha256(Buffer.from(v))])) };
}
function readBoundFile(file, expectedSha){ const st=fs.lstatSync(file); if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(file)!==file)fail('install_target_invalid:'+file); const bytes=fs.readFileSync(file); if(sha256(bytes)!==expectedSha)fail('install_preimage_sha_mismatch:'+file); return {st,bytes,text:bytes.toString('utf8')}; }
function preflight(){
  if (fs.existsSync(PATHS.helper)) fail('installer_helper_already_present');
  const bound={
    base:readBoundFile(PATHS.base,BASE_SHA), exec:readBoundFile(PATHS.exec,EXEC_SHA), policy:readBoundFile(PATHS.policy,POLICY_SHA),
    canonicalMcp:readBoundFile(PATHS.canonicalMcp,MCP_SHA), candidateMcp:readBoundFile(PATHS.candidateMcp,CANDIDATE_MCP_SHA)
  };
  const plan=buildInstallPlan(Object.fromEntries(Object.entries(bound).map(([k,v])=>[k,v.text])));
  return {bound,plan};
}
function atomicWrite(file, bytes, st){ const dir=path.dirname(file); const tmp=path.join(dir,'.'+path.basename(file)+'.v30-'+process.pid+'-'+Date.now()+'.tmp'); let fd; try{fd=fs.openSync(tmp,'wx',st?st.mode&0o777:0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;if(st){fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode&0o777);}fs.renameSync(tmp,file);const dfd=fs.openSync(dir,'r');try{fs.fsyncSync(dfd)}finally{fs.closeSync(dfd)}}catch(e){try{if(fd!==undefined)fs.closeSync(fd)}catch{}try{fs.unlinkSync(tmp)}catch{}throw e} }
function runSystemctl(args){ const r=cp.spawnSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:60000,maxBuffer:300000}); if(r.error||r.status!==0)fail('installer_systemctl_failed:'+args.join('_')); }
function verifyService(service){ runSystemctl(['is-active','--quiet',service]); }
function install(){
  const {bound,plan}=preflight();
  fs.mkdirSync(INSTALL_BACKUP_ROOT,{recursive:true,mode:0o700});
  const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+process.pid;
  const backupDir=path.join(INSTALL_BACKUP_ROOT,stamp);fs.mkdirSync(backupDir,{mode:0o700});
  const order=['base','exec','policy','canonicalMcp','candidateMcp'];
  for(const key of order)fs.writeFileSync(path.join(backupDir,key+'.bak'),bound[key].bytes,{mode:0o600,flag:'wx'});
  let helperWritten=false; let mutated=[];
  try{
    atomicWrite(PATHS.helper,Buffer.from(plan.candidates.helper),null);helperWritten=true;
    for(const key of order){atomicWrite(PATHS[key],Buffer.from(plan.candidates[key]),bound[key].st);mutated.push(key);}
    for(const key of order){if(sha256(fs.readFileSync(PATHS[key]))!==plan.candidate_sha256[key])fail('installer_postwrite_sha_mismatch:'+key)}
    if(sha256(fs.readFileSync(PATHS.helper))!==plan.helper_sha256)fail('installer_helper_postwrite_sha_mismatch');
    for(const service of SERVICES)runSystemctl(['restart',service]);
    for(const service of SERVICES)verifyService(service);
    return {ok:true,schema_version:'prhm.host-action-installer-result.v1',action:ACTION,installed:true,helper_sha256:plan.helper_sha256,candidate_sha256:plan.candidate_sha256,backup_dir:backupDir,rollback_performed:false};
  }catch(error){
    let rollbackError=null;
    try{
      for(const key of [...mutated].reverse())atomicWrite(PATHS[key],bound[key].bytes,bound[key].st);
      if(helperWritten)try{fs.unlinkSync(PATHS.helper)}catch(e){if(e.code!=='ENOENT')throw e;}
      for(const key of order)if(sha256(fs.readFileSync(PATHS[key]))!==sha256(bound[key].bytes))fail('installer_rollback_sha_mismatch:'+key);
      for(const service of SERVICES)runSystemctl(['restart',service]);
      for(const service of SERVICES)verifyService(service);
    }catch(rb){rollbackError=String(rb&&rb.message||rb)}
    if(rollbackError)fail('installer_failed_rollback_failed:'+String(error&&error.message||error)+':'+rollbackError);
    fail('installer_failed_rolled_back:'+String(error&&error.message||error));
  }
}
module.exports={ACTION,OPERATION,POLICY_VERSION,CURRENT_POLICY_VERSION,POLICY_SHA,BASE_SHA,EXEC_SHA,MCP_SHA,CANDIDATE_MCP_SHA,HELPER_REPO_SHA,HELPER_SOURCE_PATH,PATHS,SERVICES,buildPolicyCandidate,buildMcpCandidate,buildBaseCandidate,buildExecCandidate,buildHelperSource,buildInstallPlan,preflight,install};
