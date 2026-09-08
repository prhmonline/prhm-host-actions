'use strict';
const crypto=require('node:crypto');
const path=require('node:path');
const fs=require('node:fs');
const cp=require('node:child_process');

const POLICY_PATH='/opt/prhm-company-control-plane/config/approval-policy.json';
const MEDIATOR_PATH='/opt/prhm-company-control-plane/root-scripts-stage-mediator-v1/control-plane-root-scripts-stage-mediator-v1.js';
const POLICY_SHA256='494e95e3173695407c84b6d082f09e57d971cb193518be813a53131cdb389a70';
const MEDIATOR_SHA256='e8fc3f5185f01efeca5563490461566f64fc8bda1534bad5a3c39e73a7108abb';
const OLD_OPERATION='host_action.control_plane_root_scripts_stage_transport_v1';
const NEW_OPERATION='host_action.control_plane_installer_refresh_root_stage_v1';
const BACKUP_ROOT='/var/backups/prhm-installer-refresh-l4-binding-repair-v1';
const SERVICES=Object.freeze(['prhm-company-approval.service','prhm-root-scripts-stage-mediator-v1.service']);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function count(s,n){return s.split(n).length-1}
function buildCandidates(policySource,mediatorSource){
 if(typeof policySource!=='string'||typeof mediatorSource!=='string')fail('binding_repair_input_invalid');
 let policy;try{policy=JSON.parse(policySource)}catch{fail('binding_repair_policy_json_invalid')}
 if(!policy||typeof policy!=='object'||Array.isArray(policy)||!policy.operations||typeof policy.operations!=='object'||!Array.isArray(policy.typed_scopes))fail('binding_repair_policy_shape_invalid');
 const old=policy.operations[OLD_OPERATION];
 if(!old||Number(old.level)!==3)fail('binding_repair_generic_l3_drift');
 if(old.risk!==undefined&&String(old.risk)!=='high')fail('binding_repair_generic_l3_risk_drift');
 if(policy.operations[NEW_OPERATION]||policy.typed_scopes.some(x=>x&&x.operation===NEW_OPERATION))fail('binding_repair_already_present');
 policy.operations[NEW_OPERATION]={level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:'2026-09-08.1-installer-refresh-root-stage-v1',rollback_reference:'control-plane:installer-refresh-root-stage-v1:policy-mediator-restore'};
 policy.typed_scopes.push({tool:'control_plane_root_scripts_stage_transport_apply_v1',project:'control_plane',environment:'production',action:'control_plane_root_scripts_stage_transport_v1',risk:'critical',operation:NEW_OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
 const anchor="  operation:'"+OLD_OPERATION+"'";
 if(count(mediatorSource,anchor)!==1)fail('binding_repair_mediator_anchor_mismatch');
 const mediator=mediatorSource.replace(anchor,"  operation:'"+NEW_OPERATION+"'");
 if(/risk:'high'|CONFIRM_LEVEL_3_PRODUCTION|Number\(request\.level\)!==3|level:3,expires_at|level3_confirmation_required/.test(mediator))fail('binding_repair_mediator_downgrade_present');
 return Object.freeze({ok:true,policy:JSON.stringify(policy,null,2)+'\n',mediator,production_mutation:false,database_mutation:false});
}
function buildInstallerSource(){return `'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const ACTION='control_plane_installer_refresh_l4_binding_repair_v1';
const POLICY=${JSON.stringify(POLICY_PATH)},MEDIATOR=${JSON.stringify(MEDIATOR_PATH)};
const BASELINE=Object.freeze({policy:${JSON.stringify(POLICY_SHA256)},mediator:${JSON.stringify(MEDIATOR_SHA256)}});
const BACKUP_ROOT=${JSON.stringify(BACKUP_ROOT)};
const SERVICES=${JSON.stringify(SERVICES)};
const OLD_OPERATION=${JSON.stringify(OLD_OPERATION)},NEW_OPERATION=${JSON.stringify(NEW_OPERATION)};
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(m){throw new Error(m)}
function regular(file,label){const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||fs.realpathSync(file)!==file)fail(label+'_not_regular');return st}
function run(bin,args,t=60000){const r=cp.spawnSync(bin,args,{encoding:'utf8',timeout:t,maxBuffer:500000});if(r.error||r.status!==0)fail('command_failed:'+String(args&&args[0]||bin));return String(r.stdout||'').trim()}
function atomic(file,bytes,st,suffix){const tmp=file+'.'+suffix+'-'+process.pid+'-'+Date.now()+'.tmp';fs.writeFileSync(tmp,bytes,{mode:st.mode&0o777,flag:'wx'});fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode&0o777);fs.renameSync(tmp,file)}
function candidate(policySource,mediatorSource){let p;try{p=JSON.parse(policySource)}catch{fail('policy_json_invalid')}if(!p.operations||!Array.isArray(p.typed_scopes))fail('policy_shape_invalid');const old=p.operations[OLD_OPERATION];if(!old||Number(old.level)!==3||(old.risk!==undefined&&String(old.risk)!=='high')||p.operations[NEW_OPERATION]||p.typed_scopes.some(x=>x&&x.operation===NEW_OPERATION))fail('policy_binding_precondition_failed');p.operations[NEW_OPERATION]={level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:180,policy_version:'2026-09-08.1-installer-refresh-root-stage-v1',rollback_reference:'control-plane:installer-refresh-root-stage-v1:policy-mediator-restore'};p.typed_scopes.push({tool:'control_plane_root_scripts_stage_transport_apply_v1',project:'control_plane',environment:'production',action:'control_plane_root_scripts_stage_transport_v1',risk:'critical',operation:NEW_OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});const a="  operation:'"+OLD_OPERATION+"'";if(mediatorSource.split(a).length-1!==1)fail('mediator_anchor_mismatch');const mediator=mediatorSource.replace(a,"  operation:'"+NEW_OPERATION+"'");if(/risk:'high'|CONFIRM_LEVEL_3_PRODUCTION|Number\\(request\\.level\\)!==3|level:3,expires_at|level3_confirmation_required/.test(mediator))fail('mediator_downgrade_present');return {policy:JSON.stringify(p,null,2)+'\\n',mediator}}
function restartVerify(){for(const s of SERVICES)run('/usr/bin/systemctl',['restart',s]);for(const s of SERVICES)if(run('/usr/bin/systemctl',['is-active',s])!=='active')fail('service_not_active:'+s)}
function main(){if(process.argv.length!==2)fail('unexpected_arguments');if(process.getuid&&process.getuid()!==0)fail('root_required');const ps=regular(POLICY,'policy'),ms=regular(MEDIATOR,'mediator'),pb=fs.readFileSync(POLICY),mb=fs.readFileSync(MEDIATOR);if(H(pb)!==BASELINE.policy)fail('policy_preimage_sha_mismatch');if(H(mb)!==BASELINE.mediator)fail('mediator_preimage_sha_mismatch');const next=candidate(pb.toString('utf8'),mb.toString('utf8')),np=Buffer.from(next.policy),nm=Buffer.from(next.mediator);JSON.parse(np.toString('utf8'));const ck=cp.spawnSync('/usr/local/bin/prhm-node',['--check','-'],{input:nm,encoding:null,timeout:30000,maxBuffer:500000});if(ck.error||ck.status!==0)fail('mediator_candidate_syntax_invalid');const C={policy:H(np),mediator:H(nm)};const dir=path.join(BACKUP_ROOT,new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+process.pid);fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,'approval-policy.json.bak'),pb,{mode:0o600,flag:'wx'});fs.writeFileSync(path.join(dir,'mediator.js.bak'),mb,{mode:0o600,flag:'wx'});let wp=false,wm=false;try{atomic(POLICY,np,ps,'repair');wp=true;atomic(MEDIATOR,nm,ms,'repair');wm=true;if(H(fs.readFileSync(POLICY))!==C.policy||H(fs.readFileSync(MEDIATOR))!==C.mediator)fail('postwrite_sha_mismatch');restartVerify();const p=JSON.parse(fs.readFileSync(POLICY,'utf8'));const scopes=p.typed_scopes.filter(x=>x&&x.operation===NEW_OPERATION);if(Number(p.operations[OLD_OPERATION]?.level)!==3||Number(p.operations[NEW_OPERATION]?.level)!==4||p.operations[NEW_OPERATION]?.risk!=='critical'||scopes.length!==1||scopes[0].risk!=='critical')fail('postwrite_policy_contract_invalid');if(!fs.readFileSync(MEDIATOR,'utf8').includes("operation:'"+NEW_OPERATION+"'"))fail('postwrite_mediator_contract_invalid');console.log(JSON.stringify({ok:true,schema_version:'prhm.host-action-result.v1',action:ACTION,old_sha256:BASELINE,new_sha256:C,backup_dir:dir,services:SERVICES,production_mutation:true,database_mutation:false,rollback_performed:false}));}catch(error){let rb=null;try{if(wm)atomic(MEDIATOR,mb,ms,'rollback');if(wp)atomic(POLICY,pb,ps,'rollback');if(H(fs.readFileSync(POLICY))!==BASELINE.policy||H(fs.readFileSync(MEDIATOR))!==BASELINE.mediator)fail('rollback_sha_mismatch');restartVerify()}catch(e){rb=String(e&&e.message||e)}if(rb)fail('repair_failed_rollback_failed:'+String(error&&error.message||error)+':'+rb);fail('repair_failed_rolled_back:'+String(error&&error.message||error))}}
try{main()}catch(error){console.error(JSON.stringify({ok:false,action:ACTION,error:String(error&&error.message||error)}));process.exit(1)}
`;}
const INSTALLER_SOURCE_SHA256=sha(Buffer.from(buildInstallerSource(),'utf8'));
module.exports=Object.freeze({POLICY_PATH,MEDIATOR_PATH,POLICY_SHA256,MEDIATOR_SHA256,OLD_OPERATION,NEW_OPERATION,BACKUP_ROOT,SERVICES,buildCandidates,buildInstallerSource,INSTALLER_SOURCE_SHA256});
