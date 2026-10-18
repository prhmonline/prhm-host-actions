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
 assert.equal(reg.SOURCES.coordinator.gitBlob,'f18b83a2266a38637e6b945ca4a75aee75f92145');
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
