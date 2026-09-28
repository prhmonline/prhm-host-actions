'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const SCHEMA='prhm.current-owner-binding-manifest.v1';
const OWNER_SPECS=Object.freeze([
  Object.freeze({id:'agent_api',path:'/home/agent/ssh-agent-api/server.js',max_bytes:200000}),
  Object.freeze({id:'selfmaint_base',path:'/opt/prhm-agent-selfmaint/server.js',max_bytes:200000}),
  Object.freeze({id:'selfmaint_executor',path:'/opt/prhm-agent-selfmaint-exec/server.js',max_bytes:300000}),
  Object.freeze({id:'approval_policy',path:'/opt/prhm-company-control-plane/config/approval-policy.json',max_bytes:200000}),
  Object.freeze({id:'mcp_host_actions',path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',max_bytes:200000}),
  Object.freeze({id:'registry_base',path:'/home/agent/ssh-mcp-server/src/core/.registry-imotion-vm-stable-base-e91c3062539353a7a9d097b0877f1e612051e4fe8a489c101edab3e56d268c9b.mjs',max_bytes:200000}),
  Object.freeze({id:'rolling_refresh',path:'/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js',max_bytes:200000}),
  Object.freeze({id:'current_baseline_registration',path:'/opt/prhm-agent-selfmaint-exec/actions/current-baseline-refresh-registration-installer-v1.js',max_bytes:400000}),
  Object.freeze({id:'typed_bootstrap_transport',path:'/opt/prhm-agent-selfmaint-exec/actions/control-plane-typed-bootstrap-transport-v1.js',max_bytes:200000}),
  Object.freeze({id:'v19_refresh_helper',path:'/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-source-sha-refresh-v19.sh',max_bytes:100000}),
  Object.freeze({id:'titan_handoff_sandbox',path:'/home/prhm/worktrees/prhm-host-actions/titan-front-handoff-sandbox-v1.js',max_bytes:100000}),
]);

const INITIAL_CONSUMER_PREIMAGES=Object.freeze({
  registry_bridge:Object.freeze({target_path:'/home/agent/ssh-mcp-server/src/core/registry.js',sha256:'73d9560b8758a969f0317fd4438b9b36eb4a1b2e1ee18dcd50d1c2329c52ea6a'}),
  v19_binding:Object.freeze({target_path:'/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-source-sha-refresh-v19.sh',sha256:'00621639a589770d8b21ace88e6b5af0dd21b18a7fe2604c97d1b3ecf206de63'}),
  current_baseline_refresh:Object.freeze({target_path:'/opt/prhm-agent-selfmaint-exec/actions/current-baseline-refresh-registration-installer-v1.js',sha256:'2031d0de149d9f090987fe710df44413cd5ac0a51a7394ff7874c2e9073f077c'}),
  rolling_refresh:Object.freeze({target_path:'/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js',sha256:'8382624a36dacb57e784dc080783d6a765512e9c9e0c2ee8c8274aecfb710284'}),
  titan_handoff_sandbox:Object.freeze({target_path:'/home/prhm/worktrees/prhm-host-actions/titan-front-handoff-sandbox-v1.js',sha256:'825480f683e9a1d86ac663dab00ea98cb6e9967cf88bc4aef1f129fd75fa27a0'}),
});

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function fail(code){throw new Error(code);}

function validateFileOwner(spec,fsApi=fs){
  if(!spec||typeof spec!=='object'||typeof spec.id!=='string'||typeof spec.path!=='string')fail('owner_spec_invalid');
  if(!path.isAbsolute(spec.path))fail('owner_path_not_absolute');
  if(path.normalize(spec.path)!==spec.path)fail('owner_path_noncanonical');
  const st=fsApi.lstatSync(spec.path);
  if(st.isSymbolicLink())fail('owner_symlink_rejected');
  if(!st.isFile())fail('owner_not_regular_file');
  const real=fsApi.realpathSync(spec.path);
  if(real!==spec.path)fail('owner_path_noncanonical');
  if(!Number.isInteger(spec.max_bytes)||spec.max_bytes<=0)fail('owner_max_bytes_invalid');
  if(st.size>spec.max_bytes)fail('owner_too_large');
  const bytes=fsApi.readFileSync(spec.path);
  return Object.freeze({id:spec.id,path:spec.path,sha256:sha256(bytes),bytes:st.size,mode:st.mode&0o7777,uid:st.uid,gid:st.gid});
}

function normalizeCanonical(value){
  if(Array.isArray(value))return value.map(normalizeCanonical);
  if(value&&typeof value==='object'){
    const out={};
    for(const key of Object.keys(value).sort())out[key]=normalizeCanonical(value[key]);
    return out;
  }
  return value;
}
function canonicalJson(value){return JSON.stringify(normalizeCanonical(value));}

function buildManifest({capturedAt,owners,serviceFacts={}}={}){
  if(typeof capturedAt!=='string'||!capturedAt)fail('captured_at_invalid');
  if(!Array.isArray(owners))fail('owners_invalid');
  const sorted=owners.map(o=>normalizeCanonical(o)).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const ids=sorted.map(o=>o.id);
  if(new Set(ids).size!==ids.length)fail('owner_id_duplicate');
  for(const owner of sorted){
    if(!owner||typeof owner.id!=='string'||typeof owner.path!=='string'||!/^[a-f0-9]{64}$/.test(String(owner.sha256||'')))fail('owner_fact_invalid');
  }
  const data={schema_version:SCHEMA,captured_at:capturedAt,owners:sorted,service_facts:normalizeCanonical(serviceFacts)};
  const manifest_sha256=sha256(Buffer.from(canonicalJson(data)));
  return Object.freeze({...data,manifest_sha256});
}

module.exports=Object.freeze({SCHEMA,OWNER_SPECS,INITIAL_CONSUMER_PREIMAGES,validateFileOwner,canonicalJson,buildManifest});
