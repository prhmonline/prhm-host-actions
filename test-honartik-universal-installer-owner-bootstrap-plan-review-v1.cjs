'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const p=require('./honartik-universal-installer-owner-bootstrap-plan-review-v1.cjs');
const tx=require('./honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs');
const REG=require('./honartik-universal-installer-registration-review-pack-v1.cjs');
const exact=['base','executor','mcp','policy'];
test('review-only plan has exactly four owner paths and fixed action',()=>{
 assert.deepEqual(p.ORDER,exact);
 assert.deepEqual(Object.entries(p.PATHS),exact.map(k=>[k,REG.TARGETS[k].path]));
 assert.equal(p.ACTION,'honartik_universal_installer_upgrade_v1');
 assert.equal(p.REVIEW_ONLY,true);
 assert.equal(p.NO_PRODUCTION_WRITER,true);
 assert.equal(p.NO_APPROVAL_ISSUER,true);
 assert.equal(typeof p.apply,'undefined');
 assert.deepEqual(tx.KEYS,exact);
});
test('cannot accept arbitrary plan readers or forge owner bytes',()=>{
 assert.throws(()=>p.makeReviewPlan(),/readers_required/);
 assert.throws(()=>p.makeReviewPlan({
  readOwners:()=>Buffer.from('untrusted-production-owner'),
  readArtifacts:()=>Buffer.from('not-an-exact-git-blob'),
  readShim:()=>Buffer.from('unreviewed')
 }),/owner_sha_drift_base/);
});
test('no CLI installation and no live-action registration',()=>{
 assert.equal(typeof p.executeCore,'undefined');
 assert.equal(typeof p.runFixedRegisteredAction,'undefined');
 assert.equal(typeof p.issueApproval,'undefined');
 assert.equal(typeof tx.issueApproval,'undefined');
});
