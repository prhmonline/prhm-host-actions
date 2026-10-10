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

test('one-input prepare returns exact observed SHA and never authorizes deploy',()=>{
 const r=gate.prepare('rahekomak');
 assert.equal(r.mode,'prepare');
 assert.equal(r.release_authorized,false);
 assert.equal(r.deploy_executed,false);
 assert.equal(r.adapter_state,'manual_sha_bound_level4');
 if(r.pinned_sha===null){
  assert.equal(r.profile.ready,false);
  assert.ok(r.profile.blockers.some(x=>['root_missing','root_invalid','git_missing_or_invalid'].includes(x)));
 }else assert.match(r.pinned_sha,/^[a-f0-9]{40}$/);
 assert.equal(r.profile.project,'rahekomak');
 assert.throws(()=>gate.prepare('not_allowlisted'),/allowlisted/);
});
test('one-input prepare for unregistered project keeps deployment blocked',()=>{
 const r=gate.prepare('help');
 assert.equal(r.adapter_state,'adapter_missing');
 assert.equal(r.profile.ready,false);
 assert.equal(r.release_authorized,false);
});
test('inventory exposes cross-project readiness counts without deployment',()=>{
 const x=gate.main(['--all']);
 assert.equal(x.read_only,true);
 assert.ok(x.summary.adapter_missing>=1);
 assert.ok(x.summary.dirty_git>=0);
 assert.ok(x.summary.clean_git>=0);
 assert.equal(x.total,22);
});
