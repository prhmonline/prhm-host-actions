'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const driver=require('./solo-company-runtime-owner-root-dispatcher-v1.cjs');
const tx=require('./solo-company-runtime-signed-registration-transaction-v1.js');

test('one-use receipt, transaction, and recovery paths are immutable',()=>{
  assert.equal(driver.RECEIPT_FILE,
    '/root/prhm-solo-trust-evidence/registration-l4.jws');
  assert.equal(driver.WORK_ROOT,
    '/var/lib/prhm-agent-selfmaint-exec/solo-owner-root-transactions-v1');
  assert.equal(driver.LEDGER,
    '/var/lib/prhm-agent-selfmaint-exec/solo-owner-root-receipts-v1');
  assert.deepEqual([...driver.OWNERS],[
    tx.TARGETS.approval,tx.TARGETS.executor,tx.TARGETS.mcp,tx.TARGETS.policy
  ]);
  assert.deepEqual([...driver.ASSETS],[tx.TARGETS.core,tx.TARGETS.worker]);
  assert.equal(driver.ASSETS.length+driver.OWNERS.length,6);
});
test('request ID is only a parser hint; malformed untrusted tokens fail',()=>{
  const claim={request_id:'77777777-7777-4777-8777-777777777777'};
  const payload=Buffer.from(JSON.stringify(claim)).toString('base64url');
  assert.equal(driver.requestIdFromToken('header.'+payload+'.signature'),
    claim.request_id);
  for(const token of ['', 'bad', 'x..y', 'a.b.c.d', 'a.$.c']){
    assert.throws(()=>driver.requestIdFromToken(token),/receipt_|request_id_/);
  }
  const missing=Buffer.from('{}').toString('base64url');
  assert.throws(()=>driver.requestIdFromToken('h.'+missing+'.s'),/request_id_invalid/);
});
test('dispatcher cannot be run without an explicit mode',()=>{
  const file=path.join(__dirname,'solo-company-runtime-owner-root-dispatcher-v1.cjs');
  const r=cp.spawnSync(process.execPath,[file],{encoding:'utf8'});
  assert.equal(r.status,64);
  assert.match(r.stderr,/NO_ACTION/);
  assert.equal(r.stdout,'');
  assert.equal(typeof driver.issueToken,'undefined');
  assert.equal(typeof driver.generateSigningKey,'undefined');
});
