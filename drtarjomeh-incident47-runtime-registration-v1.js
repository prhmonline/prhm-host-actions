'use strict';
// Source-only fixed Host Action registration builder for incident #47.
// Generates exact-site, additive, hash-bound candidates. No file/service writes.
// The reviewed runner may be invoked only AFTER existing Host Actions v2
// server-side confirm + authorize-consume succeeds; it never accepts user input.
const crypto=require('node:crypto');
const pins=require('./drtarjomeh-incident47-l4-registration-candidate-v1.js');

const ACTION=pins.ACTION;
const OPERATION=pins.OPERATION;
const HOST_BASE='4665863cbb40532298e78ba1588d45124ad20da8';
const RUNNER_TARGET='/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-incident47-reviewed-host-runner-v1.js';
const RUNNER_GIT_BLOB='df6a4ab6450d2a9c794bb42782e17ceda1c23f65';
const APP_SHA=pins.SOURCE_COMMIT;
const FALLBACK_DISPATCH='async function applyHostActionV2(action){const spec=hostActionV2Spec(action);';
const BASE_ANCHOR='const HOST_ACTION_V2_SPECS = Object.freeze({\n';
const MCP_ANCHOR="'control_plane_current_owner_binding_refresh_v1']);";
function fail(code){throw new Error(code);}
function injectExactlyOnce(s,anchor,replace,label){
  if(typeof s!=='string')fail(label+'_input_invalid');
  const n=s.split(anchor).length-1;
  if(n!==1)fail(label+'_anchor_count_'+n);
  return s.replace(anchor,replace);
}
function assertNotAlreadyRegistered(text,label){
  if(text.includes(ACTION)||text.includes(OPERATION))fail(label+'_already_registered');
}
function assertLiveBytePreimage(kind,buffer){
  const spec=pins.LIVE[kind];
  if(!spec||!Buffer.isBuffer(buffer)||!buffer.length)fail(kind+'_bytes_missing');
  if(pins.sha256(buffer)!==spec.sha256)fail(kind+'_live_preimage_mismatch');
  return buffer.toString('utf8');
}
function baseTransform(source){
  assertNotAlreadyRegistered(source,'base');
  const item="  "+ACTION+": { operation: '"+OPERATION+
    "', rollback: 'host-action-v2:drtarjomeh-incident47-guard-v1:preimage-restore' },\n";
  return injectExactlyOnce(source,BASE_ANCHOR,BASE_ANCHOR+item,'base');
}
function executorTransform(source){
  assertNotAlreadyRegistered(source,'executor');
  const spec="  "+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'},\n";
  let out=injectExactlyOnce(source,BASE_ANCHOR,BASE_ANCHOR+spec,'executor_spec');
  const fn=[
    "function applyDrtI47GuardAfterTrustedApproval(){",
    " const bytes=fs.readFileSync('/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-incident47-reviewed-host-runner-v1.js');",
    " const expected='df6a4ab6450d2a9c794bb42782e17ceda1c23f65';",
    " const gitsha=require('node:crypto').createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\\0'),bytes])).digest('hex');",
    " if(gitsha!==expected)throw new Error('drt_i47_runner_source_mismatch');",
    " const runner=require('/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-incident47-reviewed-host-runner-v1.js');",
    " return runner.runAfterTrustedApproval();",
    "}"
  ].join('\n')+'\n';
  out=injectExactlyOnce(out,FALLBACK_DISPATCH,
    fn+FALLBACK_DISPATCH+"if(action==='"+ACTION+"')return applyDrtI47GuardAfterTrustedApproval();",
    'executor_dispatch');
  return out;
}
function mcpTransform(source){
  assertNotAlreadyRegistered(source,'mcp');
  return injectExactlyOnce(source,MCP_ANCHOR,
    "'control_plane_current_owner_binding_refresh_v1','"+ACTION+"']);",
    'mcp_enum');
}
function policyTransform(buffer){
  return pins.buildPolicyCandidate(buffer).toString('utf8');
}
function verifyRunner(readSource){
  if(typeof readSource!=='function')fail('runner_reader_required');
  const bytes=readSource('drtarjomeh-incident47-reviewed-host-runner-v1.js');
  if(!Buffer.isBuffer(bytes)||pins.gitBlob(bytes)!==RUNNER_GIT_BLOB)
    fail('runner_git_blob_mismatch');
  return {path:RUNNER_TARGET,git_blob_sha:RUNNER_GIT_BLOB,bytes:bytes.length};
}
function buildCandidates({readOwner,readRunner,hostMainSha=HOST_BASE}={}){
  if(hostMainSha!==HOST_BASE)fail('host_main_sha_drift');
  if(typeof readOwner!=='function')fail('owner_reader_required');
  const input={};
  for(const kind of ['base','executor','policy','mcp']){
    const spec=pins.LIVE[kind];
    input[kind]=readOwner(spec.path);
    assertLiveBytePreimage(kind,input[kind]);
  }
  const runner=verifyRunner(readRunner);
  const candidates={
    base:baseTransform(input.base.toString('utf8')),
    executor:executorTransform(input.executor.toString('utf8')),
    mcp:mcpTransform(input.mcp.toString('utf8')),
    policy:policyTransform(input.policy),
  };
  return Object.freeze({
    schema:'prhm.drtarjomeh.incident47.runtime-registration-candidate.v1',
    source_repo:'prhmonline/prhm-host-actions',git_baseline:HOST_BASE,
    approved_app_sha:APP_SHA,action:ACTION,operation:OPERATION,
    runner,targets:Object.freeze(Object.entries(pins.LIVE).map(([kind,s])=>
      ({kind,path:s.path,before_sha256:s.sha256,
        after_sha256:pins.sha256(Buffer.from(candidates[kind],'utf8'))}))),
    candidate_sources:Object.freeze(candidates),
    registration_complete:false,
    production_mutation:false,
    deployment_authorized:false,
    reasons:Object.freeze([
      'SIGNED_L4_REGISTRATION_INSTALLER_NOT_YET_APPROVED',
      'DRT_APP_PR50_NOT_MERGED',
      'EFFECTIVE_GUARD_NOT_INSTALLED'
    ])
  });
}
function cli(argv=process.argv.slice(2)){
  if(argv.length!==1||argv[0]!=='--selftest')fail('selftest_only');
  if(!/^[0-9a-f]{40}$/.test(APP_SHA)||!/^[0-9a-f]{40}$/.test(HOST_BASE))
    fail('commit_sha_invalid');
  return {ok:true,read_only:true,production_mutation:false,
    action:ACTION,runner_git_blob:RUNNER_GIT_BLOB};
}
module.exports=Object.freeze({ACTION,OPERATION,HOST_BASE,RUNNER_TARGET,RUNNER_GIT_BLOB,
  baseTransform,executorTransform,mcpTransform,policyTransform,buildCandidates,
  assertLiveBytePreimage,verifyRunner,injectExactlyOnce,cli});
if(require.main===module){
  try{process.stdout.write(JSON.stringify(cli())+'\n');}
  catch(e){process.stderr.write(String(e?.message||e)+'\n');process.exitCode=1;}
}
