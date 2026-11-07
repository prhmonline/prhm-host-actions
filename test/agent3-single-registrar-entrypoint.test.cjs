'use strict';
/**
 * Prevent recurrence of the two-adapter review ambiguity in PR #212.
 * This is source-only; passing it does not authorize host writes.
 */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const canonical=require('../ops/agent3-universal-backup/trusted-shared-registrar-dispatch.cjs');
const root=path.join(__dirname,'..','ops','agent3-universal-backup');
test('Agent 3 has one canonical signed registrar adapter, not two competing entry points',()=>{
 assert.equal(fs.existsSync(path.join(root,'trusted-registration-adapter.cjs')),false);
 assert.equal(typeof canonical.dispatch,'function');
 assert.equal(typeof canonical.boundRootCapabilities,'function');
 assert.equal(Object.hasOwn(canonical,'apply'),false);
 assert.equal(Object.hasOwn(canonical,'issueApproval'),false);
 assert.equal(Object.hasOwn(canonical,'spawn'),false);
 assert.equal(Object.hasOwn(canonical,'writeOwner'),false);
});
test('shared registrar bootstrap remains a mandatory independent gate before installing Agent 3',()=>{
 const gate=gateway.readiness({phase:'preinstall',release:{},registrarInstalled:false,
   approvalRouteInstalled:false,rollbackReady:true,servicesHealthy:true,
   registeredToolVisible:false});
 assert.equal(gate.ready,false);
 assert.deepEqual(gate.gaps,[
  'TRUSTED_REGISTRAR_NOT_INSTALLED',
  'APPROVAL_ROUTE_NOT_REGISTERED'
 ]);
});
