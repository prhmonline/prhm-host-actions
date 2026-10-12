'use strict';
/*
 * RahKomak Host Actions v2: REGISTRATION CANDIDATE ONLY.
 * Produces fixed, fail-closed patches for the already-running control-plane
 * sources. Does not mutate the host or register a callable operation.
 * Apply ONLY through a separate Git-SHA-bound, Level-4 approved installer.
 */
const crypto=require('node:crypto');
const ACTION_STAGE='rahekomak_host_action_repair_stage_v2';
const ACTION_ACTIVATE='rahekomak_host_action_repair_activate_v2';
const ROOT='/opt/prhm-agent-selfmaint-exec/actions';
const EXISTING='rahekomak_production_deploy_v1';
const POLICY_VERSION='2026-10-08.1-rahekomak-host-action-repair-v2';
const PATHS=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  executor:'/opt/prhm-agent-selfmaint-exec/server.js',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json'
});
const PREIMAGE=Object.freeze({
  base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
  executor:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
  mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',
  policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'
});
const ARTIFACTS=Object.freeze({
  'rahekomak-host-action-stage-v2.js':'52567797c88801150f4875701f9d393f3e01e374',
  'rahekomak-host-action-repair-installer-v2.js':'62b6639c63641a4061b933072ee824b34a3699b3',
  'rahekomak-host-action-activation-v2.js':'2bf5655a829b5b02b88ad0725ee2e1d6939650a5',
  'rahekomak-host-action-executor-patch-v2.js':'255f350ad4a5f29192156fe9c4565ba8cedead3a',
  'rahekomak-production-deploy-worker-v2.js':'6b8df4e4d5e2d7c057251e58717c5b00d5307287'
});
const ANCHOR_BASE="  "+EXISTING+": { operation: 'host_action."+EXISTING+"', rollback: 'host-action-v2:rahekomak-production-deploy-v1:helper-transaction-rollback' },";
const ANCHOR_EXEC="  "+EXISTING+":{operation:'host_action."+EXISTING+"',kind:'"+EXISTING+"'},";
const ANCHOR_MCP="'"+EXISTING+"'";
const ANCHOR_BLOCK='const applyHostActionV2Original=applyHostActionV2;';
const ANCHOR_DISPATCH='return applyHostActionV2Original(action);};';

