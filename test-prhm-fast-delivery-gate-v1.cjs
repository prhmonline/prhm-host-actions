'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const gate=require('./prhm-fast-delivery-gate-v1.cjs');
test('all 22 Agent3 configured projects are allowlisted',()=>{
 assert.equal(Object.keys(gate.PROFILES).length,22);
 assert.ok(gate.PROFILES.rahekomak);
 assert.ok(gate.PROFILES.drtarjomeh_prod);
 assert.ok(gate.PROFILES.imotion_front_prod);
});
test('all profiles have absolute fixed roots and fixed stack/adapter',()=>{
 for(const [id,p] of Object.entries(gate.PROFILES)){
  assert.match(id,/^[a-z0-9_]+$/);assert.ok(p.root.startsWith('/'));
  assert.ok(!p.root.includes('..'));assert.ok(p.stack);assert.ok(p.adapter);
 }
});
test('untrusted project IDs, commands, shell input and SHA denied',()=>{
 assert.throws(()=>gate.inspect('../etc/passwd'),/allowlisted/);
 assert.throws(()=>gate.inspect('rahekomak',{sha:'main'}),/40_hex/);
 assert.throws(()=>gate.main(['--apply','rahekomak']),/usage/);
 assert.throws(()=>gate.main(['--project','rahekomak','--sha','; rm -rf /']),/40_hex/);
});
test('known project with invalid sha is denied before filesystem access',()=>{
 assert.throws(()=>gate.inspect('drtarjomeh_prod',{sha:'not-a-sha'}),/40_hex/);
});
test('unregistered adapters cannot be release-ready',()=>{
 const r=gate.inspect('drtarjomeh_prod',{sha:'a'.repeat(40)});
 assert.equal(r.ready,false);
});
test('read-only complete inventory handles missing roots',()=>{
 const r=gate.main(['--all']);assert.equal(r.mode,'inventory');
 assert.equal(r.total,22);assert.equal(r.profiles.length,22);
 assert.ok(r.profiles.every(x=>x.ready===false));
});
