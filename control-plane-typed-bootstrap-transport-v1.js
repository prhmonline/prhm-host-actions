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
module.exports={ACTION,OPERATION,REQUEST_FIELDS,PACKAGE,ALLOWLIST,canonicalManifestBytes,validateManifest,validateDestination,validatePackageBytes,redactEvidence,sha256};
