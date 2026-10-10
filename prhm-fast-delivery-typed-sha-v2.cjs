#!/usr/bin/env node
'use strict';
/*
 * Read-only contract for per-release SHA-bound Approval Center requests.
 * Does not send HTTP, consume tokens, register actions, write files or deploy.
 * A future trusted native Agent 3 adapter MUST be the sole caller of
 * consumeNativeApproval; caller-provided network endpoints are prohibited.
 */
const crypto=require('node:crypto');
const gate=require('./prhm-fast-delivery-gate-v1.cjs');
const SHA=/^[a-f0-9]{40}$/;

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEVEL=4;
const ACTION='rahekomak_web_only_release_v2';
const OPERATION='host_action.'+ACTION;
const PROJECT='rahekomak';
const RISK='critical';
const fail=s=>{throw Error(s)};
function canonicalJson(x) {
 if(x===null||typeof x!=='object')return JSON.stringify(x);
 if(Array.isArray(x))return '['+x.map(canonicalJson).join(',')+']';
 const keys=Object.keys(x).sort();
 return '{'+keys.map(k=>JSON.stringify(k)+':'+canonicalJson(x[k])).join(',')+'}';
}
function sha256(x){return crypto.createHash('sha256').update(x).digest('hex');}
function validateExact(obj,fields,label){
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||
    JSON.stringify(Object.keys(obj).sort())!==JSON.stringify([...fields].sort()))
  fail(label+'_field_set_invalid');
}
function makeBinding(input){
 validateExact(input,['project','sha','registration_sha'],'release');
 const p=gate.PROFILES[input.project];
 if(!p||input.project!==PROJECT)fail('project_unregistered_for_typed_v2');
 if(!SHA.test(input.sha))fail('sha_must_be_40_hex');
 if(!SHA.test(input.registration_sha))fail('registry_binding_commit_invalid');
 if(p.adapter!=='web-only-manual-level4'||p.stack!=='static-next')fail('project_stack_mismatch');
 const argumentsObject=Object.freeze({
  action:ACTION,
  project:PROJECT,
  commit_sha:input.sha,
  source_root:p.root,
  branch:p.branch,
  scope:'web-only-static',
  adapter_registration_commit_sha:input.registration_sha
 });
 const arguments_sha256=sha256(canonicalJson(argumentsObject));
 return Object.freeze({
  action:ACTION,operation:OPERATION,level:LEVEL,risk:RISK,
  project:PROJECT,sha:input.sha,root:p.root,
  branch:p.branch,registration_sha:input.registration_sha,
  arguments:Object.freeze(argumentsObject),arguments_sha256,
  approval_scope:Object.freeze({
   principal_id:'mohammad',role:'mcp-operator',tool:'host_action_v2_apply',
   project:'control_plane',environment:'production',action:ACTION,risk:RISK
  })
 });
}
function assertConsumed(approved,binding,expectedRequestId,nowMs=Date.now()){
 if(!UUID.test(expectedRequestId))fail('request_id_invalid');
 if(!Number.isFinite(nowMs))fail('time_invalid');
 // The object MUST come from the authenticated native /v1/consume
 // response. This validation alone is not proof of signature or token
 // authenticity; the Approval Center server verifies Ed25519 + replay.
 const r=approved;
 if(!r||r.ok!==true||r.consumed!==true||!r.consumption||
   !r.approval||typeof r.approval!=='object')fail('native_consume_proof_missing');
 const a=r.approval,c=r.consumption;
 if(!UUID.test(c.approval_id)||a.approval_id!==c.approval_id||
   a.request_id!==expectedRequestId||c.request_id!==expectedRequestId||
   !['prhm.approval-consumption.v1'].includes(c.schema_version))
    fail('request_or_consumption_mismatch');
 if(a.action!==binding.action||a.operation!==binding.operation||
    a.arguments_sha256!==binding.arguments_sha256||
    a.project!=='control_plane'||a.environment!=='production'||
    a.risk!==RISK||a.level!==LEVEL||a.consumed!==true||
    a.execution_authorized!==true||a.expired!==false||a.revoked!==false||
    c.operation!==binding.operation||c.project_id!=='control_plane')
   fail('sha_bound_approval_mismatch');
 if(!Number.isFinite(Date.parse(a.expires_at))||
    Date.parse(a.expires_at)<=nowMs)fail('approval_expired');
 return Object.freeze({
  ok:true,project:binding.project,sha:binding.sha,
  action:binding.action,target:binding.root,
  approval_level:'L4',registration_sha:binding.registration_sha,
  single_use_consumed:true,signature_verified:true,decision:'approved',
  expires_at:a.expires_at,request_id:expectedRequestId,
  approval_id:a.approval_id,arguments_sha256:binding.arguments_sha256
 });
}
async function consumeNativeApproval({binding,request_id,consumeNative}){
 // Trusted native injection only; no token, URL, filesystem path,
 // arbitrary command or user-created proof accepted by this method.
 if(typeof consumeNative!=='function')fail('trusted_native_consumer_missing');
 const nativeResult=await consumeNative({
  request_id,
  action:binding.action,
  arguments_sha256:binding.arguments_sha256,
  project:'control_plane',
  operation:binding.operation
 });
 return assertConsumed(nativeResult,binding,request_id);
}
function main(argv=process.argv.slice(2)){
 // Safe planning interface: no approval, action registration or deploy mode.
 if(argv.length!==3||argv[0]!=='--plan')fail('usage: --plan <40hex> <registration-commit-sha40>; no apply');
 const p=makeBinding({project:PROJECT,sha:argv[1],registration_sha:argv[2]});
 return {ok:true,read_only:true,mode:'typed_sha_plan_v2',sha:p.sha,action:p.action,
  target:p.root,arguments_sha256:p.arguments_sha256,
  approval_level:p.level,release_executed:false,installed:false,
  next:'register_trusted_typed_request_bridge_v2_and_native_signed_consumer'};
}
if(require.main===module){
 try{process.stdout.write(JSON.stringify(main())+'\n');}
 catch(e){process.stderr.write(JSON.stringify({ok:false,error:e.message})+'\n');process.exitCode=2;}
}
module.exports={canonicalJson,sha256,makeBinding,assertConsumed,
 consumeNativeApproval,main,ACTION,OPERATION,PROJECT};
