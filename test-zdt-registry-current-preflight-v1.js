'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const m=require('./zdt-registry-current-preflight-v1.js');

const sha=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');

function syntheticCurrent(){
  const prefix='export function registerPlugins(mcp,context){\n';
  const anchor=m.CURRENT_ANCHOR+'\n';
  const suffix='  return result;\n}\n';
  let source=prefix+anchor+suffix;
  return source;
}

test('exports fixed read-only preflight contract',()=>{
  assert.equal(m.ACTION,'agent_zdt_registry_current_preflight_v1');
  assert.equal(m.SOURCE_MAIN_SHA,'b8707b676a20e3c67af72d6d771f0dcad0f0b2b8');
  assert.equal(m.CURRENT_REGISTRY_SHA,'7432741650ee5c5bc3bb72c1403050b27a665e9218153b40e58955da77b471a4');
  assert.equal(m.LEGACY_REGISTRY_SHA,'faec4810f1a8059f7c9bf7cb02a277d3e515b8f15bbc52dde8ddce347aa7155f');
  assert.equal(m.production_mutation,false);
  assert.equal(m.database_mutation,false);
  assert.equal(m.runtime_mutation,false);
});

test('pins the exact current wrapper anchor and rejects legacy direct registration',()=>{
  assert.equal(m.CURRENT_ANCHOR,'  const result=base.registerPlugins(withProjectSchemas(ticketingBridge.proxy),context);');
  assert.equal(m.FINAL_TOOL,'agent_zdt_existing_topology_rolling_refresh_apply_v1');
});

test('fails closed for non-current content',()=>{
  const s=syntheticCurrent();
  assert.notEqual(sha(s),m.CURRENT_REGISTRY_SHA);
  assert.throws(()=>m.inspectRegistrySource(s),/registry_current_sha_mismatch/);
});

test('public contract exposes no write or execution surface',()=>{
  for(const k of ['apply','write','exec','spawn','command','path','confirmation']){
    assert.equal(Object.hasOwn(m,k),false,k);
  }
  assert.equal(typeof m.inspectRegistrySource,'function');
  assert.equal(m.inspectRegistrySource.length,1);
});
