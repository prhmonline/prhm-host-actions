'use strict';
/**
 * Mandatory red-gate review tests for the NOT INSTALLED production L4
 * registration candidate. These tests intentionally fail on missing
 * fail-closed receipt validation; never lower these assertions to green.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const reg=require('./honartik-open-price-live-registration-v1.cjs');
const source=fs.readFileSync(require.resolve('./honartik-open-price-live-registration-v1.cjs'),'utf8');

test('installer is source-only and has no direct CLI execution',()=>{
 const {spawnSync}=require('node:child_process');
 const result=spawnSync(process.execPath,['honartik-open-price-live-registration-v1.cjs'],
  {encoding:'utf8',timeout:10000,cwd:__dirname});
 assert.equal(result.status,2);
 assert.match(result.stderr,/No CLI/);
 assert.equal(reg.INSTALL_OP,'host_action.honartik_open_price_live_migrations_registration_v1');
 assert.notEqual(reg.INSTALL_OP,reg.LIVE_OP);
});

test('installer candidate pins exact reviewed source git blobs and root paths',()=>{
 assert.equal(reg.SOURCES.coordinator.gitBlob,'a41caf2bfe8e4ea9a476aec3123606cbf1b92cbb');
 assert.equal(reg.SOURCES.adapter.gitBlob,'447508cbeab5a39b1250f9492acd92f7b05e1142');
 const paths=Object.values(reg.OWNERS).map(o=>o.path);
 assert.equal(new Set(paths).size,4);
 assert.ok(paths.every(p=>p.startsWith('/opt/')||p.startsWith('/home/agent/')));
});

test('Level-4 installation receipt MUST explicitly prove one-time=true',()=>{
 // Prior contract used !==false, which mistakenly accepts undefined.
 assert.match(source,/\breceipt\.oneTime\s*!==\s*true\b/,
  'BLOCK: missing or non-true oneTime property must reject registration');
});
test('installer receipt MUST explicitly forbid DDL grant (false required)',()=>{
 // Prior contract used ===true, which mistakenly accepts undefined.
 assert.match(source,/\breceipt\.liveDDLAuthorized\s*!==\s*false\b/,
  'BLOCK: missing or non-false liveDDLAuthorized must reject registration');
});
test('issuer receipt MUST bind fixed owner-file SHA256 map, not only request',()=>{
 assert.match(source,/\breceipt\.ownerSha256\b/,
  'BLOCK: receipt does not bind current root owner preimages');
});
test('issuer receipt MUST bind both immutable source Git blobs, not only request',()=>{
 assert.match(source,/\breceipt\.reviewedSourceBlobs\b/,
  'BLOCK: receipt does not bind actual reviewed coordinator + native adapter blobs');
});

function validReceiptFixture(){
 const digests=Object.fromEntries(reg.KEYS.map((k,i)=>[k,String(i+1).repeat(64)]));
 const ownerSha256=Object.fromEntries(
   Object.entries(reg.OWNERS).map(([k,v])=>[k,v.sha256]));
 const reviewedSourceBlobs=Object.fromEntries(
   Object.entries(reg.SOURCES).map(([k,v])=>[k,v.gitBlob]));
 const receipt={
   consumed:true,issuerChecked:true,oneTime:true,liveDDLAuthorized:false,
   level:4,risk:'critical',action:reg.ACTION,operation:reg.INSTALL_OP,
   requestId:'test-only-signed-grant-fixture-0001',
   candidateSha256:digests,ownerSha256,reviewedSourceBlobs
 };
 return {receipt,digests};
}
test('pure receipt validator accepts exact structurally bound test fixture',()=>{
 const {receipt,digests}=validReceiptFixture();
 assert.equal(reg.verifyInstallReceipt(receipt,digests),true);
});
test('runtime denies missing, false and null one-time evidence',()=>{
 const {receipt,digests}=validReceiptFixture();
 for(const value of [undefined,false,null]){
   assert.throws(()=>reg.verifyInstallReceipt({...receipt,oneTime:value},digests),
     /signed_install_scope_mismatch/);
 }
});
test('runtime denies missing and non-false separate live-DDL authorization flag',()=>{
 const {receipt,digests}=validReceiptFixture();
 for(const value of [undefined,true,null]){
   assert.throws(()=>reg.verifyInstallReceipt({...receipt,liveDDLAuthorized:value},digests),
     /signed_install_scope_mismatch/);
 }
});
test('runtime denies missing, incomplete or mismatched owner preimages',()=>{
 const {receipt,digests}=validReceiptFixture();
 for(const ownerSha256 of [undefined,{},{
  ...receipt.ownerSha256,policy:'0'.repeat(64)
 }]){
   assert.throws(()=>reg.verifyInstallReceipt({...receipt,ownerSha256},digests),
     /signed_install_scope_mismatch/);
 }
});
test('runtime denies missing, incomplete or mismatched reviewed source blobs',()=>{
 const {receipt,digests}=validReceiptFixture();
 for(const reviewedSourceBlobs of [undefined,{},{
  ...receipt.reviewedSourceBlobs,adapter:'0'.repeat(40)
 }]){
   assert.throws(()=>reg.verifyInstallReceipt({...receipt,reviewedSourceBlobs},digests),
     /signed_install_scope_mismatch/);
 }
});
test('runtime denies invalid level, issuer, action, operation and candidate digest',()=>{
 const {receipt,digests}=validReceiptFixture();
 for(const mod of [
  {level:3},{issuerChecked:false},{risk:'high'},
  {operation:reg.LIVE_OP},{action:'arbitrary_action'},
  {candidateSha256:{...receipt.candidateSha256,policy:'0'.repeat(64)}},
  {consumed:false}
 ]){
   assert.throws(()=>reg.verifyInstallReceipt({...receipt,...mod},digests),
     /signed_install_scope_mismatch/);
 }
});
