#!/usr/bin/env node
'use strict';
/*
 * Shared PRHM release transaction coordinator.
 * No shell, root, network, filesystem mutation, or production apply CLI.
 * Production execution requires a separately reviewed trusted adapter
 * registry and a native signed, single-use approval-center implementation.
 */
const gate=require('./prhm-fast-delivery-gate-v1.cjs');
const PROJECTS=gate.PROFILES;
const SHA=gate.SHA;
const LEVELS=Object.freeze(new Set(['L3','L4']));
const fail=(code)=>{throw new Error(code)};
const validId=s=>typeof s==='string'&&/^[a-z][a-z0-9_]*$/.test(s);
function boundedError(e){return String(e&&e.message||e).slice(0,180);}
function assertRequest(project,sha){
 if(!validId(project)||!Object.hasOwn(PROJECTS,project))fail('project_not_allowlisted');
 if(typeof sha!=='string'||!SHA.test(sha))fail('sha_must_be_40_hex');
 return PROJECTS[project];
}
function assertSnapshot(project,sha,profile,state){
 if(!state||state.project!==project||state.head!==sha||state.root!==profile.root||
   state.branch!==profile.branch||state.adapter!==profile.adapter||
   state.ready!==true||state.changed_files!==0||!Array.isArray(state.blockers)||
   state.blockers.length!==0)fail('git_preflight_failed');
}
function assertAdapter(project,profile,registry){
 if(!registry||!Object.hasOwn(registry,project))fail('trusted_adapter_missing');
 const a=registry[project];
 if(!a||a.project!==project||a.root!==profile.root||
    a.profile_adapter!==profile.adapter||!validId(a.action)||
    !SHA.test(a.registration_sha)||!LEVELS.has(a.approval_level)||
    !['preflight','test','build','deploy','smoke','rollback'].every(x=>typeof a[x]==='function'))
    fail('trusted_adapter_contract_invalid');
 return a;
}
function assertApproval(proof,project,sha,adapter){
 if(!proof||proof.ok!==true||proof.project!==project||proof.sha!==sha||
    proof.action!==adapter.action||proof.target!==adapter.root||
    proof.approval_level!==adapter.approval_level||
    proof.registration_sha!==adapter.registration_sha||
    proof.single_use_consumed!==true||proof.signature_verified!==true||
    proof.decision!=='approved'||!Number.isFinite(Date.parse(proof.expires_at))||
    Date.parse(proof.expires_at)<=Date.now())fail('approval_binding_invalid');
}
function receiptBase(project,sha,adapter,now){
 return {schema:'prhm.fast-delivery.release-receipt.v1',project,sha,
  target:adapter.root,action:adapter.action,registration_sha:adapter.registration_sha,
  approval_level:adapter.approval_level,at:now()};
}
async function coordinate({project,sha,registry,approvalCenter,logger,
 inspectProject=gate.inspect,now=()=>new Date().toISOString()}){
 const profile=assertRequest(project,sha);
 if(typeof inspectProject!=='function'||!approvalCenter||
   typeof approvalCenter.consumeExact!=='function'||!logger||
   typeof logger.append!=='function')fail('trusted_dependencies_required');
 const adapter=assertAdapter(project,profile,registry);
 const payload=Object.freeze({project,sha,root:profile.root,action:adapter.action,
  registration_sha:adapter.registration_sha,approval_level:adapter.approval_level});
 const inspectNow=()=>assertSnapshot(project,sha,profile,inspectProject(project,{sha}));
 inspectNow();
 let deployStarted=false,rollback='not_required',phase='preflight',reason=null,receipt=null;
 let baselineSha=null;
 async function appendDurable(row){
  const confirmation=await logger.append(row);
  if(!confirmation||confirmation.ok!==true||confirmation.durable!==true)
   fail('durable_receipt_not_confirmed');
 }
 try{
   const baseline=await adapter.preflight(payload);
   if(!baseline||baseline.ok!==true||typeof baseline.baseline_sha256!=='string'||
    !/^[a-f0-9]{64}$/.test(baseline.baseline_sha256))fail('baseline_evidence_invalid');
   baselineSha=baseline.baseline_sha256;
   phase='test';await adapter.test(payload);
   phase='build';await adapter.build(payload);
   // No production mutation until an exact, signed, single-use approval
   // is consumed by the TRUSTED approval-center integration.
   phase='approval';
   const proof=await approvalCenter.consumeExact(payload);
   assertApproval(proof,project,sha,adapter);
   inspectNow();
   // A durable pre-deploy receipt is required before cutover.
   phase='logging_pre_deploy';
   await appendDurable({...receiptBase(project,sha,adapter,now),status:'deploy_starting',rollback,baseline_sha256:baselineSha});
   phase='deploy';
   deployStarted=true;
   const deployment=await adapter.deploy(payload);
   if(!deployment||deployment.ok!==true||deployment.deployed_sha!==sha)
    fail('deployed_sha_evidence_invalid');
   phase='smoke';
   const health=await adapter.smoke(payload);
   if(!health||health.ok!==true)fail('health_check_failed');
   phase='logging_success';
   receipt={...receiptBase(project,sha,adapter,now),status:'deployed',
    health,rollback:'not_required'};
   await appendDurable(receipt);
   return receipt;
 }catch(e){
   reason=boundedError(e);
   if(deployStarted){
     phase='rollback';
     try{
      const restored=await adapter.rollback({...payload,reason,baseline_sha256:baselineSha});
      if(!restored||restored.ok!==true||restored.restored_baseline_sha256!==baselineSha||
       !restored.health||restored.health.ok!==true)fail('rollback_evidence_invalid');
      rollback='verified';
     }catch(re){rollback='failed:'+boundedError(re);}
   }
   const terminal={...receiptBase(project,sha,adapter,now),
    status:rollback.startsWith('failed:')?'failed_rollback_unverified':'failed',
    failed_phase:phase,error:reason,rollback};
   try{await appendDurable(terminal);}
   catch(logError){
     fail('release_failed_and_receipt_write_failed:'+boundedError(logError)+':'+reason+':rollback='+rollback);
   }
   fail('release_failed:'+reason+':rollback='+rollback);
 }
}
function plan(project,sha){
 const p=assertRequest(project,sha);
 const result=gate.inspect(project,{sha});
 return {ok:true,read_only:true,mode:'plan',project,sha,
  root:p.root,stack:p.stack,adapter:p.adapter,git:result,
  execution_enabled:false,
  required_phases:['git_preflight','adapter_preflight','test','build',
   'approval_center_consume_exact','git_recheck','deploy_start_receipt',
   'deploy','health','receipt_or_rollback'],
  next:result.ready?'register_trusted_fixed_adapter_and_approval_center':
   'resolve_profile_blockers'};
}
function cli(args=process.argv.slice(2)){
 if(args.length!==4||args[0]!=='--plan'||args[2]!=='--sha')
  fail('usage: --plan <allowlisted-project> --sha <40hex>; no --apply interface');
 return plan(args[1],args[3]);
}
if(require.main===module){
 try{process.stdout.write(JSON.stringify(cli())+'\n');}
 catch(e){process.stderr.write(JSON.stringify({ok:false,error:boundedError(e)})+'\n');process.exitCode=2;}
}
module.exports={assertRequest,assertSnapshot,assertAdapter,assertApproval,coordinate,plan,cli};
