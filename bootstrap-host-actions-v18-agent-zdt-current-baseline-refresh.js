'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const ACTION='control_plane_typed_bootstrap_current_baseline_refresh_v1';
const PROMOTION_ACTION=ACTION;
const PROMOTION_OPERATION='host_action.control_plane_typed_bootstrap_current_baseline_refresh_v1';
const PROMOTION_SOURCE_SHA256='d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e';
const PROMOTION_CANDIDATE_SHA256='0adb6e91b006458da56566c2cdb2a903f945357b5bcf286cef7e5ce9cfcf1535';

const OLD_BASELINE=Object.freeze({
  base:'c38bb88c5d7000eebedc5db758c7dd7d846b7b1a6df589c10f37237c3d1cce00',
  executor:'edaf10ace464cb70ea1625cb7998b2bae0112b46b1d4f383334ceeaf5b6a5108',
  policy:'162bfa045d9b600a48989dd88e4b367beff1272cbb9b83e1dbc5cf6bc8d6adad',
  mcp:'c7be9c315319c893ee821268507577f10cb001440899f670659b2c3c7b26b722',
  zdt:'04a1416e837b1ae47e0a0ae72b5c1547d03118022c6c9ff19f392572ff7d38b4',
});
const CURRENT_BASELINE=Object.freeze({
  base:'747c83ecf095fa381acb9ba9f12737b3530dcb3d2b68a64ee2a4354cf9c36a29',
  executor:'d8db336881f80589b2ca30e953f8a7a3992d205dd79057ffc2fb0acd11d74c86',
  policy:'5b1e96a23d66ccb2017b0bb07c6cf19b8bc74fd34bcc9425ee737cfbecba2bc1',
  mcp:'1a06d026d04db622bd24f4b3d2df9211c8668d3e61e920f35cc7282a6662d588',
  zdt:'966d91c5af901f2f96e782c1f83915a49b9831f9b226000944a65e25b56e009b',
});
const STAGE_ARTIFACTS=Object.freeze({
  transport:Object.freeze({
    path:'/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/control-plane-typed-bootstrap-transport-v1.js',
    sha256:'049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335'
  }),
  bootstrap:Object.freeze({
    path:'/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js',
    sha256:PROMOTION_SOURCE_SHA256
  })
});

const REGISTRATION_OWNER_PATHS=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  exec:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
});
const REGISTRATION_BASELINE_SHA256=Object.freeze({
  base:'a23b4fec52123f8ad484f31576281c2f1933f24a3c811cd98c28e764a292e315',
  exec:'451c5a4762a4c7a04d64d526a79cf6e86b0cf7c978c559cf303d874e0f08fc48',
  policy:'494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70',
  mcp:'7c566cdb1dbc1dcb4ac9d6a1b0670acc98cbc366a663771937e365d700671510',
});
const REGISTRATION_CANDIDATE_SHA256=Object.freeze({
  base:'aa6f3ed4f682dd4f50f56483edad435fc05454310449a21e9bc7a412b57efb60',
  exec:'0e5698778545923500750240be0f38bee1b819a4e05e9fcef1e9ceb4808bb2a6',
  policy:'fcaee257f33cfaf5035eb97ada018af3f9115df9ac7afbd5ba55ce5961913574',
  mcp:'9fa041e09a02370ca803e32a7465b471d5a7ce86415a3ed49a457ffe4611a2f0',
});
const REGISTRATION_STAGE_TRANSPORT_ACTION='control_plane_current_baseline_refresh_registration_installer_stage_v1';
const REGISTRATION_INSTALLER_DESTINATION='/opt/prhm-agent-selfmaint-exec/actions/current-baseline-refresh-registration-installer-v1.js';
const MEDIATOR_TARGET='/opt/prhm-company-control-plane/root-scripts-stage-mediator-v1/control-plane-root-scripts-stage-mediator-v1.js';
const MEDIATOR_BASELINE_SHA256='e8fc3f5185f01efeca5563490461566f64fc8bda1534bad5a3c39e73a7108abb';

function fail(code){throw new Error(code)}
function sha256(v){return crypto.createHash('sha256').update(v).digest('hex')}
function countOccurrences(source,needle){let n=0,p=0;for(;;){const i=source.indexOf(needle,p);if(i<0)return n;n++;p=i+needle.length}}
function replaceOnce(source,oldValue,newValue,label){
  const n=countOccurrences(source,oldValue);
  if(n!==1)fail(`registration_anchor_${label}_${n}`);
  return source.replace(oldValue,newValue);
}
function baselineAnchor(v){return 'const BASELINE=Object.freeze('+JSON.stringify(v)+');'}

