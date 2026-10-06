'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

const FILE='./safe-delivery-v30-agent3-bootstrap-capability-v1.js';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

test('bootstrap capability is fixed to reviewed V30 bridge',()=>{
  const m=require(FILE);
  assert.equal(m.ACTION,'safe_delivery_v30_agent3_bootstrap_v1');
  assert.equal(m.BRIDGE_COMMIT,'750ebbe8fdd27dc63968519f56d2819076a2f4c4');
  assert.equal(m.BRIDGE_SHA256,'fbb5b5930235414b03b1260edb96868ceea735462e000d7562a8ce458f97f617');
  assert.equal(m.BRIDGE_URL,'https://raw.githubusercontent.com/prhmonline/prhm-host-actions/750ebbe8fdd27dc63968519f56d2819076a2f4c4/bootstrap-host-actions-v30-safe-delivery-candidate-install-bridge.js');
  assert.deepEqual(m.MODES,['--preflight-only','--apply']);
});

test('capability has no arbitrary caller-controlled execution surface',()=>{
  const src=fs.readFileSync(FILE,'utf8');
  for(const bad of ['callerContent','callerPath','destinationPath','req.body','process.env.TARGET','eval(','child_process.exec(']) assert.equal(src.includes(bad),false,bad);
  const m=require(FILE);
  assert.equal(m.parseMode(['--preflight-only']),'--preflight-only');
  assert.equal(m.parseMode(['--apply']),'--apply');
  assert.throws(()=>m.parseMode([]),/unexpected_arguments/);
  assert.throws(()=>m.parseMode(['--apply','x']),/unexpected_arguments/);
});

test('preflight/apply both require exact downloaded bridge SHA and apply delegates only to bridge',()=>{
  const m=require(FILE);
  const p=m.preflight.toString(),a=m.apply.toString();
  assert.ok(p.includes('fetchBridge'));
  assert.ok(p.includes('BRIDGE_SHA256'));
  assert.ok(a.includes('fetchBridge'));
  assert.ok(a.includes("'--apply'"));
  assert.equal(a.includes('profile-enablement.json'),false);
  assert.equal(a.includes('cfpark_front_prod'),false);
});

test('capability source is syntax-valid and immutable under its exported SHA helper',()=>{
  const bytes=fs.readFileSync(FILE);
  assert.equal(sha(bytes),require(FILE).SOURCE_SHA256(bytes));
});
