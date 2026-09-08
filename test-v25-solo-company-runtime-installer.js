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
    "import { registerHostActionsV2Plugin } from '../plugins/hostActionsV2.js';",
    "import { registerHonartikIticketPreflightPlugin } from '../plugins/honartikIticketPreflight.js';",
    'export function registerPlugins(mcp, context) {',
    '  registerHostActionsV2Plugin(mcp, context);',
    '  registerHonartikIticketPreflightPlugin(mcp, context);',
    '}'
  ].join('\n');
  const out=mod.patchRegistry(baseline);
  assert.equal((out.match(/registerSoloCompanyRuntimeInstallPlugin/g)||[]).length,2);
  assert.equal((out.match(/registerHostActionsV2Plugin/g)||[]).length,2);
  assert.ok(out.includes("import { registerSoloCompanyRuntimeInstallPlugin } from '../plugins/soloCompanyRuntimeInstall.js';"));
  assert.ok(out.includes('registerSoloCompanyRuntimeInstallPlugin(mcp, context);'));
  assert.throws(()=>mod.patchRegistry(out),/already_patched/);
});

test('production materialization is fixed to current active baseline and create-only Solo paths',()=>{
  assert.equal(mod.EXPECTED_REGISTRY_SHA,'0d69b284f8bcf9b772a711dff962a614bd0c1234ee03b87f3faa70877eadb48c');
  assert.equal(mod.IMMUTABLE_HOST_ACTIONS_V2_SHA,'001619fc2485202162da5c20fe1348cc430d4d8f119b41d38d0be4dbf8bdb8b4');
  assert.deepEqual(mod.PATHS,{registry:'/home/agent/ssh-mcp-server/src/core/registry.js',hostActionsV2:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',soloPlugin:'/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstall.js',soloCore:'/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js'});
});