function validateOne(actual,expected,label){
  if(!actual||typeof actual!=='object'||Array.isArray(actual))fail(`stage_${label}_evidence_invalid`);
  if(actual.path!==expected.path)fail(`stage_${label}_path_mismatch`);
  if(actual.sha256!==expected.sha256)fail(`stage_${label}_sha_mismatch`);
  if(actual.exists!==true)fail(`stage_${label}_missing`);
  if(actual.regular!==true)fail(`stage_${label}_not_regular`);
  if(actual.symlink!==false)fail(`stage_${label}_symlink_rejected`);
}
function validateStageEvidence(evidence){
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))fail('stage_evidence_invalid');
  validateOne(evidence.transport,STAGE_ARTIFACTS.transport,'transport');
  validateOne(evidence.bootstrap,STAGE_ARTIFACTS.bootstrap,'bootstrap');
  return true;
}
function buildCurrentBaselineCandidate(source){
  if(typeof source!=='string')fail('baseline_source_invalid');
  const oldA=baselineAnchor(OLD_BASELINE),newA=baselineAnchor(CURRENT_BASELINE);
  if(countOccurrences(source,oldA)!==1)fail('expected_old_baseline_missing_or_not_unique');
  if(countOccurrences(source,newA)!==0)fail('current_baseline_already_present');
  const content=source.replace(oldA,newA);
  if(countOccurrences(content,oldA)!==0||countOccurrences(content,newA)!==1)fail('current_baseline_postcondition_failed');
  return Object.freeze({ok:true,content,sha256:sha256(content),replacement_count:1,production_mutation:false});
}

function buildMediatorBindingCandidate(source){
  if(typeof source!=='string')fail('mediator_source_invalid');
  const replacements=[
    ["  risk:'critical',","  risk:'critical',",'risk'],
    ["export const CONFIRM_LITERAL='CONFIRM_LEVEL_4_CRITICAL';","export const CONFIRM_LITERAL='CONFIRM_LEVEL_4_CRITICAL';",'confirm_literal'],
    ["if(Number(request.level)!==4)throw new Error('request_binding_mismatch');","if(Number(request.level)!==4)throw new Error('request_binding_mismatch');",'request_level'],
    ["return {request_id:request.request_id,binding_metadata:{action:FIXED_BINDING.action,operation:FIXED_BINDING.operation,project:FIXED_BINDING.project,environment:FIXED_BINDING.environment,risk:FIXED_BINDING.risk,arguments_sha256:ARGUMENTS_SHA256,level:4,expires_at:request.expires_at??null}};","return {request_id:request.request_id,binding_metadata:{action:FIXED_BINDING.action,operation:FIXED_BINDING.operation,project:FIXED_BINDING.project,environment:FIXED_BINDING.environment,risk:FIXED_BINDING.risk,arguments_sha256:ARGUMENTS_SHA256,level:4,expires_at:request.expires_at??null}};",'metadata_level'],
    ["if(String(second_confirmation||'')!==CONFIRM_LITERAL)throw new Error('critical_second_confirmation_required');","if(String(second_confirmation||'')!==CONFIRM_LITERAL)throw new Error('critical_second_confirmation_required');",'confirm_error'],
  ];
  let content=source;
  for(const [oldValue,newValue,label] of replacements)content=replaceOnce(content,oldValue,newValue,'mediator_'+label);
  return Object.freeze({ok:true,target:MEDIATOR_TARGET,baseline_sha256:MEDIATOR_BASELINE_SHA256,content,sha256:sha256(Buffer.from(content,'utf8')),replacement_count:replacements.length,production_mutation:false});
}

