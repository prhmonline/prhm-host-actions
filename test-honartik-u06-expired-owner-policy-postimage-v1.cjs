'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const C=require('./honartik-u06-expired-owner-policy-postimage-v1.cjs');
const Admission=require('./honartik-u06-expired-owner-reconcile-l4-consumed-v1.cjs');
const Pre=require('./honartik-u06-expired-owner-four-owner-preflight-v1.cjs');
test('exact reviewed policy preimage and postimage SHA256 are pinned and different',()=>{
 assert.equal(C.BEFORE_SHA256,Pre.SHA256.approval_policy);
 assert.equal(C.BEFORE_SHA256,
  'aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934');
 assert.equal(C.AFTER_SHA256,
  'f9af71eea8933792a7a518c9d7fc1d85a87afa80cda0c4716002f2fb39dec235');
 assert.equal(C.AFTER_BYTES,32919);
 assert.equal(C.ISSUER_POLICY_HASH_SHA256,
  'b47c09eec7db73608caea8cea2967dbb08eab7d75211df4073cbaeec231474fe');
 assert.equal(C.POLICY_FILE,
  '/opt/prhm-company-control-plane/config/approval-policy.json');
 assert.notEqual(C.BEFORE_SHA256,C.AFTER_SHA256);
 assert.equal(Admission.OPERATION,
  'host_action.honartik_u06_expired_owner_oidc_reconcile_v1');
});
test('wrong original file is never accepted for postimage production plan',()=>{
 assert.throws(()=>C.generatePinnedPolicyPostimage(Buffer.from('{}')),
  /live_policy_preimage_drift/);
 assert.throws(()=>C.generatePinnedPolicyPostimage(Buffer.alloc(400,'a')),
  /live_policy_preimage_drift/);
 assert.throws(()=>C.generatePinnedPolicyPostimage('fake'),
  /live_policy_preimage_drift/);
});
test('no policy writer, signer, privileged CLI or approval issuer exposed',()=>{
 assert.equal(C.PRODUCTION_APPLY_EXPORTED,false);
 assert.equal(C.APPROVAL_ISSUER,false);
 assert.equal(C.ROOT_INSTALLER,false);
 assert.equal(C.apply,undefined);
 assert.equal(C.install,undefined);
 assert.equal(C.authorize,undefined);
 const file=path.join(__dirname,
  'honartik-u06-expired-owner-policy-postimage-v1.cjs');
 const run=spawnSync(process.execPath,[file],{encoding:'utf8'});
 assert.equal(run.status,64);
 assert.match(run.stderr,/No direct policy installation/);
 assert.equal(run.stdout,'');
 const source=fs.readFileSync(file,'utf8');
 assert.doesNotMatch(source,
  /child_process|execSync|spawnSync|unlinkSync|writeFileSync|mkdirSync|renameSync|systemctl/);
});
