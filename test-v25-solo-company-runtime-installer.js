'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const test=require('node:test');
const mod=require('./bootstrap-host-actions-v25-solo-company-runtime-installer.js');
const H=b=>crypto.createHash('sha256').update(b).digest('hex');

test('embedded Solo installer plugins are exact and fixed',()=>{
  assert.equal(mod.ACTION,'solo_company_runtime_install_surface_v1');
  const p=Buffer.from(mod.SOLO_PLUGIN_B64,'base64');
  const c=Buffer.from(mod.SOLO_CORE_B64,'base64');
  assert.equal(H(p),mod.SOLO_PLUGIN_SHA);
  assert.equal(H(c),mod.SOLO_CORE_SHA);
  assert.equal(mod.SOLO_PLUGIN_SHA,'60cac9151ab434ff0b5a0f8c86651a226f8478a6c825a0513fd2a88c1c20ea5f');
  assert.equal(mod.SOLO_CORE_SHA,'9e4139c7b8f126284c8aaced743e5daecb49fafd0c4a41bde47d61cbc4ffe223');
});

test('registry patch adds exactly one Solo import and registration without altering HostActionsV2',()=>{
  const baseline=[
    "import { registerSafeFilesPlugin as registerRawSafeFilesPlugin } from '../plugins/safeFiles.js';",
    'export function registerPlugins(mcp, context) {',
    '  const ticketingBridge=ticketingWave4ProjectBridge(suppressVmTool(mcp),context);',
    '  const result=base.registerPlugins(withProjectSchemas(ticketingBridge.proxy),context);',
    '  ticketingBridge.install();',
    '  return result;',
    '}'
  ].join('\n');
  const out=mod.patchRegistry(baseline);
  assert.equal((out.match(/registerSoloCompanyRuntimeInstallPlugin/g)||[]).length,2);
  assert.equal((out.match(/registerHostActionsV2Plugin/g)||[]).length,0);
  assert.ok(out.includes("import { registerSoloCompanyRuntimeInstallPlugin } from '../plugins/soloCompanyRuntimeInstall.js';"));
  assert.ok(out.includes('registerSoloCompanyRuntimeInstallPlugin(mcp, context);'));
  assert.throws(()=>mod.patchRegistry(out),/already_patched/);
});

test('production materialization is fixed to current active baseline and create-only Solo paths',()=>{
  assert.equal(mod.EXPECTED_REGISTRY_SHA,'73d9560b8758a969f0317fd4438b9b36eb4a1b2e1ee18dcd50d1c2329c52ea6a');
  assert.equal(mod.IMMUTABLE_HOST_ACTIONS_V2_SHA,'048e2db190c5548f47967447b3b564eefd0b7203cf6df84beb73c520d481633d');
  assert.deepEqual(mod.PATHS,{registry:'/home/agent/ssh-mcp-server/src/core/registry.js',hostActionsV2:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',soloPlugin:'/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstall.js',soloCore:'/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js'});
});


test('exact plugin-only partial install is resumable',()=>{
  assert.equal(mod.classifyMaterializationState({plugin_exists:true,plugin_sha:mod.SOLO_PLUGIN_SHA,core_exists:false,core_sha:null,registry_bound:false}),'plugin_only');
});

test('core-only or mismatched existing payload fails closed',()=>{
  assert.throws(()=>mod.classifyMaterializationState({plugin_exists:false,plugin_sha:null,core_exists:true,core_sha:mod.SOLO_CORE_SHA,registry_bound:false}),/core_only_partial_install/);
  assert.throws(()=>mod.classifyMaterializationState({plugin_exists:true,plugin_sha:'0'.repeat(64),core_exists:false,core_sha:null,registry_bound:false}),/installed_solo_plugin_sha_mismatch/);
});

test('exact payload pair can resume registry binding and exact bound state is installed',()=>{
  assert.equal(mod.classifyMaterializationState({plugin_exists:true,plugin_sha:mod.SOLO_PLUGIN_SHA,core_exists:true,core_sha:mod.SOLO_CORE_SHA,registry_bound:false}),'payloads_only');
  assert.equal(mod.classifyMaterializationState({plugin_exists:true,plugin_sha:mod.SOLO_PLUGIN_SHA,core_exists:true,core_sha:mod.SOLO_CORE_SHA,registry_bound:true}),'installed');
});
