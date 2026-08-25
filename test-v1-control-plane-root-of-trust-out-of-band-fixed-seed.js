'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const p=require('./control-plane-root-of-trust-out-of-band-fixed-seed-v1.js');

const LIVE=Object.freeze({
 base:'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',
 executor:'1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',
 mcp:'44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71',
 policy:'76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'
});

test('fixed seed contract and artifact bindings',()=>{
 assert.equal(p.SEED_ACTION,'control_plane_root_of_trust_out_of_band_fixed_seed_v1');
 assert.equal(p.TARGET_ACTION,'control_plane_typed_bootstrap_fixed_verifier_native_install_v1');
 assert.deepEqual(p.EXPECTED_BASELINES,LIVE);
 assert.equal(p.BOUND_ARTIFACTS.installer_implementation.sha256,'eeeccf448d9792ea69df4313864374945684e7cbb1ae6b0eedfa37b84d51f369');
 assert.equal(p.BOUND_ARTIFACTS.installer_test.sha256,'7fb9e74d823dafc967928b65ef16bff74489d108aa2642399c027da660708a8c');
 assert.equal(p.BOUND_ARTIFACTS.installer_manifest.sha256,'a75182d3a5160b38e27e396765e0a7fd9d1aed5e556e2f6b566c5dcdcca29d99');
 assert.equal(p.BOUND_ARTIFACTS.verifier.sha256,'f5e3cb6a9ce6c88229ffbd2fafd1e48742562f8c3edbc7aac113e2cb4f292b5a');
});

test('execution contract is zero-input and one-shot',()=>{
 assert.equal(p.runFixedSeed.length,0);
 const c=p.validateSeedExecutionContract({});
 assert.equal(c.zero_input,true); assert.equal(c.one_shot,true); assert.equal(c.park_production_mutation,false);
 for(const k of ['command','path','repo','url','sql','host','service','payload','artifact','network']) assert.throws(()=>p.validateSeedExecutionContract({[k]:'x'}),/arbitrary_input_rejected/);
});

test('preflight fails closed on each baseline drift',()=>{
 for(const k of Object.keys(LIVE)){const x={...LIVE,[k]:'0'.repeat(64)};assert.throws(()=>p.verifySeedPreflight(x,p.BOUND_ARTIFACTS),new RegExp('baseline_drift:'+k));}
});

test('preflight fails closed on any bound artifact mismatch',()=>{
 for(const k of Object.keys(p.BOUND_ARTIFACTS)){const a=JSON.parse(JSON.stringify(p.BOUND_ARTIFACTS));a[k].sha256='0'.repeat(64);assert.throws(()=>p.verifySeedPreflight(LIVE,a),new RegExp('artifact_sha_mismatch:'+k));}
});

test('promotion planner touches exactly fixed surfaces and helper',()=>{
 const fx=p.makeTestFixtures(); const r=p.planSeedPromotion(fx,LIVE,p.BOUND_ARTIFACTS);
 assert.equal(r.changed,true); assert.deepEqual(Object.keys(r.after).sort(),['base','executor','helper','mcp','policy'].sort());
 assert.match(r.after.base,/control_plane_typed_bootstrap_fixed_verifier_native_install_v1/);
 assert.match(r.after.executor,/control_plane_typed_bootstrap_fixed_verifier_native_install_v1/);
 assert.match(r.after.mcp,/control_plane_typed_bootstrap_fixed_verifier_native_install_v1/);
 const po=JSON.parse(r.after.policy); assert.equal(po.operations['host_action.control_plane_typed_bootstrap_fixed_verifier_native_install_v1'].level,4);
 assert.equal(r.invariants.fixed_service_allowlist,true); assert.equal(r.invariants.park_production_mutation,false);
});

test('planner rejects missing, ambiguous, or conflicting registration anchors',()=>{
 const fx=p.makeTestFixtures();
 for(const k of ['base','executor','mcp']){const m={...fx,[k]:'no anchor here'};assert.throws(()=>p.planSeedPromotion(m,LIVE,p.BOUND_ARTIFACTS),new RegExp(k+'_anchor_missing'));}
 const amb={...fx,base:fx.base+'\n'+fx.base}; assert.throws(()=>p.planSeedPromotion(amb,LIVE,p.BOUND_ARTIFACTS),/base_anchor_ambiguous/);
 const c={...fx,mcp:fx.mcp+' control_plane_typed_bootstrap_fixed_verifier_native_install_v1 '};assert.throws(()=>p.planSeedPromotion(c,LIVE,p.BOUND_ARTIFACTS),/mcp_target_conflict/);
});

test('transaction rolls back exact before-images at every partial failure point',()=>{
 const fx=p.makeTestFixtures();
 for(const point of ['base','executor','mcp','policy','helper','reload']){const r=p.simulateSeedTransaction(fx,point);assert.equal(r.ok,false);assert.equal(r.rollbackPerformed,true);assert.deepEqual(r.state,fx);assert.equal(r.consumed,false);}
});

test('success consumes seed and second run never reapplies writes',()=>{
 const fx=p.makeTestFixtures(); const r=p.simulateSeedTransaction(fx,null);assert.equal(r.ok,true);assert.equal(r.rollbackPerformed,false);assert.equal(r.consumed,true);
 const r2=p.simulateSeedTransaction(r.state,null,{consumed:true});assert.equal(r2.ok,true);assert.equal(r2.changed,false);assert.equal(r2.status,'already_consumed');
});

test('forbidden surfaces are absent from implementation source',()=>{
 const src=fs.readFileSync('./control-plane-root-of-trust-out-of-band-fixed-seed-v1.js','utf8');
 for(const s of ['sshpass','systemd-run','park_bazar_migrate_v1','DROP DATABASE','CREATE DATABASE','process.argv','execSync(','spawnSync(','child_process','ReadWritePaths=','ProtectHome=','http://','https://']) assert.equal(src.includes(s),false,s);
});
