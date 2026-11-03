'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const mod=require('./solo-company-runtime-root-action-v1.js');
test('privileged root action is immutable and bound to source SHA256 and fixed release',()=>{
  assert.equal(mod.ACTION,'solo_company_runtime_install_v1');
  assert.equal(mod.RELEASE_SHA,'0eb43d72aab3f10db22172c8be4c0411cf22d074');
  assert.equal(mod.SOURCE,'/home/agent/ssh-mcp-server/src/plugins/soloCompanyRuntimeInstallCore.js');
  assert.match(mod.SOURCE_SHA256,/^[a-f0-9]{64}$/);
  assert.equal(mod.RESULT,'/var/lib/prhm-agent-selfmaint-exec/solo-company-runtime-install-v1/root-action-result.json');
});
test('root helper discloses only normalized errors',()=>{
  assert.equal(mod.safeCode({code:'runtime_health_timeout'}),'runtime_health_timeout');
  assert.equal(mod.safeCode({code:'Error /etc/passwd SECRET'}),'solo_runtime_root_install_failed');
});
test('untrusted shell/test runner cannot enter installation',()=>{
  assert.throws(()=>mod.environmentPreflight(),/(root_required|host_action_context_missing|transient_systemd_context_missing|agent2_router_port_mismatch)/);
});
test('single source entrypoint and no user-provided command arguments',()=>{
  const source=fs.readFileSync(path.join(__dirname,'solo-company-runtime-root-action-v1.js'),'utf8');
  assert.match(source,/process\.argv\.length!==2/);
  assert.match(source,/fs\.realpathSync\(SOURCE\)!==SOURCE/);
  assert.match(source,/sha\(bytes\)!==SOURCE_SHA256/);
  assert.match(source,/fs\.mkdtempSync\('\/run\/prhm-solo-root-action-'\)/);
  assert.match(source,/performAuthorizedRootHostActionV1\(\)/);
  assert.doesNotMatch(source,/shell:\s*true|eval\(|new Function\(/);
  console.log('SOLO_ROOT_ACTION_HELPER_SHA256='+mod.sha(Buffer.from(source)));
});
