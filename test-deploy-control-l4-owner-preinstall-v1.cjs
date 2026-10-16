'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const p=require('./deploy-control-l4-owner-preinstall-v1.cjs');
const inputs=[
  process.env.PRHM_L4_OWNER_HASHES_FIXTURE,
  process.env.PRHM_L4_ISSUER_FIXTURE,
  process.env.PRHM_L4_AGENT_HEALTH,
  process.env.PRHM_L4_POLICY_CANDIDATE
];
const snapshot=()=>({
  owners:JSON.parse(fs.readFileSync(inputs[0],'utf8')),
  issuer:JSON.parse(fs.readFileSync(inputs[1],'utf8')),
  registry:JSON.parse(fs.readFileSync(inputs[2],'utf8')),
  policyBytes:fs.readFileSync(inputs[3]),
  source:{...p.EXPECTED_SOURCE}
});
test('strict source-only API never imports install or approval operation',()=>{
  assert.deepEqual(Object.keys(p).sort(),['EXPECTED_SOURCE','TARGETS','preinstall'].sort());
  assert.equal(p.EXPECTED_SOURCE.repo,'prhmonline/prhm-company-control-plane');
  assert.equal(p.EXPECTED_SOURCE.commit,'acffc7f9e02073f7aaf6ba92777f7acff6481f81');
  assert.equal(Object.keys(p.TARGETS).length,4);
  assert.throws(()=>p.preinstall({owners:{}}),/unreviewed_owner_path/);
});
if(!inputs.every(Boolean)){
  test('real read-only issuer, owner, policy and registry fixtures are mandatory',
    {skip:'requires four independently verified read-only snapshot files'},()=>{});
}else{
  test('actual owner preimages, policy blob and live preinstall registry match',()=>{
    const result=p.preinstall(snapshot());
    assert.equal(result.ok,true);
    assert.equal(result.owner_sha256_checked,4);
    assert.equal(result.authorized,false);
    assert.equal(result.host_registered,false);
    assert.equal(result.can_install,false);
    assert.equal(result.can_consume_approval,false);
  });
  test('wrong owner bytes, unknown path, removed path and extra owner fail closed',()=>{
    const base=snapshot();
    for(const path of Object.keys(base.owners)){
      const a=snapshot();a.owners[path]='0'.repeat(64);
      assert.throws(()=>p.preinstall(a),/owner_preimage_sha_mismatch/);
    }
    const e=snapshot();e.owners['/etc/passwd']='0'.repeat(64);
    assert.throws(()=>p.preinstall(e),/unreviewed_owner_path/);
    const f=snapshot();delete f.owners[Object.keys(f.owners)[0]];
    assert.throws(()=>p.preinstall(f),/unreviewed_owner_path/);
  });
  test('candidate source commit, raw file and object drift all fail before registry',()=>{
    const x=snapshot();x.source.commit='f'.repeat(40);
    assert.throws(()=>p.preinstall(x),/source_git_identity_drift/);
    const y=snapshot();y.policyBytes=Buffer.from(y.policyBytes);
    y.policyBytes[y.policyBytes.length-1]^=1;
    assert.throws(()=>p.preinstall(y),/candidate_policy_provenance_drift/);
    const z=snapshot();z.source.hidden_grant=true;
    assert.throws(()=>p.preinstall(z),/source_git_identity_drift/);
  });
  test('issuer already changed, unsigned or disabled replay guard fail closed',()=>{
    const x=snapshot();x.issuer.policy_version=p.EXPECTED_SOURCE.version;
    assert.throws(()=>p.preinstall(x),/active_issuer_preimage_drift/);
    const y=snapshot();y.issuer.one_time_use=false;
    assert.throws(()=>p.preinstall(y),/active_issuer_preimage_drift/);
    const z=snapshot();z.issuer.algorithm='HS256';
    assert.throws(()=>p.preinstall(z),/active_issuer_preimage_drift/);
  });
  test('registry gaining a tool or losing health changes phase and refuses preinstall',()=>{
    const x=snapshot();x.registry.host_actions_v2.push('deploy_control_cutover_install_v1');
    assert.throws(()=>p.preinstall(x),/unrecognized_preinstall_registry_state/);
    const y=snapshot();y.registry.ok=false;
    assert.throws(()=>p.preinstall(y),/unrecognized_preinstall_registry_state/);
  });
  test('tampered policy cannot silently downgrade L4 to L3',()=>{
    const x=snapshot();
    const candidate=JSON.parse(x.policyBytes);
    candidate.operations['host_action.deploy_control_cutover_install_v1'].level=3;
    x.policyBytes=Buffer.from(JSON.stringify(candidate));
    assert.throws(()=>p.preinstall(x),/candidate_policy_provenance_drift/);
  });
}
