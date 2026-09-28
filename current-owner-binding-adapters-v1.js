'use strict';
const crypto=require('node:crypto');
const {INITIAL_CONSUMER_PREIMAGES}=require('./current-owner-binding-manifest-v1.js');

const BINDING_SCHEMA='prhm.current-owner-binding-consumer.v1';
const MARKER='PRHM_CURRENT_OWNER_BINDING_V1';
const BLOCK_BEGIN='PRHM_CURRENT_OWNER_BINDING_BLOCK_V1_BEGIN';
const BLOCK_END='PRHM_CURRENT_OWNER_BINDING_BLOCK_V1_END';
const HEX64=/^[a-f0-9]{64}$/;

const FIXED=Object.freeze({
  registry_bridge:Object.freeze({owner_ids:Object.freeze(['registry_base']),restart_units:Object.freeze([])}),
  v19_binding:Object.freeze({owner_ids:Object.freeze(['rolling_refresh','agent_api']),restart_units:Object.freeze([])}),
  current_baseline_refresh:Object.freeze({owner_ids:Object.freeze(['selfmaint_base','selfmaint_executor','approval_policy','mcp_host_actions']),restart_units:Object.freeze([])}),
  rolling_refresh:Object.freeze({owner_ids:Object.freeze(['agent_api']),restart_units:Object.freeze([])}),
  titan_handoff_sandbox:Object.freeze({owner_ids:Object.freeze([]),restart_units:Object.freeze([])}),
});

