'use strict';
/**
 * Fixed privileged Honartik Config Center Host Action I/O.
 * ONLY the already-authorized Host Actions v2 executor may invoke
 * runAfterTrustedApproval(context) after one-time authorize-consume.
 * No CLI, server, user-supplied path, shell or external tool route.
 * Install from immutable Git bytes and pin this runner and every companion file
 * in the separate atomic, Level-4 authorized registry installer.
 */
const fs=require('node:fs');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const path=require('node:path');
const {CONTRACT}=require('./honartik-config-center-enrollment-action-v1.cjs');
const {createTrustedRunner}=require('./honartik-config-center-trusted-adapter-v1.cjs');
const ROOT='/opt/prhm-agent-selfmaint-exec/actions';
const RELEASE='/srv/prhm-config-center/releases/'+CONTRACT.configCenterRelease;
const CC_LINK='/srv/prhm-config-center/current';
const APP='/home/honartik/domains/dashboard.honartik.ir/public_html';
const SCRIPT=ROOT+'/honartik-config-center-prod-enroll-20261012.php';
const STATUS=ROOT+'/honartik-config-center-readonly-status-v1.php';
const LOCK='/run/prhm-honartik-config-center-enroll-v1.lock';
const AUDIT_DIR='/var/lib/prhm-agent-selfmaint-exec/honartik-config-center-enrollment-v1';
const AUDIT=AUDIT_DIR+'/audit.jsonl';
const PHP='/usr/bin/php',GIT='/usr/bin/git',RUNUSER='/usr/sbin/runuser';
const EXPECTED_PHP=Object.freeze({source:CONTRACT.scriptSha256,verifier:'83a7491e86b9304ca27fbdbf292944d07071a1880cd9beda84c87ad706379624'});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(code){throw new Error(code)}
function validateTrustedContext(context){
 if(!context||Object.keys(context).sort().join(',')!=='action,approvalConsumed,level,operation,requestId,scriptGitSha'||
   context.action!==CONTRACT.action||context.operation!==CONTRACT.operation||
   context.level!==4||context.approvalConsumed!==true||
   context.scriptGitSha!==CONTRACT.scriptGitSha||
   typeof context.requestId!=='string'||
   !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(context.requestId))
   fail('trusted_approval_context_invalid');
 return Object.freeze({...context});
}
function validateExec(executable,args,out,expected){
 if(out.error||out.status!==0||out.signal||out.stderr&&out.stderr.length>4096||
    typeof out.stdout!=='string'||out.stdout.length>4096)fail(expected+'_execution_failed');
 return out.stdout.trim();
}
function safeRun(bin,args,cwd,timeout=25000){
 const allow=(bin===PHP&&args.length===2&&
    ((args[0]===SCRIPT&&['preflight','apply','rollback'].includes(args[1]))||
     (args[0]===STATUS&&args[1]==='status')))||
  (bin===GIT&&cwd===APP&&
    (args.join(' ')==='rev-parse HEAD'||args.join(' ')==='status --porcelain --untracked-files=no'))||
  (bin===RUNUSER&&cwd===APP&&
    args.join(' ')==='-u honartik -- /usr/bin/php console/yii config-center/check');
 if(!allow)fail('command_not_in_fixed_allowlist');
 const out=cp.spawnSync(bin,args,{
  cwd,encoding:'utf8',timeout,maxBuffer:16384,
  env:{PATH:'/usr/bin:/usr/sbin:/bin',LANG:'C',HOME:bin===RUNUSER?'/home/honartik':'/root'},
  stdio:['ignore','pipe','pipe']});
 return validateExec(bin,args,out,'fixed');
}
function safeRootFile(file,expected){
 if(![SCRIPT,STATUS].includes(file))fail('unexpected_script');
 if(!/^[a-f0-9]{64}$/.test(expected))fail('script_pin_unset');
 if(fs.realpathSync(path.dirname(file))!==ROOT)fail('action_dir_symlink');
 const s=fs.lstatSync(file);
 if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)!==0||
   s.size<100||s.size>100000)fail('script_file_unsafe');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let bytes;
 try{
  const t=fs.fstatSync(fd);
  if(!t.isFile()||t.ino!==s.ino||t.dev!==s.dev||t.size!==s.size)fail('script_race');
  bytes=fs.readFileSync(fd);
  if(sha(bytes)!==expected)fail('script_sha256_mismatch');
 }finally{fs.closeSync(fd)}
 return true;
}
function attestedFiles(){
 safeRootFile(SCRIPT,EXPECTED_PHP.source);
 safeRootFile(STATUS,EXPECTED_PHP.verifier);
 if(fs.realpathSync(CC_LINK)!==RELEASE)fail('release_identity_mismatch');
 if(safeRun(GIT,['rev-parse','HEAD'],APP)!==CONTRACT.backendSha)fail('backend_sha_drift');
 // Untracked exports, e.g. business spreadsheets, are preserved; modified
 // tracked application code still blocks credential provisioning.
 if(safeRun(GIT,['status','--porcelain','--untracked-files=no'],APP)!=='')fail('backend_tracked_dirty');
 if(fs.existsSync(CONTRACT.credentialPath)||isSymlink(CONTRACT.credentialPath))fail('credential_already_present');
}
function isSymlink(file){
 try{return fs.lstatSync(file).isSymbolicLink()}catch(e){if(e.code==='ENOENT')return false;throw e}
}
function parseStatus(stdout){
 let parsed;try{parsed=JSON.parse(stdout)}catch{fail('status_json_invalid')}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail('status_schema_invalid');
 const fields=['site','revision','activeCredentialCount','credentialFileExists','fileMode','fileOwner',
  'credentialName','scopes','configHttp','secretsHttp'];
 if(Object.keys(parsed).sort().join(',')!==fields.sort().join(','))fail('status_schema_drift');
 if(parsed.site!=='honartik'||parsed.revision!==1||
   !Number.isInteger(parsed.activeCredentialCount)||
   parsed.activeCredentialCount<0||parsed.activeCredentialCount>1||
   typeof parsed.credentialFileExists!=='boolean'||!Array.isArray(parsed.scopes))
   fail('status_value_invalid');
 return parsed;
}
function metadataStatus(){
 safeRootFile(STATUS,EXPECTED_PHP.verifier);
 return parseStatus(safeRun(PHP,[STATUS,'status'],ROOT));
}
function assertScope(scope){
 if(!scope||scope.action!==CONTRACT.action||scope.site!=='honartik'||
  scope.scriptGitSha!==CONTRACT.scriptGitSha||
  scope.scriptSha256!==EXPECTED_PHP.source||scope.credentialPath!==CONTRACT.credentialPath)
  fail('scope_drift');
}
function createPrivilegedHost(context){
 const receipt=validateTrustedContext(context);
 if(process.getuid?.()!==0)fail('root_required');
 return Object.freeze({
  withHonartikEnrollmentLock:async(scope,callback)=>{
   assertScope(scope);
   if(typeof callback!=='function')fail('exclusive_callback_invalid');
   fs.mkdirSync(LOCK,{mode:0o700}); // atomic exclusive, refuses existing lock
   const st=fs.lstatSync(LOCK);
   try{
    if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o077)!==0)
     fail('lock_integrity');
    return await callback();
   }finally{
    const current=fs.lstatSync(LOCK);
    if(current.ino!==st.ino||current.dev!==st.dev)fail('lock_replaced');
    fs.rmdirSync(LOCK);
   }
  },
  readHonartikEnrollmentPreflight:async(scope)=>{
   assertScope(scope);
   attestedFiles();
   const pre=safeRun(PHP,[SCRIPT,'preflight'],ROOT);
   if(pre!=='PREFLIGHT_PASS=YES SITE=honartik REVISION=1 ACTIVE=0')
    fail('preflight_contract_failed');
   const state=metadataStatus();
   if(state.activeCredentialCount!==0||state.credentialFileExists!==false)
    fail('preflight_not_empty');
   return {site:'honartik',revision:1,backendSha:CONTRACT.backendSha,
    configCenterRelease:CONTRACT.configCenterRelease,scriptGitSha:CONTRACT.scriptGitSha,
    scriptSha256:CONTRACT.scriptSha256,activeCredentialCount:0,
    credentialFileExists:false,projectGitClean:true,scriptGitClean:true,
    consumerPresent:true,allowedScope:'config:read'};
  },
  attestHonartikApprovalAlreadyConsumed:async(binding,scope)=>{
   assertScope(scope);
   if(binding.requestId!==receipt.requestId||binding.action!==receipt.action||
     binding.operation!==receipt.operation||binding.level!==receipt.level||
     binding.sourceSha!==receipt.scriptGitSha)fail('approval_receipt_mismatch');
   // The caller is the fixed Host Actions executor AFTER the one-time
   // /authorize-consume transaction. No separate consumption or replay.
   return {ok:true,requestId:receipt.requestId,action:receipt.action,
    operation:receipt.operation,level:4,confirmation:'CONFIRM_LEVEL_4_CRITICAL',
    sourceSha:receipt.scriptGitSha,consumedOnce:receipt.approvalConsumed};
  },
  issueHonartikReadonlyCredential:async(scope)=>{
   assertScope(scope);safeRootFile(SCRIPT,EXPECTED_PHP.source);
   const result=safeRun(PHP,[SCRIPT,'apply'],ROOT,45000);
   if(result!=='CREDENTIAL_ISSUED=YES SITE=honartik SCOPES=config:read\nCONFIG_HTTP=200 SECRETS_HTTP=403 REVISION=1 FILE_SECURE=YES')
    fail('credential_issue_unverified');
   return 'issued';
  },
  revokeHonartikReadonlyCredential:async(scope)=>{
   assertScope(scope);safeRootFile(SCRIPT,EXPECTED_PHP.source);
   const result=safeRun(PHP,[SCRIPT,'rollback'],ROOT,45000);
   if(result!=='ROLLBACK_PASS=YES REVOKED=1')fail('rollback_contract_failed');
   return 'revoked';
  },
  readHonartikCredentialPostcondition:async(scope)=>{
   assertScope(scope);return metadataStatus();
  },
  runHonartikReadonlyYiiDiagnostic:async(scope)=>{
   assertScope(scope);
   const out=safeRun(RUNUSER,['-u','honartik','--','/usr/bin/php','console/yii','config-center/check'],APP);
   return {exitCode:0,output:out};
  },
  appendHonartikEnrollmentAudit:async(record,scope)=>{
   assertScope(scope);
   if(!['success','failure'].includes(record.result)||
     !['not_needed','verified','unverified'].includes(record.rollback)||
     record.action!==CONTRACT.action||record.sourceSha!==CONTRACT.scriptGitSha||
     record.site!=='honartik')fail('audit_record_drift');
   fs.mkdirSync(AUDIT_DIR,{recursive:true,mode:0o700});
   const dir=fs.lstatSync(AUDIT_DIR);
   if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==0||(dir.mode&0o077)!==0)fail('audit_dir_unsafe');
   const fd=fs.openSync(AUDIT,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW,0o600);
   try{
    const st=fs.fstatSync(fd);
    if(!st.isFile()||st.uid!==0||(st.mode&0o077)!==0)fail('audit_file_unsafe');
    fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),requestId:receipt.requestId,
      action:record.action,sourceSha:record.sourceSha,site:'honartik',
      result:record.result,rollback:record.rollback})+'\n');
    fs.fsyncSync(fd);
   }finally{fs.closeSync(fd)}
   return true;
  }
 });
}
async function runAfterTrustedApproval(context){
 const host=createPrivilegedHost(context);
 return createTrustedRunner(host).apply({requestId:context.requestId});
}
module.exports=Object.freeze({runAfterTrustedApproval,createPrivilegedHost,
 validateTrustedContext,parseStatus,metadataStatus,EXPECTED_PHP});
