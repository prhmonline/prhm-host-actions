'use strict';
// Server-side typed IO bridge for the *existing* reviewed enrollment action.
// No CLI, network, OS, file, or shell access is exposed here. The privileged
// backend must be separately installed, integrity-pinned and approval-bound.
const {CONTRACT,createAction} = require('./honartik-config-center-enrollment-action-v1.cjs');
const METHODS=Object.freeze([
 'withHonartikEnrollmentLock','readHonartikEnrollmentPreflight',
 'attestHonartikApprovalAlreadyConsumed','issueHonartikReadonlyCredential',
 'revokeHonartikReadonlyCredential','readHonartikCredentialPostcondition',
 'runHonartikReadonlyYiiDiagnostic','appendHonartikEnrollmentAudit'
]);
const ALLOWED_AUDIT=Object.freeze(['action','site','sourceSha','result','rollback']);
function fixed(){return Object.freeze({
 action:CONTRACT.action,site:CONTRACT.site,revision:CONTRACT.revision,
 scope:CONTRACT.scope,backendSha:CONTRACT.backendSha,
 configCenterRelease:CONTRACT.configCenterRelease,
 scriptGitSha:CONTRACT.scriptGitSha,scriptSha256:CONTRACT.scriptSha256,
 credentialPath:CONTRACT.credentialPath,credentialName:CONTRACT.credentialName
});}
function fail(x){throw new Error(x)}
function assertTrustedHost(host){
 if(!host||typeof host!=='object')fail('trusted_host_missing');
 for(const fn of METHODS)if(typeof host[fn]!=='function')fail('trusted_host_missing_method:'+fn);
}
function preflightView(p){
 if(!p||typeof p!=='object')return {};
 return {
  site:p.site,revision:p.revision,backendSha:p.backendSha,
  configCenterRelease:p.configCenterRelease,scriptGitSha:p.scriptGitSha,
  scriptSha256:p.scriptSha256,activeCredentialCount:p.activeCredentialCount,
  credentialFileExists:p.credentialFileExists,projectGitClean:p.projectGitClean,
  scriptGitClean:p.scriptGitClean,consumerPresent:p.consumerPresent,
  allowedScope:p.allowedScope
 };
}
function postconditionView(p){
 if(!p||typeof p!=='object')return {};
 return {
  site:p.site,revision:p.revision,activeCredentialCount:p.activeCredentialCount,
  credentialFileExists:p.credentialFileExists,fileMode:p.fileMode,
  fileOwner:p.fileOwner,credentialName:p.credentialName,
  scopes:p.scopes,configHttp:p.configHttp,secretsHttp:p.secretsHttp
 };
}
function approvalView(p){
 if(!p||typeof p!=='object')return {};
 return {
  ok:p.ok,requestId:p.requestId,action:p.action,operation:p.operation,
  level:p.level,confirmation:p.confirmation,sourceSha:p.sourceSha,
  consumedOnce:p.consumedOnce
 };
}
function createTrustedAdapter(host){
 assertTrustedHost(host);
 const scope=fixed();
 return Object.freeze({
  withExclusiveLock:async (action,run)=>{
   if(action!==CONTRACT.action||typeof run!=='function')fail('unexpected_enrollment_action');
   return host.withHonartikEnrollmentLock(scope,run);
  },
  readPreflight:async ()=>{
   return preflightView(await host.readHonartikEnrollmentPreflight(scope));
  },
  attestConsumedApproval:async ({requestId,action,operation,level,sourceSha})=>{
   if(action!==CONTRACT.action||operation!==CONTRACT.operation||
      level!==CONTRACT.approvalLevel||sourceSha!==CONTRACT.scriptGitSha)
      fail('approval_binding_drift');
   return approvalView(await host.attestHonartikApprovalAlreadyConsumed(
    Object.freeze({requestId,action,operation,level,sourceSha}),scope));
  },
  runFixedEnrollment:async ()=>{
   const response=await host.issueHonartikReadonlyCredential(scope);
   return response==='issued'?'issued':'refused';
  },
  runFixedRollback:async ()=>{
   const response=await host.revokeHonartikReadonlyCredential(scope);
   return response==='revoked'?'revoked':'refused';
  },
  readPostcondition:async ()=>{
   return postconditionView(await host.readHonartikCredentialPostcondition(scope));
  },
  runFixedConsumerCheck:async ()=>{
   const res=await host.runHonartikReadonlyYiiDiagnostic(scope);
   return {exitCode:res?.exitCode,output:res?.output};
  },
  writeAudit:async record=>{
   if(!record||typeof record!=='object'||
     Object.keys(record).some(k=>!ALLOWED_AUDIT.includes(k)))fail('audit_fields_invalid');
   const clean=Object.freeze({
    action:record.action,site:record.site,sourceSha:record.sourceSha,
    result:record.result,rollback:record.rollback
   });
   if(clean.action!==CONTRACT.action||clean.site!==CONTRACT.site||
      clean.sourceSha!==CONTRACT.scriptGitSha||
      !['success','failure'].includes(clean.result)||
      !['not_needed','verified','unverified'].includes(clean.rollback))
     fail('audit_contract_drift');
   return host.appendHonartikEnrollmentAudit(clean,scope);
  }
 });
}
function createTrustedRunner(host){
 // Trusted bootstrap supplies host only AFTER its signed, single-use
 // approval boundary has been enforced. Never construct from user input.
 return createAction(createTrustedAdapter(host));
}
module.exports=Object.freeze({METHODS,createTrustedAdapter,createTrustedRunner,
 preflightView,postconditionView,approvalView});
