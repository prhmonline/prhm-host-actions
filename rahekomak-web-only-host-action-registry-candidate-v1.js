'use strict';
// Read-only, exact-preimage registration candidate for the fixed RahKomak
// web-only host action. This module NEVER installs or applies an action.
const crypto=require('node:crypto');
const ACTION='rahekomak_web_only_release_v1';
const OPERATION='host_action.'+ACTION;
const SHA='c89241e415a093f9c07782ce156b51c7019368c5';
const HELPER_SHA='bf901961635986ff917bade164610ecc80cd3e9ebb549ef79ecc9efecce41320';
const POLICY_VERSION='2026-10-09.1-rahekomak-web-only-release-v1';
const POLICY_BASE='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';
const PINNED=Object.freeze({
 base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
 executor:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
 mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',
 policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'
});
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}
function fail(code){throw new Error(code)}
function replaceOne(s,needle,replacement,scope){
 if(typeof s!=='string'||s.split(needle).length!==2)fail(scope+'_anchor_not_unique');
 if(s.includes("'"+ACTION+"'")||s.includes(ACTION+":")||s.includes('"'+ACTION+'"'))fail(scope+'_already_registered');
 return s.replace(needle,replacement);
}
const BASE_ANCHOR="  rahekomak_production_deploy_v1: { operation: 'host_action.rahekomak_production_deploy_v1', rollback: 'host-action-v2:rahekomak-production-deploy-v1:helper-transaction-rollback' },";
const BASE_ADD="  "+ACTION+": { operation: '"+OPERATION+"', rollback: 'host-action-v2:rahekomak-web-only-release-v1:static-out-restore' },";
function patchBase(source){
 return replaceOne(source,BASE_ANCHOR,BASE_ANCHOR+'\n'+BASE_ADD,'base');
}
const EXEC_ANCHOR="  rahekomak_production_deploy_v1:{operation:'host_action.rahekomak_production_deploy_v1',kind:'rahekomak_production_deploy_v1'},";
const EXEC_ADD="  "+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'},";
const DISPATCH_ANCHOR="applyHostActionV2=async function(action){";
const EXEC_FUNCTION="\nconst RAHEKOMAK_WEB_ROOT='/home/prhm/projects/generated/rahekomak';\nconst RAHEKOMAK_WEB_SCRIPT=RAHEKOMAK_WEB_ROOT+'/infra/docker/web-only-release-v1.cjs';\nconst RAHEKOMAK_WEB_SHA='c89241e415a093f9c07782ce156b51c7019368c5';\nconst RAHEKOMAK_WEB_SCRIPT_SHA='bf901961635986ff917bade164610ecc80cd3e9ebb549ef79ecc9efecce41320';\nfunction applyRahKomakWebOnlyReleaseV1(){\n const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');\n const st=fs.lstatSync(RAHEKOMAK_WEB_SCRIPT);\n if(!st.isFile()||st.isSymbolicLink()||fs.realpathSync(RAHEKOMAK_WEB_SCRIPT)!==RAHEKOMAK_WEB_SCRIPT)throw new Error('web_only_helper_path_invalid');\n const found=crypto.createHash('sha256').update(fs.readFileSync(RAHEKOMAK_WEB_SCRIPT)).digest('hex');\n if(found!==RAHEKOMAK_WEB_SCRIPT_SHA)throw new Error('web_only_helper_sha_mismatch');\n const check=cp.spawnSync('/usr/bin/git',['-C',RAHEKOMAK_WEB_ROOT,'rev-parse','HEAD'],{encoding:'utf8',timeout:15000});\n if(check.error||check.status!==0||String(check.stdout||'').trim()!==RAHEKOMAK_WEB_SHA)throw new Error('web_only_commit_mismatch');\n const dirty=cp.spawnSync('/usr/bin/git',['-C',RAHEKOMAK_WEB_ROOT,'status','--porcelain'],{encoding:'utf8',timeout:15000});\n if(dirty.error||dirty.status!==0||String(dirty.stdout||'').trim())throw new Error('web_only_dirty_worktree');\n const unit='prhm-rahekomak-web-only-'+Date.now();\n const args=['--wait','--pipe','--collect','--quiet','--unit='+unit,\n '--property=Type=oneshot','--property=UMask=0077','--property=PrivateTmp=true',\n '--property=PrivateDevices=true','--property=ProtectSystem=strict',\n '--property=ProtectHome=read-only','--property=NoNewPrivileges=true',\n '--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',\n '--property=ReadWritePaths='+RAHEKOMAK_WEB_ROOT,\n '--setenv=RAHEKOMAK_RELEASE_SHA='+RAHEKOMAK_WEB_SHA,\n '--setenv=RAHEKOMAK_RELEASE_APPROVAL_SHA='+RAHEKOMAK_WEB_SHA,\n '--setenv=RAHEKOMAK_RELEASE_APPROVAL_MODE=approved_web_only',\n '--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/bin:/bin',\n '/usr/local/bin/prhm-node',RAHEKOMAK_WEB_SCRIPT,'--apply'];\n const out=cp.spawnSync('/usr/bin/systemd-run',args,{encoding:'utf8',timeout:1200000,maxBuffer:3000000,stdio:['ignore','pipe','pipe']});\n if(out.error||out.status!==0)throw new Error('web_only_host_action_failed:'+String(out.stderr||out.stdout||out.error).slice(-900));\n let result;\n try{result=JSON.parse(String(out.stdout||'').trim())}catch{throw new Error('web_only_host_action_result_not_json')}\n if(!result||result.ok!==true||result.action!=='rahekomak_web_only_release_v1'||result.sha!==RAHEKOMAK_WEB_SHA||\n result.status!=='deployed'||result.rollback!==false||result.database_changed!==false||\n result.admin_changed!==false||result.apache_changed!==false||result.health?.home!==200||\n result.health?.bundle!==200||result.health?.contacts!==5)throw new Error('web_only_host_action_result_contract_invalid');\n return result;\n}\n";