function buildRegistrationCandidates(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='base,exec,mcp,policy')fail('registration_input_invalid');
  for(const name of ['base','exec','mcp','policy']){
    if(typeof input[name]!=='string')fail(`registration_${name}_invalid`);
    if(input[name].includes(PROMOTION_ACTION))fail(`registration_${name}_already_present`);
  }

  const baseOld="  control_plane_typed_bootstrap_transport_v1: { operation: 'host_action.control_plane_typed_bootstrap_transport_v1', rollback: 'host-action-v2:control-plane-typed-bootstrap-transport-v1:journal-restore' },";
  const baseNew=baseOld+"\n  "+PROMOTION_ACTION+": { operation: '"+PROMOTION_OPERATION+"', rollback: 'host-action-v2:"+PROMOTION_ACTION.replaceAll('_','-')+":staged-bootstrap-source-restore' },";
  const base=replaceOnce(input.base,baseOld,baseNew,'base_spec');

  const execSpecOld="  control_plane_typed_bootstrap_transport_v1:{operation:'host_action.control_plane_typed_bootstrap_transport_v1',kind:'control_plane_typed_bootstrap_transport_v1'},";
  const execSpecNew=execSpecOld+"\n  "+PROMOTION_ACTION+":{operation:'"+PROMOTION_OPERATION+"',kind:'"+PROMOTION_ACTION+"'},";
  let exec=replaceOnce(input.exec,execSpecOld,execSpecNew,'exec_spec');

  const execHelperAnchor='const applyHostActionV2Original=applyHostActionV2;';
  const fixedHandler=[
    "const CONTROL_PLANE_CURRENT_BASELINE_REFRESH_SOURCE='/var/lib/prhm-agent-selfmaint-exec/root-of-trust-stage-v1/bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js';",
    "const CONTROL_PLANE_CURRENT_BASELINE_REFRESH_SOURCE_SHA='"+PROMOTION_SOURCE_SHA256+"';",
    "const CONTROL_PLANE_CURRENT_BASELINE_REFRESH_CANDIDATE_SHA='"+PROMOTION_CANDIDATE_SHA256+"';",
    "const CONTROL_PLANE_CURRENT_BASELINE_REFRESH_BACKUP_ROOT='/var/backups/prhm-current-baseline-refresh-v1';",
    "const CONTROL_PLANE_CURRENT_BASELINE_OLD="+JSON.stringify(baselineAnchor(OLD_BASELINE))+";",
    "const CONTROL_PLANE_CURRENT_BASELINE_NEW="+JSON.stringify(baselineAnchor(CURRENT_BASELINE))+";",
    "function applyControlPlaneTypedBootstrapCurrentBaselineRefreshV1(){"+
      "const crypto=require('node:crypto');const path=require('node:path');const cp=require('node:child_process');"+
      "const target=CONTROL_PLANE_CURRENT_BASELINE_REFRESH_SOURCE;const st=fs.lstatSync(target);"+
      "if(st.isSymbolicLink()||!st.isFile())throw new Error('current_baseline_refresh_target_not_regular');"+
      "if(fs.realpathSync(target)!==target)throw new Error('current_baseline_refresh_realpath_mismatch');"+
      "const original=fs.readFileSync(target);const sourceSha=crypto.createHash('sha256').update(original).digest('hex');"+
      "if(sourceSha!==CONTROL_PLANE_CURRENT_BASELINE_REFRESH_SOURCE_SHA)throw new Error('current_baseline_refresh_source_sha_mismatch');"+
      "const source=original.toString('utf8');const baselinePrefix='const BASELINE=Object.freeze(';const count=(s,n)=>s.split(n).length-1;"+
      "if(count(source,baselinePrefix)!==1)throw new Error('current_baseline_refresh_baseline_anchor_not_unique');"+
      "if(count(source,CONTROL_PLANE_CURRENT_BASELINE_OLD)!==1)throw new Error('current_baseline_refresh_old_anchor_mismatch');"+
      "if(count(source,CONTROL_PLANE_CURRENT_BASELINE_NEW)!==0)throw new Error('current_baseline_refresh_new_anchor_already_present');"+
      "const candidate=source.replace(CONTROL_PLANE_CURRENT_BASELINE_OLD,CONTROL_PLANE_CURRENT_BASELINE_NEW);"+
      "if(count(candidate,CONTROL_PLANE_CURRENT_BASELINE_OLD)!==0)throw new Error('current_baseline_refresh_old_anchor_remaining');"+
      "if(count(candidate,CONTROL_PLANE_CURRENT_BASELINE_NEW)!==1)throw new Error('current_baseline_refresh_new_anchor_postcondition');"+
      "const candidateBytes=Buffer.from(candidate,'utf8');const candidateSha=crypto.createHash('sha256').update(candidateBytes).digest('hex');"+
      "if(candidateSha!==CONTROL_PLANE_CURRENT_BASELINE_REFRESH_CANDIDATE_SHA)throw new Error('current_baseline_refresh_candidate_sha_mismatch');"+
      "fs.mkdirSync(CONTROL_PLANE_CURRENT_BASELINE_REFRESH_BACKUP_ROOT,{recursive:true,mode:0o700});"+
      "const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);const backup=path.join(CONTROL_PLANE_CURRENT_BASELINE_REFRESH_BACKUP_ROOT,'current_baseline_refresh_backup-'+stamp+'-'+process.pid+'.js');"+
      "fs.writeFileSync(backup,original,{mode:0o600,flag:'wx'});const dir=path.dirname(target);const tmp=path.join(dir,'.'+path.basename(target)+'.current-baseline-'+process.pid+'-'+Date.now()+'.tmp');let wrote=false;"+
      "try{fs.writeFileSync(tmp,candidateBytes,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode&0o777);"+
      "const syntax=cp.spawnSync('/usr/local/bin/prhm-node',['--check',tmp],{encoding:'utf8',timeout:30000,maxBuffer:300000});if(syntax.error||syntax.status!==0)throw new Error('current_baseline_refresh_candidate_syntax_invalid');"+
      "fs.renameSync(tmp,target);wrote=true;const finalSha=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');if(finalSha!==CONTROL_PLANE_CURRENT_BASELINE_REFRESH_CANDIDATE_SHA)throw new Error('current_baseline_refresh_postwrite_sha_mismatch');"+
      "return {ok:true,schema_version:'prhm.host-action-result.v1',action:'"+PROMOTION_ACTION+"',source_sha256:sourceSha,candidate_sha256:candidateSha,backup_path:backup,production_mutation:true,database_mutation:false,rollback_performed:false};"+
      "}catch(error){try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{}if(wrote){let rollbackError=null;try{const rb=path.join(dir,'.'+path.basename(target)+'.rollback-'+process.pid+'-'+Date.now()+'.tmp');"+
      "fs.writeFileSync(rb,original,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(rb,st.uid,st.gid);fs.chmodSync(rb,st.mode&0o777);fs.renameSync(rb,target);"+
      "const rollbackSha=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');if(rollbackSha!==CONTROL_PLANE_CURRENT_BASELINE_REFRESH_SOURCE_SHA)throw new Error('current_baseline_refresh_rollback_sha_mismatch')}catch(e){rollbackError=String(e&&e.message||e)}"+
      "if(rollbackError)throw new Error('current_baseline_refresh_apply_failed_rollback_failed:'+String(error&&error.message||error)+':'+rollbackError);throw new Error('current_baseline_refresh_apply_failed_rolled_back:'+String(error&&error.message||error))}throw error}}"
  ].join('\n');
  exec=replaceOnce(exec,execHelperAnchor,fixedHandler+'\n'+execHelperAnchor,'exec_helper');

  const dispatchOld="if(action==='control_plane_typed_bootstrap_transport_v1')return applyControlPlaneTypedBootstrapTransportV1();";
  const dispatchNew="if(action==='"+PROMOTION_ACTION+"')return applyControlPlaneTypedBootstrapCurrentBaselineRefreshV1();"+dispatchOld;
  exec=replaceOnce(exec,dispatchOld,dispatchNew,'exec_dispatch');

  let policy;
  try{policy=JSON.parse(input.policy)}catch{fail('registration_policy_json_invalid')}
  if(!policy||typeof policy!=='object'||Array.isArray(policy)||!policy.operations||typeof policy.operations!=='object'||!Array.isArray(policy.typed_scopes))fail('registration_policy_shape_invalid');
  if(policy.operations[PROMOTION_OPERATION]||policy.typed_scopes.some(x=>x&&x.action===PROMOTION_ACTION))fail('registration_policy_already_present');
  policy.operations[PROMOTION_OPERATION]={
    level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,
    requested_approver:'mohammad',expires_seconds:180,
    policy_version:'2026-09-06.1-control-plane-current-baseline-refresh-v1',
    rollback_reference:'host-action-v2:control-plane-current-baseline-refresh-v1:staged-bootstrap-source-restore'
  };
  policy.typed_scopes.push({
    tool:'host_action_v2_apply',project:'control_plane',environment:'production',
    action:PROMOTION_ACTION,risk:'critical',operation:PROMOTION_OPERATION,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  });
  const policyText=JSON.stringify(policy,null,2)+'\n';

  const mcpOld="'control_plane_typed_bootstrap_transport_v1',";
  const mcpNew=mcpOld+"\n'"+PROMOTION_ACTION+"',";
  const mcp=replaceOnce(input.mcp,mcpOld,mcpNew,'mcp_enum');

  return Object.freeze({ok:true,action:PROMOTION_ACTION,source_sha256:PROMOTION_SOURCE_SHA256,candidate_sha256:PROMOTION_CANDIDATE_SHA256,files:Object.freeze({base,exec,policy:policyText,mcp}),production_mutation:false});
}

