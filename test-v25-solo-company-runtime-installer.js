'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const mod=require('./bootstrap-host-actions-v25-solo-company-runtime-installer.js');

test('Solo installer is bound to the router-safe canonical source commit',()=>{
  assert.equal(mod.ACTION,'solo_company_runtime_install_surface_v1');
  assert.equal(mod.SOURCE_REPO,'/home/agent/sshagent-repo');
  assert.equal(mod.SOURCE_COMMIT,'8d5ac81d4e234551953e0e73c653e557bc994cb1');
  assert.deepEqual(mod.SOURCE_PATHS,{
    plugin:'mcp-server/src/plugins/soloCompanyRuntimeInstall.js',
    core:'mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js'
  });
  assert.equal(mod.SOLO_PLUGIN_SHA,'60cac9151ab434ff0b5a0f8c86651a226f8478a6c825a0513fd2a88c1c20ea5f');
  assert.equal(mod.SOLO_CORE_SHA,'68b0593efea6fe6a403214be57372e48ea767e1cb68b0c47e1498b6e210bd328');
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

test('production materialization is SHA-bound to the current live Agent2 MCP baseline',()=>{
  assert.equal(mod.EXPECTED_REGISTRY_SHA,'73d9560b8758a969f0317fd4438b9b36eb4a1b2e1ee18dcd50d1c2329c52ea6a');
  assert.equal(mod.IMMUTABLE_HOST_ACTIONS_V2_SHA,'b2f95b97dfa7e26ca717dfbec7871bf2f64286952548fb4d6d8e99908aeaacc0');
  assert.deepEqual(mod.PATHS,{
    registry:'/home/agent/ssh-mcp-server/src/core/registry.js',
    hostActionsV2:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
    soloPlugin:'/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstall.js',
    soloCore:'/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js'
  });
});

test('source extraction command is fixed to git show of the pinned commit only',()=>{
  assert.deepEqual(mod.sourceGitShowArgs(mod.SOURCE_PATHS.plugin),[
    '-C',mod.SOURCE_REPO,'show',`${mod.SOURCE_COMMIT}:${mod.SOURCE_PATHS.plugin}`
  ]);
  assert.deepEqual(mod.sourceGitShowArgs(mod.SOURCE_PATHS.core),[
    '-C',mod.SOURCE_REPO,'show',`${mod.SOURCE_COMMIT}:${mod.SOURCE_PATHS.core}`
  ]);
  assert.throws(()=>mod.sourceGitShowArgs('../escape'),/source_path_not_allowlisted/);
});
