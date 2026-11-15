'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const p=require('./test-registrar-four-owner-preimage-v1.cjs');
test('four exact unique owner baselines and modes are pinned',()=>{
 assert.deepEqual(p.SPECS.map(x=>x.owner),['base','executor','mcp','policy']);
 assert.equal(new Set(p.SPECS.map(x=>x.name)).size,4);
 assert.equal(new Set(p.SPECS.map(x=>x.sha)).size,4);
 for(const x of p.SPECS){
  assert.match(x.sha,/^[a-f0-9]{64}$/);
  assert.ok(x.bytes>1000);
  assert.match(x.mode,/^0[0-7]{3}$/);
 }
});
test('unknown or stale owner content fails closed with no write',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-four-owner-'));
 try{
  for(const x of p.SPECS)fs.writeFileSync(path.join(d,x.name),'NOT-A-PINNED-OWNER\n');
  const original=fs.readFileSync(path.join(d,p.SPECS[0].name));
  assert.throws(()=>p.verify(d),/owner-size-drift:base/);
  assert.deepEqual(fs.readFileSync(path.join(d,p.SPECS[0].name)),original);
 }finally{fs.rmSync(d,{recursive:true,force:true})}
});
test('symbolic owner source is rejected',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-four-owner-symlink-'));
 try{
  fs.writeFileSync(path.join(d,'actual.js'),'placeholder');
  fs.symlinkSync(path.join(d,'actual.js'),path.join(d,'base.server.js'));
  assert.throws(()=>p.verify(d),/owner-copy-not-regular:base/);
 }finally{fs.rmSync(d,{recursive:true,force:true})}
});
test('unapproved policy version remains pinned until new reviewed bootstrap',()=>{
 assert.equal(p.VERSION,'2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1');
 assert.equal(p.NEW_ACTION,'prhm_action_registry_install_v1');
});