function loadRegistrationCandidates(){
  const live={};
  for(const [name,file] of Object.entries(REGISTRATION_OWNER_PATHS)){
    const st=fs.lstatSync(file);
    if(st.isSymbolicLink()||!st.isFile())fail(`registration_installer_owner_not_regular:${name}`);
    if(fs.realpathSync(file)!==file)fail(`registration_installer_owner_realpath_mismatch:${name}`);
    const bytes=fs.readFileSync(file),actual=sha256(bytes);
    if(actual!==REGISTRATION_BASELINE_SHA256[name])fail(`registration_installer_baseline_drift:${name}:${actual}`);
    live[name]=bytes.toString('utf8');
  }
  const built=buildRegistrationCandidates(live);
  const b64={};
  for(const name of ['base','exec','policy','mcp']){
    const actual=sha256(Buffer.from(built.files[name],'utf8'));
    if(actual!==REGISTRATION_CANDIDATE_SHA256[name])fail(`registration_installer_candidate_sha_mismatch:${name}:${actual}`);
    b64[name]=Buffer.from(built.files[name],'utf8').toString('base64');
  }
  return b64;
}

function buildRegistrationInstallerSource(){
  const b64=loadRegistrationCandidates();
  return `'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const ACTION='control_plane_current_baseline_refresh_registration_installer_v1';
const TARGET='${PROMOTION_ACTION}';
const RESULT='/var/lib/prhm-agent-selfmaint-exec/current-baseline-refresh-registration-v1/latest.json';
const BACKUP_ROOT='/var/backups/prhm-current-baseline-refresh-registration-v1';
const FILES=${JSON.stringify(REGISTRATION_OWNER_PATHS)};
const BASELINE=${JSON.stringify(REGISTRATION_BASELINE_SHA256)};
const CANDIDATE=${JSON.stringify(REGISTRATION_CANDIDATE_SHA256)};
const CANDIDATE_B64=${JSON.stringify(b64)};
const SERVICES=['prhm-company-approval.service','prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service','prhm-agent-mcp.service'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const shaf=f=>sha(fs.readFileSync(f));
function run(bin,args,t=120000){return cp.execFileSync(bin,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:t}).trim()}
function atomic(file,buf,mode,uid,gid,s){const tmp=file+'.'+s+'-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(tmp,buf,{mode,flag:'wx'});fs.chownSync(tmp,uid,gid);fs.chmodSync(tmp,mode);fs.renameSync(tmp,file)}
function restart(){for(const s of SERVICES)run('/usr/bin/systemctl',['restart',s],60000);for(const s of SERVICES)if(run('/usr/bin/systemctl',['is-active',s],20000)!=='active')throw new Error('service_not_active:'+s)}
function main(){
 if(process.argv.length!==2)throw new Error('unexpected_arguments');
 if(process.getuid&&process.getuid()!==0)throw new Error('root_required');
 const old={},stat={},next={};
 for(const n of Object.keys(FILES)){const f=FILES[n],st=fs.lstatSync(f);if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(f)!==f)throw new Error('owner_not_regular:'+n);const a=shaf(f);if(a!==BASELINE[n])throw new Error('baseline_drift:'+n);old[n]=fs.readFileSync(f);stat[n]=fs.statSync(f);next[n]=Buffer.from(CANDIDATE_B64[n],'base64');if(sha(next[n])!==CANDIDATE[n])throw new Error('candidate_sha_mismatch:'+n)}
 const backupDir=path.join(BACKUP_ROOT,new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(backupDir,{recursive:true,mode:0o700});for(const n of Object.keys(FILES))fs.writeFileSync(path.join(backupDir,n+'.bak'),old[n],{mode:0o600,flag:'wx'});
 const tmp={},mutated=[];
 try{
  for(const n of Object.keys(FILES)){tmp[n]=FILES[n]+'.candidate-'+process.pid+'-'+n;fs.writeFileSync(tmp[n],next[n],{mode:stat[n].mode&0o777,flag:'wx'});fs.chownSync(tmp[n],stat[n].uid,stat[n].gid)}
  for(const n of ['base','exec','mcp']){const c=cp.spawnSync('/usr/local/bin/prhm-node',['--check',tmp[n]],{encoding:'utf8',timeout:30000,maxBuffer:1000000});if(c.error||c.status!==0)throw new Error('syntax:'+n)}
  JSON.parse(fs.readFileSync(tmp.policy,'utf8'));
  for(const n of ['base','exec','policy','mcp']){fs.renameSync(tmp[n],FILES[n]);mutated.push(n);if(shaf(FILES[n])!==CANDIDATE[n])throw new Error('post_rename_sha_mismatch:'+n)}
  restart();for(const n of Object.keys(FILES))if(shaf(FILES[n])!==CANDIDATE[n])throw new Error('post_install_sha_mismatch:'+n);
  const result={ok:true,schema_version:'prhm.host-action-result.v1',action:ACTION,target_action:TARGET,installed:true,production_mutation:true,database_mutation:false,rollback_performed:false,backup_dir:backupDir,post_install_sha256:Object.fromEntries(Object.keys(FILES).map(n=>[n,shaf(FILES[n])]))};
  fs.mkdirSync(path.dirname(RESULT),{recursive:true,mode:0o700});fs.writeFileSync(RESULT,JSON.stringify(result,null,2)+'\\n',{mode:0o600});console.log(JSON.stringify(result));
 }catch(error){
  let rb=null;for(const n of mutated.reverse())try{atomic(FILES[n],old[n],stat[n].mode&0o777,stat[n].uid,stat[n].gid,'rollback');if(shaf(FILES[n])!==BASELINE[n])throw new Error('rollback_sha_mismatch:'+n)}catch(e){rb=rb||String(e&&e.message||e)}
  try{restart()}catch(e){rb=rb||String(e&&e.message||e)}
  if(rb)throw new Error('install_failed_and_rollback_failed:'+String(error&&error.message||error)+':'+rb);
  throw new Error('install_failed_rolled_back:'+String(error&&error.message||error));
 }finally{for(const f of Object.values(tmp))try{if(f&&fs.existsSync(f))fs.unlinkSync(f)}catch{}}
}}
try{main()}catch(error){console.error(String(error&&error.stack||error));process.exit(1)}
`;
}