function fail(code){throw new Error(code)}
function count(s,needle){return s.split(needle).length-1}
function assertUnique(text,anchor){
  if(typeof text!=='string'||count(text,anchor)!==1)fail('anchor_missing_or_duplicated');
}
function sha256(b){return crypto.createHash('sha256').update(b).digest('hex')}
function verifyPreimages(sources){
  if(!sources||typeof sources!=='object')fail('missing_sources');
  for(const [k,expected] of Object.entries(PREIMAGE)){
    if(typeof sources[k]!=='string'||sha256(Buffer.from(sources[k],'utf8'))!==expected)
      fail('preimage_sha_drift:'+k);
  }
  return true;
}
function actionSpecs(){
  const rollback='host-action-v2:rahekomak-repair-v2:exact-preimage-restore';
  return [
    {name:ACTION_STAGE,operation:'host_action.'+ACTION_STAGE,rollback},
    {name:ACTION_ACTIVATE,operation:'host_action.'+ACTION_ACTIVATE,rollback}
  ];
}
function patchBase(source){
  assertUnique(source,ANCHOR_BASE);
  for(const {name} of actionSpecs())if(source.includes(name))fail('base_action_already_present');
  const additions=actionSpecs().map(a=>
    "  "+a.name+": { operation: '"+a.operation+"', rollback: '"+a.rollback+"' },"
  ).join('\n');
  return source.replace(ANCHOR_BASE,ANCHOR_BASE+'\n'+additions);
}
function handlerBlock(){
  const header=[
    "const RAHEKOMAK_REPAIR_ROOT="+JSON.stringify(ROOT)+";",
    "const RAHEKOMAK_REPAIR_ARTIFACTS=Object.freeze("+JSON.stringify(ARTIFACTS)+");",
    "function verifyRahKomakRepairArtifactsV2(){",
    " const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');",
    " for(const [name,digest] of Object.entries(RAHEKOMAK_REPAIR_ARTIFACTS)){",
    "  const file=path.join(RAHEKOMAK_REPAIR_ROOT,name),stat=fs.lstatSync(file);",
    "  if(stat.isSymbolicLink()||!stat.isFile()||fs.realpathSync(file)!==file)throw Error('rahekomak_artifact_invalid:'+name);",
    "  const bytes=fs.readFileSync(file);",
    "  const got=crypto.createHash('sha1').update('blob '+bytes.length+'\\0').update(bytes).digest('hex');",
    "  if(got!==digest)throw Error('rahekomak_artifact_blob_mismatch:'+name);",
    " }",
    " return true;",
    "}",
    "function rahKomakRepairTransientV2(mode){",
    " const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');",
    " verifyRahKomakRepairArtifactsV2();",
    " const stage=mode==='stage',statusFile='/var/lib/prhm-agent-selfmaint-exec/rahekomak-host-action-repair-v2/stage.json';",
    " const resultFile='/var/lib/prhm-agent-selfmaint-exec/rahekomak-host-action-repair-v2/activation-result.json';",
    " if(stage&&(fs.existsSync(statusFile)||fs.existsSync(resultFile)))throw Error('rahekomak_stage_already_started');",
    " if(!stage&&(!fs.existsSync(statusFile)||fs.existsSync(resultFile)))throw Error('rahekomak_activation_not_stage_ready');",
    " const nonce=crypto.randomBytes(12).toString('hex');",
    " const unit='prhm-rahekomak-repair-'+mode+'-'+nonce;",
    " const properties=[",
    "  '--property=Type=oneshot','--property=UMask=0077','--property=NoNewPrivileges=true',",
    "  '--property=ProtectSystem=strict','--property=ProtectHome=yes','--property=PrivateTmp=true',",
    "  '--property=PrivateDevices=true','--property=ProtectKernelTunables=true',",
    "  '--property=ProtectKernelModules=true','--property=ProtectControlGroups=true',",
    "  '--property=RestrictAddressFamilies=AF_UNIX',",
    "  '--property=ReadWritePaths=/var/lib/prhm-agent-selfmaint-exec',",
    "  '--property=ReadWritePaths=/var/backups',",
    "  ...(stage?[]:['--property=ReadWritePaths=/opt/prhm-agent-selfmaint-exec']),",
    "  '--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'",
    " ];",
    " const command=stage?RAHEKOMAK_REPAIR_ROOT+'/rahekomak-host-action-stage-v2.js':RAHEKOMAK_REPAIR_ROOT+'/rahekomak-host-action-activation-v2.js';",
    " const argv=stage?[]:['--activate'];",
    " const args=stage?",
    "   ['--wait','--collect','--quiet','--unit='+unit,...properties,'/usr/local/bin/prhm-node',command,...argv]:",
    "   ['--collect','--unit='+unit,'--on-active=5s',...properties,'/usr/local/bin/prhm-node',command,...argv];",
    " const out=cp.spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:stage?120000:30000,maxBuffer:300000,stdio:['ignore','pipe','pipe']});",
    " if(out.error||out.status!==0)throw Error('rahekomak_'+mode+'_unit_failed:'+String(out.stderr||'').slice(0,300));",
    " if(!stage)return {ok:true,action:'"+ACTION_ACTIVATE+"',scheduled:true,activated:false,verification_required:true,unit,rollback_performed:false};",
    " if(!fs.existsSync(statusFile))throw Error('rahekomak_stage_report_missing');",
    " let record;try{record=JSON.parse(fs.readFileSync(statusFile,'utf8'))}catch{throw Error('rahekomak_stage_report_invalid')}",
    " if(record.action!=='rahekomak_host_action_repair_v2'||record.status!=='staged_pending_activation'",
    "  ||record.release_head!=='7f2ea82b0865bb64c8adbc3192e8547fe4f43c25')throw Error('rahekomak_stage_report_contract_failed');",
    " return {ok:true,action:'"+ACTION_STAGE+"',staged:true,activation_required:true,release_head:record.release_head,rollback_performed:false};",
    "}",
  ];
  return '\n'+header.join('\n')+'\n';
}
function patchExecutor(source){
  assertUnique(source,ANCHOR_EXEC);
  assertUnique(source,ANCHOR_BLOCK);
  assertUnique(source,ANCHOR_DISPATCH);
  for(const {name} of actionSpecs())if(source.includes(name))fail('executor_action_already_present');
  const additions=actionSpecs().map(a=>
    "  "+a.name+":{operation:'"+a.operation+"',kind:'"+a.name+"'},"
  ).join('\n');
  let out=source.replace(ANCHOR_EXEC,ANCHOR_EXEC+'\n'+additions);
  out=out.replace(ANCHOR_BLOCK,handlerBlock()+'\n'+ANCHOR_BLOCK);
  const extra="if(action==='"+ACTION_STAGE+"')return rahKomakRepairTransientV2('stage');"+
    "if(action==='"+ACTION_ACTIVATE+"')return rahKomakRepairTransientV2('activate');";
  out=out.replace(ANCHOR_DISPATCH,extra+ANCHOR_DISPATCH);
  return out;
}
function patchMcp(source){
  assertUnique(source,ANCHOR_MCP);
  if(!source.includes('const HostActionV2=z.enum('))fail('mcp_registry_anchor_missing');
  for(const {name} of actionSpecs())if(source.includes("'"+name+"'"))fail('mcp_action_already_present');
  return source.replace(ANCHOR_MCP,
    ANCHOR_MCP+",'"+ACTION_STAGE+"','"+ACTION_ACTIVATE+"'");
}
function patchPolicy(text){
  const p=JSON.parse(text);
  if(!p||typeof p!=='object'||!p.operations||!Array.isArray(p.typed_scopes))
    fail('policy_schema_mismatch');
  if(!p.operations['host_action.'+EXISTING]||
    !p.typed_scopes.some(x=>x.operation==='host_action.'+EXISTING))
    fail('existing_policy_anchor_missing');
  for(const a of actionSpecs()){
    if(p.operations[a.operation]||p.typed_scopes.some(x=>x.action===a.name||x.operation===a.operation))
      fail('policy_action_already_present');
    p.operations[a.operation]={
      level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,
      requested_approver:'mohammad',expires_seconds:180,
      policy_version:POLICY_VERSION,rollback_reference:a.rollback
    };
    p.typed_scopes.push({
      tool:'host_action_v2_apply',project:'control_plane',
      environment:'production',action:a.name,risk:'critical',
      operation:a.operation,
      principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
    });
  }
  return JSON.stringify(p,null,2)+'\n';
}
function buildCandidate(sources){
  verifyPreimages(sources);
  const next={base:patchBase(sources.base),executor:patchExecutor(sources.executor),
    mcp:patchMcp(sources.mcp),policy:patchPolicy(sources.policy)};
  for(const k of Object.keys(PREIMAGE))if(next[k]===sources[k])fail('candidate_unchanged:'+k);
  return next;
}
function manifest(){
  return Object.freeze({
    action:'rahekomak_host_action_repair_registration_v2',
    release_head:'7f2ea82b0865bb64c8adbc3192e8547fe4f43c25',
    actions:[ACTION_STAGE,ACTION_ACTIVATE],
    stage_mutates_live_executor:false,activate_requires_separate_level4:true,
    external_approved_bootstrap_required:true,
    registration_installed:false,production_mutation:false,
    fixed_preimage_sha256:PREIMAGE,artifact_git_blobs:ARTIFACTS
  });
}
module.exports={PATHS,PREIMAGE,ARTIFACTS,ACTION_STAGE,ACTION_ACTIVATE,
  ANCHOR_BASE,ANCHOR_EXEC,ANCHOR_MCP,ANCHOR_BLOCK,ANCHOR_DISPATCH,
  sha256,verifyPreimages,actionSpecs,handlerBlock,patchBase,patchExecutor,
  patchMcp,patchPolicy,buildCandidate,manifest};
if(require.main===module)process.stdout.write(JSON.stringify(manifest())+'\n');
