'use strict';
/*
 * Public source-only gate: no PRIVATE approval-policy / dispatcher fixtures,
 * no root/network calls, and no ability to create or consume L4 permissions.
 * The separate full positive suite uses exact private blobs in an isolated
 * test environment, NEVER hosted on the public repository.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tx=require('./deploy-control-l4-post-registration-cutover-v2.cjs');
const {CONTRACT}=require('./deploy-control-cutover-contract-v1.cjs');
const source=fs.readFileSync(path.join(__dirname,
 'deploy-control-l4-post-registration-cutover-v2.cjs'),'utf8');

function denyHost({root=true,registered=false}={}){
 const events=[];
 const host=Object.fromEntries(tx.CAPABILITIES.map(k=>[k,async()=>{
  events.push(k);throw Error('untrusted_capability_reached:'+k);
 }]));
 host.assertTrustedRootExecutor=async()=>{events.push('attest_root');return root};
 host.getFixedToolDiscovery=async name=>{
  events.push('discover:'+name);return registered;
 };
 return {host,events};
}
test('phase-2 policy pin is registered candidate, NEVER original pre-registration policy',()=>{
 assert.equal(tx.POLICY_REGISTERED.version,CONTRACT.candidate_policy_version);
 assert.equal(tx.POLICY_REGISTERED.hash,CONTRACT.candidate_policy_object_sha256);
 assert.equal(tx.POLICY_REGISTERED.sha256,tx.ASSETS[0].sha256);
 assert.notEqual(tx.POLICY_REGISTERED.sha256,CONTRACT.live_policy_raw_sha256);
 assert.equal(tx.ACTION,'deploy_control_cutover_install_v1');
 assert.equal(tx.SCOPE.level,4);
 assert.equal(tx.SCOPE.one_time_use,true);
});
test('untrusted root executor denies without discovery, staging, approval or writes',async()=>{
 const {host,events}=denyHost({root:false});
 await assert.rejects(tx.applyFixedCutover({host,assets:{}}),/DENIED_OR_ROLLED_BACK/);
 assert.deepEqual(events,['attest_root']);
});
test('unregistered L4 action denies before source, journal, freeze, approval or write',async()=>{
 const {host,events}=denyHost();
 await assert.rejects(tx.applyFixedCutover({host,assets:{}}),/DENIED_OR_ROLLED_BACK/);
 assert.deepEqual(events,['attest_root','discover:'+tx.ACTION]);
});
test('registered action with unreviewed private blobs still denies before approval',async()=>{
 const {host,events}=denyHost({registered:true});
 await assert.rejects(tx.applyFixedCutover({host,assets:{}}),/DENIED_OR_ROLLED_BACK/);
 assert.deepEqual(events,['attest_root','discover:'+tx.ACTION]);
});
test('phase-2 source contains issuer re-attestation after freeze and before consumption',()=>{
 const freeze=source.indexOf('await h.freezeAllDeployEntrypoints()');
 const late=source.indexOf("fail('registered_policy_changed_before_approval')");
 const consume=source.indexOf('await h.consumeSignedExactLevel4Authorization(SCOPE)');
 assert.ok(freeze>0&&late>freeze&&consume>late);
 assert.match(source,/health\(await h\.getApprovalCenterHealth\(\),'before'\)/);
 assert.match(source,/registered_action_disappeared_before_approval/);
});
test('phase-2 is not an issuer-policy installer or registrar, including rollback',()=>{
 assert.doesNotMatch(source,/await h\.atomicWriteRootFile\(ASSETS\[0\]\.path/);
 assert.doesNotMatch(source,/await h\.reloadApprovalCenter\(/);
 assert.match(source,/preimages:\[\.\.\.LEGACY\.map\(x=>x\.path\),STAGING\.path\]/);
 assert.match(source,/readonly_expected:\[\{path:ASSETS\[0\]\.path,sha256:POLICY_REGISTERED\.sha256\}\]/);
 assert.equal(typeof tx.register,'undefined');
 assert.equal(typeof tx.cli,'undefined');
 assert.equal(typeof tx.executeShell,'undefined');
});