function registrationInstallerArtifact(){
  const source=buildRegistrationInstallerSource();
  return Object.freeze({source,sha256:sha256(Buffer.from(source,'utf8'))});
}
function getRegistrationInstallerSourceSha256(){return registrationInstallerArtifact().sha256}

function buildRegistrationStageTransportSource(){
  const artifact=registrationInstallerArtifact();
  const installerB64=Buffer.from(artifact.source,'utf8').toString('base64');
  return `'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const ACTION='${REGISTRATION_STAGE_TRANSPORT_ACTION}';
const DESTINATION='${REGISTRATION_INSTALLER_DESTINATION}';
const INSTALLER_SHA='${artifact.sha256}';
const INSTALLER_B64='${installerB64}';
const BACKUP_ROOT='/var/backups/prhm-current-baseline-refresh-registration-installer-stage-v1';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(c){throw new Error(c)}
function regular(f,l){const st=fs.lstatSync(f);if(st.isSymbolicLink()||!st.isFile())fail(l+'_not_regular');if(fs.realpathSync(f)!==f)fail(l+'_realpath_mismatch');return st}
function bytes(){const b=Buffer.from(INSTALLER_B64,'base64');if(digest(b)!==INSTALLER_SHA)fail('source_sha_mismatch');const c=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:b,encoding:null,timeout:30000,maxBuffer:1000000});if(c.error||c.status!==0)fail('candidate_sha_mismatch:installer_syntax_invalid');return b}
function preflight(){const b=bytes();let old=null;if(fs.existsSync(DESTINATION)){regular(DESTINATION,'destination');old=digest(fs.readFileSync(DESTINATION))}return {ok:true,schema_version:'prhm.registration-installer-stage-preflight.v1',action:ACTION,preflight_only:true,candidate_sha256:digest(b),destination:DESTINATION,destination_sha256:old,arbitrary_path:false,arbitrary_command:false,external_network:false,production_owner_mutation:false,database_mutation:false,production_mutation:false}}
function apply(){if(process.getuid&&process.getuid()!==0)fail('root_required');const b=bytes(),before=fs.existsSync(DESTINATION)?{exists:true,st:regular(DESTINATION,'destination'),bytes:fs.readFileSync(DESTINATION)}:{exists:false};before.sha256=before.exists?digest(before.bytes):null;const pst=fs.statSync(path.dirname(DESTINATION)),mode=before.exists?(before.st.mode&0o777):0o700,uid=before.exists?before.st.uid:pst.uid,gid=before.exists?before.st.gid:pst.gid;const dir=path.join(BACKUP_ROOT,new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+process.pid);fs.mkdirSync(dir,{recursive:true,mode:0o700});const backup=before.exists?path.join(dir,'current-baseline-refresh-registration-installer-v1.js.bak'):null;if(backup)fs.writeFileSync(backup,before.bytes,{mode:0o600,flag:'wx'});const tmp=DESTINATION+'.stage-'+process.pid+'-'+Date.now()+'.tmp';let wrote=false;try{fs.writeFileSync(tmp,b,{mode,flag:'wx'});fs.chownSync(tmp,uid,gid);fs.chmodSync(tmp,mode);fs.renameSync(tmp,DESTINATION);wrote=true;regular(DESTINATION,'destination_postwrite');if(digest(fs.readFileSync(DESTINATION))!==INSTALLER_SHA)fail('postwrite_installer_sha_mismatch');return {ok:true,schema_version:'prhm.registration-installer-stage-result.v1',action:ACTION,status:'succeeded',destination:DESTINATION,old_sha256:before.sha256,new_sha256:INSTALLER_SHA,backup_path:backup,arbitrary_path:false,arbitrary_command:false,external_network:false,production_owner_mutation:false,database_mutation:false,production_mutation:true,rollback_performed:false}}catch(error){try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{}if(wrote){if(before.exists){const rb=DESTINATION+'.rollback-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(rb,before.bytes,{mode:before.st.mode&0o777,flag:'wx'});fs.chownSync(rb,before.st.uid,before.st.gid);fs.renameSync(rb,DESTINATION);if(digest(fs.readFileSync(DESTINATION))!==before.sha256)fail('rollback_sha_mismatch')}else if(fs.existsSync(DESTINATION))fs.unlinkSync(DESTINATION)}fail('stage_failed_rolled_back:'+String(error&&error.message||error))}}
function main(){const a=process.argv.slice(2);if(a.length!==1||!['--preflight-only','--apply'].includes(a[0]))fail('unexpected_arguments');process.stdout.write(JSON.stringify(a[0]==='--preflight-only'?preflight():apply())+'\\n')}
module.exports={ACTION,DESTINATION,INSTALLER_SHA,preflight,apply};
if(require.main===module){try{main()}catch(error){console.error(JSON.stringify({ok:false,action:ACTION,error:String(error&&error.message||error)}));process.exit(1)}}
`;
}

module.exports=Object.freeze({
  ACTION,PROMOTION_ACTION,PROMOTION_OPERATION,PROMOTION_SOURCE_SHA256,PROMOTION_CANDIDATE_SHA256,
  STAGE_ARTIFACTS,OLD_BASELINE,CURRENT_BASELINE,validateStageEvidence,buildCurrentBaselineCandidate,
  REGISTRATION_OWNER_PATHS,REGISTRATION_BASELINE_SHA256,REGISTRATION_CANDIDATE_SHA256,
  REGISTRATION_STAGE_TRANSPORT_ACTION,REGISTRATION_INSTALLER_DESTINATION,
  MEDIATOR_TARGET,MEDIATOR_BASELINE_SHA256,buildMediatorBindingCandidate,
  buildRegistrationCandidates,buildRegistrationInstallerSource,buildRegistrationStageTransportSource,
  get REGISTRATION_INSTALLER_SOURCE_SHA256(){return getRegistrationInstallerSourceSha256()}
});
