'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const mod=require('./solo-company-universal-existing-service-adoption-v1.js');
const profile=require('./solo-company-universal-adoption.production.candidate.json');
const good=()=>({
  systemd:{unit:'prhm-solo-company-runtime.service',
    active_state:'active',sub_state:'running',unit_file_state:'enabled',
    dynamic_user:true,protect_system:'strict'},
  release:{marker_path:'/opt/prhm-solo-company/.release-sha',
    marker_sha:mod.EXPECTED.release_sha,install_root:'/opt/prhm-solo-company'},
  network:{listening:'127.0.0.1:8782',publicly_exposed:false},
  state:{state_directory:'prhm-solo-company',root:'/var/lib/private/prhm-solo-company',
    persistent:true,data_mutated_by_admission:false},
  health:{http_status:200,body:{ok:true,state:'running',heartbeat_fresh:true}},
  status:{http_status:200,body:{state:'running',queue_depth:0,retrying:0,blocked:0,
    awaiting_approval:0,completed_total:0,failed_total:0,worker_busy:false}}
});
function invalid(mutator,regex){
  const data=good();mutator(data);
  assert.throws(()=>mod.verifyObservation(profile,data),regex);
}
test('static candidate is exact, unregistered and immutable in intent',()=>{
  assert.equal(mod.verifyCandidate(profile).registered,false);
  for(const key of ['allow_restart','allow_stop','allow_install','allow_mutate_state',
    'allow_open_public_route','managed_by_universal'])
    assert.equal(profile[key],false);
  assert.equal(profile.status,'SOURCE_ONLY_NO_GO');
  assert.equal(profile.runtime_installation_record,'OPERATIONAL_ACCEPTED_2026-11-03_PR233');
  assert.equal(profile.host_action_registration_state,'NOT_REGISTERED');
  assert.equal(profile.rollback_policy,'observe-only-preserve-state-and-unit');
  assert.equal(mod.EXPECTED.bind,'127.0.0.1:8782');
  assert.ok(!Object.keys(profile).some(k=>/password|secret|token|private_key/.test(k)));
});
test('valid dark-mode read-only observation passes but does not register/deploy',()=>{
  const result=mod.verifyObservation(profile,good());
  assert.equal(result.result,'READ_ONLY_ADMISSION_PASS_NOT_MANAGED');
  assert.equal(result.evidence.managed_by_universal,false);
  assert.equal(result.evidence.production_mutation,false);
  assert.match(result.evidence_sha256,/^[a-f0-9]{64}$/);
});
test('reject profile drift, public route and dangerous management flags',()=>{
  assert.throws(()=>mod.verifyCandidate({...profile,allow_restart:true}),/candidate_binding_invalid_allow_restart/);
  assert.throws(()=>mod.verifyCandidate({...profile,bind:'0.0.0.0:8782'}),/candidate_binding_invalid_bind/);
  assert.throws(()=>mod.verifyCandidate({...profile,unknown:'1'}),/profile_schema_invalid/);
  assert.throws(()=>mod.verifyCandidate({...profile,release_sha:'0'.repeat(64)}),/candidate_binding_invalid_release_sha/);
});
test('fail closed on inactive, disabled, unsandboxed service',()=>{
  invalid(o=>o.systemd.active_state='failed',/unit_not_healthy/);
  invalid(o=>o.systemd.unit_file_state='disabled',/unit_not_healthy/);
  invalid(o=>o.systemd.protect_system='full',/unit_not_healthy/);
  invalid(o=>o.systemd.dynamic_user=false,/unit_not_healthy/);
});
test('never adopt unpinned release or non-local network',()=>{
  invalid(o=>o.release.marker_sha='f'.repeat(64),/release_mismatch/);
  invalid(o=>o.network.publicly_exposed=true,/network_not_private/);
  invalid(o=>o.network.listening='0.0.0.0:8782',/network_not_private/);
});
test('persistent private state is mandatory',()=>{
  invalid(o=>o.state.root='/var/lib/prhm-solo-company',/persistent_state_unverified/);
  invalid(o=>o.state.persistent=false,/persistent_state_unverified/);
  invalid(o=>o.state.persistent=undefined,/persistent_state_unverified/);
  invalid(o=>o.state.data_mutated_by_admission=true,/persistent_state_unverified/);
});
test('health requires exact fresh successful responses',()=>{
  invalid(o=>o.health.http_status=500,/health_not_fresh/);
  invalid(o=>o.health.body.heartbeat_fresh=false,/health_not_fresh/);
  invalid(o=>o.health.body.ok=false,/health_not_fresh/);
});
test('must remain dark and entirely idle',()=>{
  for(const k of ['queue_depth','retrying','blocked','awaiting_approval','completed_total','failed_total'])
    invalid(o=>o.status.body[k]=1,/not_dark_or_not_idle/);
  invalid(o=>o.status.body.worker_busy=true,/not_dark_or_not_idle/);
  invalid(o=>{delete o.status.body.queue_depth},/not_dark_or_not_idle/);
});
test('there is no standalone operational CLI or side-effect API',()=>{
  const file=path.join(__dirname,'solo-company-universal-existing-service-adoption-v1.js');
  const code=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(code,/spawnSync\(|execSync\(|systemctl.*restart|fetch\(|https\.request\(|fs\.writeFile/);
  for(const k of ['install','deploy','apply','restart','activate','rollback'])
    assert.equal(typeof mod[k], 'undefined');
  const run=cp.spawnSync(process.execPath,[file],{encoding:'utf8'});
  assert.equal(run.status,64);
  assert.match(run.stderr,/NO_CLI/);
});
