'use strict';
const crypto=require('node:crypto');
const path=require('node:path');
const ACTION='control_plane_typed_bootstrap_transport_v1';
const OPERATION='host_action.control_plane_typed_bootstrap_transport_v1';
const REQUEST_FIELDS=Object.freeze([]);
const ALLOWLIST=Object.freeze(['/opt/prhm-deployhq-control/','/opt/prhm-agent-selfmaint-exec/actions/','/var/lib/prhm-agent-selfmaint-exec/','/etc/systemd/system/prhm-deployhq-control.service']);
const RECORD_KEYS=Object.freeze(['source_path','destination_path','sha256','mode','owner','group','replace_policy']);
const PACKAGE=Object.freeze({package_id:'deployhq_control_adapter_node1_recreate_v1',source_repo:'prhmonline/prhm-host-actions',source_commit:'cb180a622145062b07a314c43c2075d91446aa91',manifest_sha256:'aa3e87db8630b1fac0d8db1a6863a733563763bc39b8677f8af2a7e6088b7728',records:Object.freeze([{"source_path":"packages/deployhq-control-adapter-node1-recreate-v1/deployhq-control-adapter-v1.js","destination_path":"/opt/prhm-deployhq-control/server.js","sha256":"1ed4b4fd18ca68ec11dd7bb0b3283e94caa2e75cef3aa2f1abdac4475a397dc1","mode":"0750","owner":"root","group":"root","replace_policy":"sha_bound_replace"},{"source_path":"packages/deployhq-control-adapter-node1-recreate-v1/bootstrap-deployhq-control-adapter-v1.js","destination_path":"/opt/prhm-agent-selfmaint-exec/actions/bootstrap-deployhq-control-adapter-v1.js","sha256":"e620637c9384a82e5ee3eff9c925f3bdd757243976f06550a34ed71ed0fe90a3","mode":"0750","owner":"root","group":"root","replace_policy":"sha_bound_replace"},{"source_path":"packages/deployhq-control-adapter-node1-recreate-v1/deployhq-node1-canonical-recreate-v1.js","destination_path":"/opt/prhm-agent-selfmaint-exec/actions/deployhq-node1-canonical-recreate-v1.js","sha256":"91a301736937cb937265475e4cd2f6473353df0b7991e3805f165af452d17135","mode":"0750","owner":"root","group":"root","replace_policy":"sha_bound_replace"},{"source_path":"packages/deployhq-control-adapter-node1-recreate-v1/bootstrap-host-actions-deployhq-node1-recreate-v1.js","destination_path":"/opt/prhm-agent-selfmaint-exec/actions/bootstrap-host-actions-deployhq-node1-recreate-v1.js","sha256":"5f2a903e226c0cab1b5281e21ee1d5c436eca55d6dbb935f3f1bf109c44f89dd","mode":"0750","owner":"root","group":"root","replace_policy":"sha_bound_replace"},{"source_path":"packages/deployhq-control-adapter-node1-recreate-v1/prhm-deployhq-control.service","destination_path":"/etc/systemd/system/prhm-deployhq-control.service","sha256":"9398846d273e170ca0bda0aaace725a6ee8e0bc018282176dc47c838b452ff24","mode":"0644","owner":"root","group":"root","replace_policy":"sha_bound_replace"}].map(x=>Object.freeze(x)))});
function fail(code){throw new Error(code)}
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=stable(v[k]);return o}return v}
function canonicalManifestBytes(manifest){return Buffer.from(JSON.stringify(stable(manifest))+'\n','utf8')}
function manifestBody(manifest){return {package_id:manifest.package_id,source_repo:manifest.source_repo,source_commit:manifest.source_commit,records:manifest.records}}
function sha256(b){return crypto.createHash('sha256').update(b).digest('hex')}
function hasSecretKey(k){return /(secret|token|password|authorization|private[_-]?key|credential_value|api[_-]?key_value)/i.test(k)}
function validateManifest(manifest){
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))fail('manifest_invalid');
 const top=Object.keys(manifest).sort();const allowedTop=['package_id','records','source_commit','source_repo'];
 if(JSON.stringify(top)!==JSON.stringify(allowedTop))fail('manifest_top_level_fields_invalid');
 if(manifest.package_id!==PACKAGE.package_id||manifest.source_repo!==PACKAGE.source_repo||manifest.source_commit!==PACKAGE.source_commit)fail('package_identity_mismatch');
 if(!Array.isArray(manifest.records)||manifest.records.length!==PACKAGE.records.length)fail('manifest_records_invalid');
 manifest.records.forEach((r,i)=>{
  if(!r||typeof r!=='object'||Array.isArray(r))fail('manifest_record_invalid');
  for(const k of Object.keys(r))if(hasSecretKey(k))fail('secret_like_manifest_key');
  const keys=Object.keys(r).sort(); if(JSON.stringify(keys)!==JSON.stringify([...RECORD_KEYS].sort()))fail('manifest_record_fields_invalid');
  if(!r.source_path.startsWith('packages/deployhq-control-adapter-node1-recreate-v1/')||r.source_path.includes('..')||path.posix.isAbsolute(r.source_path))fail('source_path_invalid');
  if(!path.posix.isAbsolute(r.destination_path)||path.posix.normalize(r.destination_path)!==r.destination_path||r.destination_path.includes('/../')||r.destination_path.endsWith('/..'))fail('destination_path_invalid');
  if(!/^[a-f0-9]{64}$/.test(r.sha256)||!/^(0[0-7]{3})$/.test(r.mode)||r.owner!=='root'||r.group!=='root'||r.replace_policy!=='sha_bound_replace')fail('manifest_record_value_invalid');
  const e=PACKAGE.records[i]; for(const k of RECORD_KEYS)if(r[k]!==e[k])fail('manifest_record_mismatch');
 });
 const digest=sha256(canonicalManifestBytes(manifestBody(manifest)));if(digest!==PACKAGE.manifest_sha256)fail('manifest_sha_mismatch');
 return true;
}
function allowlisted(p){return ALLOWLIST.some(a=>a.endsWith('/')?p.startsWith(a):p===a)}
function validateDestination(record,fsApi){
 const p=record.destination_path;if(!allowlisted(p))fail('destination_not_allowlisted');
 if(!path.posix.isAbsolute(p)||path.posix.normalize(p)!==p)fail('destination_path_invalid');
 let cur=p;const chain=[];while(cur&&cur!=='/'){chain.push(cur);cur=path.posix.dirname(cur)}
 for(const q of chain){try{const s=fsApi.lstatSync(q);if(s&&typeof s.isSymbolicLink==='function'&&s.isSymbolicLink())fail(q===p?'destination_symlink':'destination_parent_symlink')}catch(e){if(e&&e.code==='ENOENT')continue;throw e}}
 return true;
}
function validatePackageBytes(manifest,artifactBytes){validateManifest(manifest);for(const r of manifest.records){const b=artifactBytes[r.source_path];if(!Buffer.isBuffer(b))fail('artifact_missing');if(sha256(b)!==r.sha256)fail('artifact_sha_mismatch')}return true}
function redactEvidence(v){if(Array.isArray(v))return v.map(redactEvidence);if(v&&typeof v==='object'){const o={};for(const [k,x] of Object.entries(v))o[k]=hasSecretKey(k)?'[REDACTED]':redactEvidence(x);return o}if(typeof v==='string'&&/(Bearer\s+\S+|Basic\s+\S+)/i.test(v))return '[REDACTED]';return v}