function fail(code){throw new Error(code);}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function asBuffer(value){return Buffer.isBuffer(value)?value:Buffer.from(String(value),'utf8');}
function ownerMap(manifest){
  if(!manifest||manifest.schema_version!=='prhm.current-owner-binding-manifest.v1'||!HEX64.test(String(manifest.manifest_sha256||''))||!Array.isArray(manifest.owners))fail('manifest_invalid');
  const map=new Map();
  for(const owner of manifest.owners){
    if(!owner||typeof owner.id!=='string'||!HEX64.test(String(owner.sha256||'')))fail('manifest_owner_invalid');
    if(map.has(owner.id))fail('manifest_owner_duplicate');
    map.set(owner.id,owner);
  }
  return map;
}
function requiredOwners(manifest,consumerId){
  const map=ownerMap(manifest), out={};
  for(const id of FIXED[consumerId].owner_ids){
    const owner=map.get(id);if(!owner)fail('manifest_owner_missing:'+id);
    out[id]=owner.sha256;
  }
  return Object.freeze(out);
}
function markerRecord(manifest,consumerId,owners){
  return Object.freeze({schema_version:BINDING_SCHEMA,consumer_id:consumerId,manifest_sha256:manifest.manifest_sha256,owners});
}
function markerLine(prefix,record){return `${prefix} ${MARKER} ${Buffer.from(JSON.stringify(record),'utf8').toString('base64url')}`;}
function parseMarker(text,consumerId){
  const re=new RegExp(`^(?:\\/\\/|#) ${MARKER} ([A-Za-z0-9_-]+)$`,'m');
  const m=text.match(re);if(!m)return null;
  let record;try{record=JSON.parse(Buffer.from(m[1],'base64url').toString('utf8'));}catch{fail('migrated_marker_invalid');}
  if(!record||record.schema_version!==BINDING_SCHEMA||record.consumer_id!==consumerId||!HEX64.test(String(record.manifest_sha256||''))||!record.owners||typeof record.owners!=='object'||Array.isArray(record.owners))fail('migrated_marker_invalid');
  return record;
}
function stripMarker(text){return text.replace(new RegExp(`^(?:\\/\\/|#) ${MARKER} [A-Za-z0-9_-]+\\n?`,'m'),'');}
function replaceBlock(text,consumerId,block){
  const begin=`// ${BLOCK_BEGIN} ${consumerId}`;
  const end=`// ${BLOCK_END} ${consumerId}`;
  const re=new RegExp(`${escapeRegex(begin)}[\\s\\S]*?${escapeRegex(end)}\\n?`);
  return re.test(text)?text.replace(re,block+'\n'):null;
}
function escapeRegex(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function initialState(consumerId,input,text){
  const spec=INITIAL_CONSUMER_PREIMAGES[consumerId];
  if(!spec)fail('consumer_unknown');
  if(input.target_path!==spec.target_path)fail('consumer_target_mismatch');
  if(!HEX64.test(String(input.before_sha256||'')))fail('consumer_preimage_sha_invalid');
  if(input.before_sha256===spec.sha256)return 'migration';
  if(parseMarker(text,consumerId))return 'already_migrated';
  fail('consumer_preimage_unknown');
}
function result(consumerId,input,state,afterText){
  const bytes=Buffer.from(afterText,'utf8');
  return Object.freeze({consumer_id:consumerId,target_path:input.target_path,before_sha256:input.before_sha256,after_bytes:bytes,after_sha256:sha256(bytes),restart_units:[...FIXED[consumerId].restart_units],state});
}
function prep(consumerId,input){
  if(!input||typeof input!=='object')fail('consumer_input_invalid');
  const bytes=asBuffer(input.before_bytes), text=bytes.toString('utf8');
  const state=initialState(consumerId,input,text);
  const owners=requiredOwners(input.manifest,consumerId);
  return {text:stripMarker(text),state,owners,record:markerRecord(input.manifest,consumerId,owners)};
}
function jsBindingBlock(consumerId,constantName,record,body){
  return `// ${BLOCK_BEGIN} ${consumerId}\nconst ${constantName}=Object.freeze(${JSON.stringify(record)});\n${body}\n// ${BLOCK_END} ${consumerId}`;
}
function buildRegistryBridgeCandidate(input){
  const id='registry_bridge', p=prep(id,input);
  let text=p.text;
  const block=jsBindingBlock(id,'CURRENT_OWNER_BINDING_REGISTRY_BRIDGE',p.record,"const BASE_SHA=CURRENT_OWNER_BINDING_REGISTRY_BRIDGE.owners.registry_base;");
  const replaced=replaceBlock(text,id,block);
  if(replaced!==null)text=replaced;
  else {
    const re=/const BASE_SHA='[a-f0-9]{64}';/;
    if(!re.test(text))fail('registry_bridge_anchor_missing');
    text=text.replace(re,block);
  }
  text=markerLine('//',p.record)+'\n'+text;
  if(!text.includes("const BASE=path.join(HERE,'.registry-imotion-vm-stable-base-'+BASE_SHA+'.mjs');"))fail('registry_bridge_base_contract_missing');
  return result(id,input,p.state,text);
}
function buildV19BindingCandidate(input){
  const id='v19_binding', p=prep(id,input), o=p.owners;
  const marker=markerLine('#',p.record);
  const text=`#!/usr/bin/env bash\nset -euo pipefail\n${marker}\nTARGET='/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js'\nEXPECTED_ACTION_SHA='${o.rolling_refresh}'\nEXPECTED_API_SHA='${o.agent_api}'\nfail(){ printf '%s\\n' \"$1\" >&2; exit 1; }\n[ -f \"$TARGET\" ] && [ ! -L \"$TARGET\" ] || fail 'target_not_regular'\nCURRENT_SHA=\"$(sha256sum \"$TARGET\" | awk '{print $1}')\"\n[ \"$CURRENT_SHA\" = \"$EXPECTED_ACTION_SHA\" ] || fail 'rolling_refresh_owner_sha_mismatch'\nCOUNT=\"$(grep -F -o -- \"$EXPECTED_API_SHA\" \"$TARGET\" | wc -l | tr -d ' ')\"\n[ \"$COUNT\" = '1' ] || fail 'agent_api_owner_binding_count_mismatch'\nprintf '{\"ok\":true,\"action\":\"agent_zdt_existing_topology_rolling_refresh_source_binding_v1\",\"manifest_sha256\":\"%s\",\"production_application_mutation\":false,\"database_mutation\":false}\\n' '${input.manifest.manifest_sha256}'\n`;
  return result(id,input,p.state,text);
}
function buildCurrentBaselineRefreshCandidate(input){
  const id='current_baseline_refresh', p=prep(id,input), o=p.owners;
  let text=p.text;
  const owners={base:o.selfmaint_base,exec:o.selfmaint_executor,policy:o.approval_policy,mcp:o.mcp_host_actions};
  const record={...p.record,owners};
  const block=jsBindingBlock(id,'CURRENT_OWNER_BINDING_CURRENT_BASELINE',record,'const BASELINE=CURRENT_OWNER_BINDING_CURRENT_BASELINE.owners;');
  const replaced=replaceBlock(text,id,block);
  if(replaced!==null)text=replaced;
  else {
    const re=/const BASELINE=\{[^\n]*\};/;
    if(!re.test(text))fail('current_baseline_anchor_missing');
    text=text.replace(re,block);
  }
  text=markerLine('//',record)+'\n'+text;
  return result(id,input,p.state,text);
}
function buildRollingRefreshCandidate(input){
  const id='rolling_refresh', p=prep(id,input);
  let text=p.text;
  const block=jsBindingBlock(id,'CURRENT_OWNER_BINDING_ROLLING_REFRESH',p.record,'');
  const replaced=replaceBlock(text,id,block);
  if(replaced!==null)text=replaced;
  else {
    const anchor='const EXPECTED_SHA=Object.freeze({';
    if(!text.includes(anchor))fail('rolling_refresh_expected_sha_anchor_missing');
    text=text.replace(anchor,block+'\n'+anchor);
  }
  const literal=/\[PATHS\.apiSource\]:'[a-f0-9]{64}',/;
  const dynamic='[PATHS.apiSource]:CURRENT_OWNER_BINDING_ROLLING_REFRESH.owners.agent_api,';
  if(literal.test(text))text=text.replace(literal,dynamic);
  else if(!text.includes(dynamic))fail('rolling_refresh_api_anchor_missing');
  text=markerLine('//',p.record)+'\n'+text;
  return result(id,input,p.state,text);
}
function buildTitanHandoffSandboxCandidate(input){
  const id='titan_handoff_sandbox', p=prep(id,input);
  let text=p.text;
  for(const required of ['ProtectSystem=strict','ProtectHome=read-only','NoNewPrivileges=true','LockPersonality=true'])if(!text.includes(required))fail('titan_hardening_anchor_missing:'+required);
  const unsupported=/\s*'RestrictSUIDSGID=true',/g;
  const matches=text.match(unsupported)||[];
  if(matches.length>1)fail('titan_restrict_suidsgid_count_invalid');
  if(matches.length===1)text=text.replace(unsupported,'');
  else if(p.state==='migration')fail('titan_restrict_suidsgid_anchor_missing');
  if(text.includes('RestrictSUIDSGID=true'))fail('titan_restrict_suidsgid_remains');
  text=markerLine('//',p.record)+'\n'+text;
  return result(id,input,p.state,text);
}

const ADAPTERS=Object.freeze({registry_bridge:buildRegistryBridgeCandidate,v19_binding:buildV19BindingCandidate,current_baseline_refresh:buildCurrentBaselineRefreshCandidate,rolling_refresh:buildRollingRefreshCandidate,titan_handoff_sandbox:buildTitanHandoffSandboxCandidate});
function buildConsumerCandidate(consumerId,input){const fn=ADAPTERS[consumerId];if(!fn)fail('consumer_unknown');return fn(input);}
module.exports=Object.freeze({BINDING_SCHEMA,ADAPTERS,buildConsumerCandidate,buildRegistryBridgeCandidate,buildV19BindingCandidate,buildCurrentBaselineRefreshCandidate,buildRollingRefreshCandidate,buildTitanHandoffSandboxCandidate});
