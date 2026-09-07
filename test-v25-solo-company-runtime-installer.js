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
  assert.equal(mod.SOLO_PLUGIN_SHA,'a41955c6f0afb92a027788070b7a60cd51ae48f1593e97327e2bc39d079f8281');
  assert.equal(mod.SOLO_CORE_SHA,'bc905fd1ebc94a7b3147535785286ac75e16eea45642a65378d4f66f7831d563');
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
  assert.equal(mod.IMMUTABLE_HOST_ACTIONS_V2_SHA,'597701ccc1a6c39d54aef9bd22d1c8732c88536e36e12251511a509bde439b46');
  assert.deepEqual(mod.PATHS,{registry:'/home/agent/ssh-mcp-server/src/core/registry.js',hostActionsV2:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',soloPlugin:'/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstall.js',soloCore:'/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js'});
});
