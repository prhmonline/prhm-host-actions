const test=require('node:test');
const assert=require('node:assert/strict');
const up=require('./bootstrap-host-actions-v14-3-honartik-iticket-batch1-systemd-compat-v2.js');

test('V2 is bound to the post-V1 live Executor and removes only unsupported LockPersonality from Batch1',()=>{
  assert.equal(up.OLD_SHA,'7d5bb5148e06ba9f101250e07f46a9026caa2870373596a2cffe1aa4de468ccb');
  assert.equal(up.NEEDLE,",'--property=LockPersonality=true'");
});

test('V2 preserves the proven-supported RestrictNamespaces hardening and remains rollback-safe',()=>{
  const fs=require('node:fs'); const s=fs.readFileSync(__dirname+'/bootstrap-host-actions-v14-3-honartik-iticket-batch1-systemd-compat-v2.js','utf8');
  assert.match(s,/backup/); assert.match(s,/rollback/); assert.match(s,/restart/);
  assert.doesNotMatch(s,/ITICKET_ENABLED|X-Api-Access-Token/);
});