function sameJson(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b))}
function preflight({fsApi,execApi,manifest,packageBytes,sourceCommit,manifestSha,liveBaseline}){
 if(sourceCommit!==PACKAGE.source_commit)fail('source_commit_mismatch');
 if(manifestSha!==PACKAGE.manifest_sha256)fail('manifest_sha_mismatch');
 validatePackageBytes(manifest,packageBytes);
 let allow=true,symlink=true;
 for(const r of manifest.records){
  validateDestination(r,fsApi);
  try{const st=fsApi.lstatSync(r.destination_path);if(st&&typeof st.isDirectory==='function'&&st.isDirectory())fail('destination_conflict');if(st&&typeof st.isFile==='function'&&!st.isFile()&&!(typeof st.isSymbolicLink==='function'&&st.isSymbolicLink()))fail('destination_conflict')}catch(e){if(!(e&&e.code==='ENOENT'))throw e}
 }
 if(!liveBaseline||!sameJson(liveBaseline.expected,liveBaseline.actual))fail('baseline_drift');
 for(const r of manifest.records){
  const b=packageBytes[r.source_path];let vr;
  if(r.source_path.endsWith('.js')){if(!execApi||typeof execApi.verifyNode!=='function')fail('fixed_verifier_missing');vr=execApi.verifyNode(r.source_path,b)}
  else if(r.source_path.endsWith('.service')){if(!execApi||typeof execApi.verifyUnit!=='function')fail('fixed_verifier_missing');vr=execApi.verifyUnit(r.source_path,b)}
  else fail('artifact_type_not_supported');
  if(!vr||vr.ok!==true)fail('syntax_failed');
 }
 return redactEvidence({ok:true,action:ACTION,schema_version:'prhm.bootstrap-preflight-result.v1',package_id:PACKAGE.package_id,preflight_only:true,production_mutation:false,source_commit_match:true,manifest_sha_match:true,all_file_sha_match:true,destination_allowlist_pass:allow,symlink_guard_pass:symlink,syntax_pass:true,baseline_match:true,deployhq_mutation:false,application_mutation:false,honartik_mutation:false,imotion_mutation:false});
}


