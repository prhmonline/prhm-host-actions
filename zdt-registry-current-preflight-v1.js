'use strict';

const crypto=require('node:crypto');

const ACTION='agent_zdt_registry_current_preflight_v1';
const SOURCE_MAIN_SHA='b8707b676a20e3c67af72d6d771f0dcad0f0b2b8';
const CURRENT_REGISTRY_SHA='7432741650ee5c5bc3bb72c1403050b27a665e9218153b40e58955da77b471a4';
const LEGACY_REGISTRY_SHA='faec4810f1a8059f7c9bf7cb02a277d3e515b8f15bbc52dde8ddce347aa7155f';
const CURRENT_ANCHOR='  const result=base.registerPlugins(withProjectSchemas(ticketingBridge.proxy),context);';
const FINAL_TOOL='agent_zdt_existing_topology_rolling_refresh_apply_v1';

const production_mutation=false;
const database_mutation=false;
const runtime_mutation=false;

const sha=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');
const count=(s,n)=>s.split(n).length-1;
const fail=c=>{throw new Error(c)};

function inspectRegistrySource(source){
  if(typeof source!=='string')fail('registry_source_invalid');
  const current=sha(source);
  if(current!==CURRENT_REGISTRY_SHA)fail('registry_current_sha_mismatch:'+current);
  if(source.includes(FINAL_TOOL))fail('registry_final_tool_already_present');
  const anchorCount=count(source,CURRENT_ANCHOR);
  if(anchorCount!==1)fail('registry_current_anchor_count:'+anchorCount);
  if(source.includes('  registerHostActionsV2Plugin(mcp, context);'))fail('registry_legacy_anchor_still_present');
  if(!source.includes('export function registerPlugins(mcp,context){'))fail('registry_register_plugins_missing');
  return Object.freeze({
    ok:true,
    action:ACTION,
    source_main_sha:SOURCE_MAIN_SHA,
    current_registry_sha256:current,
    legacy_registry_sha256:LEGACY_REGISTRY_SHA,
    anchor_count:anchorCount,
    final_tool_present:false,
    current_wrapper_shape:true,
    production_mutation,
    database_mutation,
    runtime_mutation
  });
}

module.exports=Object.freeze({
  ACTION,SOURCE_MAIN_SHA,CURRENT_REGISTRY_SHA,LEGACY_REGISTRY_SHA,
  CURRENT_ANCHOR,FINAL_TOOL,inspectRegistrySource,
  production_mutation,database_mutation,runtime_mutation
});
