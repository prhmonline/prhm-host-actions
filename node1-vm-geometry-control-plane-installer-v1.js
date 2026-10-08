'use strict';
// Candidate integration transaction. No CLI, shell, FS operations, network access or
// production apply side effects on import. Only an independently authenticated,
// SHA-bound Agent3 Host Action may call activate() with real fixed adapters.
// The module never accepts arbitrary paths, commands, hosts or service names.
const bundle=require('./node1-vm-geometry-attested-bundle-v1');
const preflight=require('./node1-vm-geometry-deploy-preflight-v1');
const REGISTRATION=require('./node1-vm-geometry-registration-plan-v1');
const ACTION='node1_vm_geometry_readonly_registration_v1';
const OPERATION='host_action.node1_vm_geometry_readonly_registration_v1';
const SERVICES=Object.freeze(['prhm-agent-api.service','prhm-agent-mcp.service']);
const FIXED_REGISTRATIONS=Object.freeze([
 Object.freeze({service:SERVICES[0],target:REGISTRATION.TARGETS.apiRoute,tool:'node1_vm_geometry_readonly_v1'}),
 Object.freeze({service:SERVICES[1],target:REGISTRATION.TARGETS.mcpPlugin,tool:'node1_vm_geometry_readonly_v1'})
]);
const SCHEMA='prhm.node1-readonly-fixed-release.v1';
function assert(ok,msg){if(!ok)throw Error(msg)}
function rejectSecret(payload){assert(payload===undefined||payload===null||typeof payload==='object','payload_invalid')}
function validateReleaseIntent(intent){
 assert(intent&&typeof intent==='object'&&!Array.isArray(intent),'intent_missing');
 const keys=Object.keys(intent).sort().join('|');
 assert(keys==='action|commitSha|level|operation|repo|requestId|target','intent_shape_invalid');
 assert(intent.action===ACTION&&intent.operation===OPERATION,'operation_not_allowlisted');
 assert(intent.repo==='prhmonline/prhm-host-actions','repo_identity_invalid');
 assert(/^[a-f0-9]{40}$/.test(intent.commitSha),'commit_sha_invalid');
 assert(intent.level===4,'level4_required');
 assert(intent.target==='agent3-primary/node1-readonly','target_not_allowlisted');
 assert(/^[a-f0-9-]{36}$/.test(intent.requestId),'request_id_invalid');
 return Object.freeze({...intent});
}
function validatePorts(ports){
 assert(ports&&['verifyTrustedAuthorization','verifyCurrentOwners','verifySourceArtifacts','verifyFixedTransport','begin','snapshot','stage','bind','reload','health','audit','commit','restore','verifyRollback'].every(k=>typeof ports[k]==='function'),'installer_port_incomplete');
}
function staticPlan(){
 return Object.freeze({
   schema_version:SCHEMA,
   action:ACTION,operation:OPERATION,level:4,
   source_repo:'prhmonline/prhm-host-actions',
   pinned_runner_source_commit:REGISTRATION.SOURCE_COMMIT,
   staged_files:bundle.FILES.length,
   services:SERVICES,
   registrations:FIXED_REGISTRATIONS,
   requires_verified_transport:true,
   requires_out_of_band_keys:true,
   requires_persistent_signed_approval:true,
   source_commits_must_not_be_reverted_on_failure:true,
   ready_for_production:false,request_created:false,installed:false
 });
}
async function activate({intent,ports}={}){
 // Fail-closed: no activation until ALL external trusted guards verify.
 const scope=validateReleaseIntent(intent);validatePorts(ports);
 const externalProof=await ports.verifyTrustedAuthorization(scope);
 assert(externalProof?.trusted===true&&externalProof?.oneTime===true&&
   externalProof?.requestId===scope.requestId&&externalProof?.commitSha===scope.commitSha&&
   externalProof?.action===ACTION&&externalProof?.level===4,'trusted_level4_authorization_missing');
 const owners=await ports.verifyCurrentOwners(preflight.OWNERS);
 assert(preflight.validateObserved(owners).ok,'installed_owner_sha_drift');
 const source=await ports.verifySourceArtifacts(bundle.FILES,scope.commitSha);
 assert(source&&source.exactBlobMatch===true&&source.sourceRevision===bundle.SOURCE_REVISION&&
   source.commitSha===scope.commitSha,'source_commit_or_blob_mismatch');
 const transport=await ports.verifyFixedTransport({
   operation:'node1_vm_geometry_readonly_api_v1',
   runnerGitBlob:REGISTRATION.FILES.find(f=>f.path==='node1-vm-geometry-runner-v1.js').sha,
   host:'server1.prhm.ir'
 });
 assert(transport?.approved===true&&transport?.fixedOnly===true&&transport?.host==='server1.prhm.ir'&&
   transport?.operation==='node1_vm_geometry_readonly_api_v1'&&transport?.readOnly===true&&
   transport?.signedReceipts===true&&transport?.pinnedTrustRoot===true&&transport?.persistentAntiReplay===true,
   'trusted_fixed_node1_transport_missing');
 let begun=false,previous=null,stage='approved';
 try {
   await ports.begin({action:ACTION,requestId:scope.requestId,commitSha:scope.commitSha});begun=true;
   await ports.audit({event:'begin',stage,repo:scope.repo,branch:'feature/node1-backup-assurance-v1',
     commitSha:scope.commitSha,target:scope.target,requestId:scope.requestId});
   previous=await ports.snapshot(SERVICES);
   assert(previous?.verified===true&&previous?.services?.join('|')===SERVICES.join('|')&&
      previous?.rollbackAvailable===true,'baseline_snapshot_unverified');
   stage='snapshot';
   await ports.stage({files:bundle.FILES,sourceCommit:scope.commitSha,runnerCommit:REGISTRATION.SOURCE_COMMIT});
   stage='staged';
   await ports.bind(FIXED_REGISTRATIONS);
   stage='bound';
   await ports.reload(SERVICES);
   stage='reloaded';
   const health=await ports.health({services:SERVICES,tool:'node1_vm_geometry_readonly_v1',readOnly:true});
   assert(health?.api===true&&health?.mcp===true&&health?.fixedToolVisible===true&&
     health?.exactSchema===true&&health?.probeMutation===false,'post_activation_health_failed');
   stage='health';
   await ports.audit({event:'verified',stage,repo:scope.repo,branch:'feature/node1-backup-assurance-v1',
     commitSha:scope.commitSha,target:scope.target,requestId:scope.requestId});
   await ports.commit({requestId:scope.requestId,commitSha:scope.commitSha});
   return Object.freeze({ok:true,stage:'verified',activated:true,
     sourceSha:scope.commitSha,rollbackPerformed:false,probesPerformed:false});
 } catch(error){
   let rolledBack=false,rollbackHealthy=false;
   if(begun){
     try{
       await ports.restore({snapshot:previous,services:SERVICES});
       const recovery=await ports.verifyRollback({services:SERVICES,snapshot:previous});
       rolledBack=recovery?.restored===true;
       rollbackHealthy=recovery?.servicesHealthy===true;
     }catch{}
     try{await ports.audit({event:'failed',stage,commitSha:scope.commitSha,
       repo:scope.repo,branch:'feature/node1-backup-assurance-v1',target:scope.target,
       requestId:scope.requestId,rolledBack,rollbackHealthy,
       errorCode:String(error?.message||error).replace(/[^a-z0-9:_-]/gi,'').slice(0,140)})}catch{}
   }
   if(begun&&(!rolledBack||!rollbackHealthy))throw Error('activation_failed_rollback_unverified');
   throw Error('activation_failed_rolled_back:'+String(error?.message||error).replace(/[^a-z0-9:_-]/gi,'').slice(0,100));
 }
}
module.exports={ACTION,OPERATION,SCHEMA,SERVICES,FIXED_REGISTRATIONS,staticPlan,validateReleaseIntent,validatePorts,activate};