function patchExecutor(source){
 let out=replaceOne(source,EXEC_ANCHOR,EXEC_ANCHOR+'\n'+EXEC_ADD,'executor');
 if(out.split(DISPATCH_ANCHOR).length!==2)fail('executor_dispatch_anchor_not_unique');
 out=out.replace(DISPATCH_ANCHOR,EXEC_FUNCTION+'\n'+DISPATCH_ANCHOR+
  "if(action==='"+ACTION+"')return applyRahKomakWebOnlyReleaseV1();");
 return out;
}
function patchMcp(source){
 return replaceOne(source,"'rahekomak_production_deploy_v1',",
  "'rahekomak_production_deploy_v1','"+ACTION+"',",'mcp');
}
function patchPolicy(source){
 let policy;
 try{policy=JSON.parse(source)}catch{fail('policy_invalid_json')}
 if(policy.schema_version!=='prhm.approval-policy.v1'||policy.version!==POLICY_BASE||policy.default_deny!==true)fail('policy_schema_or_version_mismatch');
 if(!policy.operations||!Array.isArray(policy.typed_scopes)||policy.operations[OPERATION]||
 policy.typed_scopes.some(x=>x?.action===ACTION))fail('policy_invalid_or_duplicate');
 policy.version=POLICY_VERSION;
 policy.operations[OPERATION]={level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,
  requested_approver:'mohammad',expires_seconds:180,policy_version:POLICY_VERSION,
  rollback_reference:'host-action-v2:rahekomak-web-only-release-v1:static-out-restore'};
 policy.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',environment:'production',
  action:ACTION,risk:'critical',operation:OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
 return JSON.stringify(policy,null,2)+'\n';
}
function buildCandidates(preimages){
 const out={};
 for(const kind of ['base','executor','mcp','policy']){
  const original=preimages?.[kind];
  if(typeof original!=='string'||sha(Buffer.from(original))!==PINNED[kind])fail('preimage_sha_mismatch:'+kind);
  const builder={base:patchBase,executor:patchExecutor,mcp:patchMcp,policy:patchPolicy}[kind];
  out[kind]=builder(original);
 }
 return {schema_version:'prhm.rahekomak-web-only-registry-candidate.v1',
  action:ACTION,commit:SHA,helper_sha256:HELPER_SHA,mode:'candidate_only',
  preimage_sha256:PINNED,candidate_sha256:Object.fromEntries(Object.entries(out).map(([k,v])=>[k,sha(Buffer.from(v))])),
  candidates:out};
}
module.exports={ACTION,OPERATION,SHA,HELPER_SHA,PINNED,POLICY_VERSION,POLICY_BASE,
 patchBase,patchExecutor,patchMcp,patchPolicy,buildCandidates};
