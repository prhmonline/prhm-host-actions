'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const adapter=require('./shared-registrar-native-root-adapter-v1.cjs');
const source=require('./shared-registrar-root-trust-preflight-v1.cjs');

test('candidate is not a standalone installer',()=>{
 const run=cp.spawnSync(process.execPath,
  [path.join(__dirname,'shared-registrar-native-root-adapter-v1.cjs')],
  {encoding:'utf8'});
 assert.equal(run.status,64);
 assert.match(run.stderr,/No standalone installer/);
});
test('no arbitrary tool/action/command interface is exported',()=>{
 assert.equal(Object.isFrozen(adapter),true);
 for(const name of ['sign','issueApproval','createRequest','authorize',
    'register','exec','shell','writeFile','unrestrictedApply']){
  assert.equal(name in adapter,false);
 }
 assert.equal(adapter.ROOT,'/var/backups/prhm-host-actions-registration');
});
test('untrusted caller cannot construct an executable release',()=>{
 const args={action:source.ACTION,project:'pbcinema',
  source_commit:'a'.repeat(40),manifest_commit:'b'.repeat(40),
  manifest_sha256:'c'.repeat(64)};
 assert.throws(()=>adapter.createBoundPlan({args,hooks:{}}),
  /trusted_host_capability_missing/);
 assert.throws(()=>adapter.createBoundPlan({args:{...args,command:'sh'},hooks:{}}),
  /trusted_host_capability_missing/);
});
test('invalid L4 arguments are rejected even before live root access',async()=>{
 // On a non-privileged Linux CI runner this should fail root_only; on a
 // privileged isolated test runner a missing safe production work root
 // still prevents any installed action from running.
 await assert.rejects(adapter.applyFromTrustedRootDispatcher({
  args:{action:'unknown'},approvalToken:'approved',hooks:{}
 }),/registrar_root_adapter_|registry_gateway_/);
});
