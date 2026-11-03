'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classify, FIXED } = require('./universal-installer-backup-only-server-local-readiness-v1.cjs');
const healthy = Object.freeze({
  installedBaseSha: FIXED.installed_backup_sha256,
  candidateArchiveSha: FIXED.archive_sha256,
  approvalCenterPublicKeyPresent:true,
  approvalCenterLedgerPresent:true,
  providerTrustAnchorPresent:true,
  rootOwnedNativeActionPresent:true,
  agentApiRegistered:true,
  rootExecutorRegistered:true,
  mcpRegistered:true,
  exactPolicyRegistered:true,
  typedL4ScopeRegistered:true
});
test('fully registered state is only ready to REQUEST approval, never an installation authorization', ()=>{
  const r=classify({...healthy});
  assert.equal(r.readyToRequestSignedL4,true);
  assert.equal(r.executionAuthorizedByThisProbe,false);
  assert.equal(r.productionInstallerUpgraded,false);
  assert.equal(r.signedReceiptValidated,false);
  assert.equal(r.blockers.length,0);
});
for(const key of Object.keys(healthy)){
  test('fails closed if '+key+' is missing or mismatched',()=>{
    const bad={...healthy,[key]: key.endsWith('Sha')?'0'.repeat(64):false};
    const r=classify(bad);
    assert.equal(r.readyToRequestSignedL4,false);
    assert.ok(r.blockers.includes(({installedBaseSha:'installedBaseExact',candidateArchiveSha:'candidateExact',approvalCenterPublicKeyPresent:'approvalCenterPublicKeyPresent',approvalCenterLedgerPresent:'approvalCenterLedgerPresent',providerTrustAnchorPresent:'providerTrustAnchorPresent',rootOwnedNativeActionPresent:'rootOwnedNativeActionPresent',agentApiRegistered:'agentApiRegistered',rootExecutorRegistered:'rootExecutorRegistered',mcpRegistered:'mcpRegistered',exactPolicyRegistered:'exactPolicyRegistered',typedL4ScopeRegistered:'typedL4ScopeRegistered'})[key]));
    assert.equal(r.executionAuthorizedByThisProbe,false);
  });
}
test('absence of all observed trust prerequisites produces distinct blockers',()=>{
  const r=classify({});
  assert.equal(r.readyToRequestSignedL4,false);
  assert.equal(r.blockers.length,11);
  assert.equal(r.rootOfTrustRegistrationExecuted,false);
});
