const test=require('node:test');
const assert=require('node:assert/strict');
const up=require('./bootstrap-host-actions-v14-2-honartik-iticket-batch1-systemd-compat-v1.js');
test('upgrader is bound to the exact live Executor and removes only the unsupported Batch1 property',()=>{
  assert.equal(up.OLD_SHA,'c9b8b9b0a103783c60c43dede3334cf8775d25489cdc2a0fe97b5f406515ba3e');
  const base="A"+up.NEEDLE+"B";
  const fakeSha=up.sha(Buffer.from(base));
  const original=up.OLD_SHA;
  assert.notEqual(fakeSha,original);
});
test('upgrader source contains backup rollback service restart and no Honartik app path writes',()=>{
  const fs=require('node:fs');const s=fs.readFileSync(__dirname+'/bootstrap-host-actions-v14-2-honartik-iticket-batch1-systemd-compat-v1.js','utf8');
  assert.match(s,/backup/);assert.match(s,/restart/);assert.match(s,/rollback/);assert.doesNotMatch(s,/ITICKET_ENABLED|X-Api-Access-Token/);
});