const SERVICE='prhm-deployhq-control.service';
function persistResult(result,deps){if(!deps||!deps.io||typeof deps.io.persistResult!=='function')fail('result_persistence_missing');deps.io.persistResult(redactEvidence(result));return result}
function rollbackJournal(journal,deps){
 const errors=[];const io=deps.io,service=deps.serviceApi;
 for(const e of [...journal.entries].reverse()){
  try{if(e.existed){if(!e.backup_path)throw new Error('backup_missing');const b=io.readBackup(e.backup_path);if(sha256(b)!==e.original_sha256)throw new Error('backup_sha_mismatch');io.restoreBackup(e.destination_path,e.backup_path,e)}else{io.remove(e.destination_path)}}catch(err){errors.push(e.destination_path+':'+String(err.message||err))}
 }
 try{if(journal.unit_changed&&service&&typeof service.daemonReload==='function')service.daemonReload()}catch(e){errors.push('daemon_reload:'+String(e.message||e))}
 try{if(service&&typeof service.restoreState==='function')service.restoreState(SERVICE,journal.service_state)}catch(e){errors.push('service_restore:'+String(e.message||e))}
 if(errors.length)return {ok:false,critical_failure:true,rollback_failed:true,errors};
 return {ok:true,rollback_performed:true,rollback_failed:false};
}
function applyTransaction(deps){
 const {io,serviceApi,healthApi}=deps||{};if(!io||!serviceApi||!healthApi)fail('apply_dependencies_missing');
 const pf=preflight(deps);
 const invocationId=deps.invocationId||crypto.randomUUID();
 const serviceState=serviceApi.getState(SERVICE);
 const entries=[];
 for(const r of deps.manifest.records){const st=io.inspect(r.destination_path);let backup=null;if(st.exists){if(st.is_symlink)fail('destination_symlink');backup=io.backup(r.destination_path,invocationId,r)}entries.push({destination_path:r.destination_path,existed:!!st.exists,original_sha256:st.exists?st.sha256:null,mode:st.mode??null,owner:st.owner??null,group:st.group??null,backup_path:backup,source_path:r.source_path,expected_sha256:r.sha256});}
 const unitPath='/etc/systemd/system/prhm-deployhq-control.service';
 const unitEntry=entries.find(x=>x.destination_path===unitPath);const unitChanged=!unitEntry?.existed||unitEntry.original_sha256!==unitEntry.expected_sha256;
 const journal={schema_version:'prhm.bootstrap-journal.v1',action:ACTION,package_id:PACKAGE.package_id,invocation_id:invocationId,entries,service_state:serviceState,unit_changed:unitChanged,mutation_started:false};
 io.persistJournal(journal);
 try{
  const staged=[];
  for(const r of deps.manifest.records){const stagePath=io.stageCandidate(invocationId,r,deps.packageBytes[r.source_path]);const stagedBytes=io.readStage(stagePath);if(sha256(stagedBytes)!==r.sha256)fail('stage_sha_mismatch');staged.push({r,stagePath})}
  journal.mutation_started=true;io.persistJournal(journal);
  for(const {r,stagePath} of staged){io.installAtomic(stagePath,r.destination_path,r);const now=io.readInstalled(r.destination_path);if(sha256(now)!==r.sha256)fail('post_write_sha_mismatch')}
  if(unitChanged)serviceApi.daemonReload();
  serviceApi.startOrRestart(SERVICE);
  const health=healthApi.checkAdapter();
  let adapterReady=true,readinessReason=null;
  if(!health||health.ok!==true){if(health&&health.reason==='deployhq_credentials_missing'){adapterReady=false;readinessReason='deployhq_credentials_missing'}else fail('adapter_health_failed')}
  const out={ok:true,action:ACTION,schema_version:'prhm.bootstrap-result.v1',package_id:PACKAGE.package_id,installed:true,adapter_installed:true,adapter_ready:adapterReady,readiness_reason:readinessReason,host_action_registration_installed:false,mcp_refresh_required:false,deployhq_mutation:false,application_mutation:false,honartik_mutation:false,imotion_mutation:false,rollback_performed:false,rollback_failed:false,invocation_id:invocationId,preflight:pf};
  persistResult(out,deps);return out;
 }catch(error){
  const rb=rollbackJournal(journal,deps);
  if(rb.rollback_failed){const out={ok:false,action:ACTION,critical_failure:true,rollback_failed:true,rollback_performed:false,error:String(error.message||error),rollback_errors:rb.errors};try{persistResult(out,deps)}catch{}return out}
  const out={ok:false,action:ACTION,critical_failure:false,rollback_failed:false,rollback_performed:true,error:String(error.message||error)};try{persistResult(out,deps)}catch{}return out;
 }
}

module.exports={ACTION,OPERATION,REQUEST_FIELDS,PACKAGE,ALLOWLIST,SERVICE,canonicalManifestBytes,validateManifest,validateDestination,validatePackageBytes,redactEvidence,sha256,preflight,applyTransaction,rollbackJournal,persistResult};
