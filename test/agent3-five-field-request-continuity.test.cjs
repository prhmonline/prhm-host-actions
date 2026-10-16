'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const path=require('node:path');
const c=require('../ops/agent3-universal-backup/five-field-request-continuity.cjs');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const contract=require('../ops/agent3-universal-backup/registration-contract.cjs');
function valid(){
 return {
  action:gateway.ACTION,
  project:contract.PROJECT,
  source_commit:contract.SOURCE_COMMIT,
  manifest_commit:'b'.repeat(40),
  manifest_sha256:'c'.repeat(64)
 };
}
function stored(fields=valid()){
 const b=c.bind(fields);
 return {arguments:{...fields},arguments_sha256:b.arguments_sha256,
   request_hash:b.arguments_sha256};
}
test('all five fields are canonical, immutable in schema and match shared digest',()=>{
 const a=c.bind(valid());
 assert.equal(a.arguments_sha256,gateway.approvalBindingSha(valid()));
 assert.equal(a.canonical_json,gateway.canonicalArgs(valid()));
 assert.deepEqual(Object.keys(a.arguments).sort(),c.FIELDS.slice().sort());
 assert.equal(a.risk,'critical');
 assert.equal(a.approval_level,4);
 assert.equal(a.ttl_max_seconds,180);
 assert.equal(a.signed_approval_issued,false);
 assert.equal(a.signed_approval_consumed,false);
 assert.equal(a.production_mutation,false);
 const reordered=Object.fromEntries(Object.entries(valid()).reverse());
 assert.equal(c.bind(reordered).arguments_sha256,a.arguments_sha256);
});
test('request persistence and apply binding do not grant authorization',()=>{
 const s=stored();
 const r=c.compareStoredRequest({
  storedArguments:s.arguments,storedArgumentsSha256:s.arguments_sha256,
  storedRequestHash:s.request_hash,suppliedArguments:valid()
 });
 assert.equal(r.ok,true);
 assert.equal(r.authorization_granted,false);
 assert.equal(r.consumption_ledger_verified,false);
 const out=c.compareApplyBinding({
  persistedRequest:s,applyArguments:valid(),
  consumedArgumentsSha256:s.arguments_sha256
 });
 assert.equal(out.mode,'ARGUMENT_CONTINUITY_ONLY');
 assert.equal(out.stage,'APPLY_BINDING_ONLY');
 assert.equal(out.signed_approval_verified,false);
 assert.equal(out.consumed_approval_verified,false);
 assert.equal(out.approved_to_install,false);
});
test('action-only and unauthorized project, commit, digest or extra fields rejected',()=>{
 for(const args of [
  {action:gateway.ACTION},
  {...valid(),project:'honartik'},
  {...valid(),source_commit:'0'.repeat(40)},
  {...valid(),manifest_commit:'next'},
  {...valid(),manifest_sha256:'f'.repeat(60)},
  {...valid(),action:'host_action_v2_installer_v1'},
  {...valid(),approved:true},
  {...valid(),approvalToken:'notAllowed'},
  {...valid(),request_hash:'0'.repeat(64)},
  {...valid(),signature:'forged'}
 ])assert.throws(()=>c.bind(args));
});
test('tampered persisted hashes, request arguments or consumed digest fail closed',()=>{
 const base=stored();
 const supplied=valid();
 for(const delta of [
  {storedArgumentsSha256:'0'.repeat(64),storedRequestHash:base.request_hash},
  {storedArgumentsSha256:base.arguments_sha256,storedRequestHash:'0'.repeat(64)},
  {storedArgumentsSha256:'none',storedRequestHash:base.request_hash},
  {storedArgumentsSha256:base.arguments_sha256,storedRequestHash:'none'}
 ])assert.throws(()=>c.compareStoredRequest({
  storedArguments:base.arguments,suppliedArguments:supplied,...delta
 }));
 for(const changed of [
  {...supplied,manifest_commit:'d'.repeat(40)},
  {...supplied,manifest_sha256:'d'.repeat(64)}
 ])assert.throws(()=>c.compareStoredRequest({
  storedArguments:base.arguments,
  storedArgumentsSha256:base.arguments_sha256,
  storedRequestHash:base.request_hash,
  suppliedArguments:changed
 }),/request_arguments_changed/);
 assert.throws(()=>c.compareApplyBinding({
  persistedRequest:base,applyArguments:supplied,
  consumedArgumentsSha256:'f'.repeat(64)
 }),/consumed_hash_changed/);
});
test('no untrusted CLI or synthetic approval receipt can execute install',()=>{
 const f=path.join(__dirname,'../ops/agent3-universal-backup/five-field-request-continuity.cjs');
 const r=cp.spawnSync(process.execPath,[f,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(r.status,78);
 assert.match(r.stderr,/no CLI approval or apply/);
 assert.equal(typeof c.install, 'undefined');
 assert.equal(typeof c.issueApproval,'undefined');
 assert.equal(typeof c.consumeApproval,'undefined');
});
