'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const f=require('./deploy-control-cutover-fixture-v1.cjs');
const c=require('./deploy-control-cutover-contract-v1.cjs');
const P=f.PATHS;
const issuer=phase=>({
  ok:true,service:'prhm-company-approval',mode:'mcp-operator',algorithm:'Ed25519',
  one_time_use:true,
  policy_version:phase==='before'?c.CONTRACT.live_policy_version:c.CONTRACT.candidate_policy_version,
  policy_hash:phase==='before'?c.CONTRACT.live_policy_object_sha256:c.CONTRACT.candidate_policy_object_sha256
});
const livePath=process.env.PRHM_CUTOVER_LIVE_POLICY_FIXTURE;
const newPath=process.env.PRHM_CUTOVER_CANDIDATE_POLICY_FIXTURE;
const helperPath=process.env.PRHM_CUTOVER_DISPATCHER_FIXTURE;
const corePath=process.env.PRHM_CUTOVER_CORE_FIXTURE;
const sudoPath=process.env.PRHM_CUTOVER_SUDOERS_FIXTURE;
const haveAll=[livePath,newPath,helperPath,corePath,sudoPath].every(Boolean);

test('module has no host installer, approval consumer or privileged apply operation',()=>{
  assert.deepEqual(Object.keys(f).sort(),[
    'CHECKPOINTS','PATHS','checksum','rejectUnwiredDispatcher','simulate'].sort());
  assert.deepEqual(f.CHECKPOINTS,[
    'policy_written','helper_written','core_written','sudoers_swapped','health_check'
  ]);
  assert.throws(()=>f.simulate({mode:'production',state:new Map()}),/fixture_mode_or_schema/);
  assert.throws(()=>f.simulate({mode:'isolated-memory-fixture',state:new Map(),command:'sudo true'}),/fixture_mode_or_schema/);
});

test('reject malformed, caller-extensible or non-buffer initial state',()=>{
  assert.throws(()=>f.checksum(new Map([['foo','not-buffer']])),/./); // explicitly not a host read
  assert.throws(()=>f.simulate({mode:'isolated-memory-fixture',state:new Map([['bad','value']])}),/invalid_fixture_value/);
});

if(!haveAll){
  test('full fixture run requires five independent verified source files',{skip:'Set five fixture paths from the actual GitHub blobs and read-only live policy'},()=>{});
}else{
  const live=fs.readFileSync(livePath),candidate=fs.readFileSync(newPath);
  const helper=fs.readFileSync(helperPath),core=fs.readFileSync(corePath);
  const sudo=fs.readFileSync(sudoPath);
  const legacyAranob=Buffer.from('deploy-runner ALL=(prhm) NOPASSWD: /home/prhm/deploy/aranob-production.sh *\n');
  const legacyHonartik=Buffer.from(
    'deploy-runner ALL=(root) NOPASSWD: /usr/local/libexec/deploy-control/honartik-front-production *\n'+
    'deploy-runner ALL=(honartik) NOPASSWD: /usr/local/libexec/deploy-control/honartik-back-production *\n');
  const files=()=>new Map([
    [P.POLICY,Buffer.from(live)], [P.ARANOB,Buffer.from(legacyAranob)],
    [P.HONARTIK,Buffer.from(legacyHonartik)]
  ]);
  const authentic=()=>({mode:'isolated-memory-fixture',state:files(),policyCandidate:candidate,
    dispatcher:helper,core,gatedSudoers:sudo,issuerBefore:issuer('before'),issuerAfter:issuer('after')});
  const fakeRepaired=()=>{
    // This is a SYNTHETIC in-memory testing modification of the *unwired*
    // real dispatcher. The synthetic bytes are never committed as a production
    // dispatcher or accepted as a reviewed source SHA.
    const original=helper.toString('utf8');
    assert.match(original,/import \{ assertRelease, consumeApprovedRelease \}/);
    assert.match(original,/  const release = await consumeApprovedRelease\(/);
    const patched=original
      .replace('import { assertRelease, consumeApprovedRelease }','import { assertRelease, consumeApprovedRelease, verifyIssuerPolicy }')
      .replace('  const release = await consumeApprovedRelease(',
        "  await verifyIssuerPolicy({ baseUrl: config.base_url, expectedPolicyVersion: config.expected_policy_version, expectedPolicyHash: config.expected_policy_hash });\n  const release = await consumeApprovedRelease(");
    return {...authentic(),dispatcher:Buffer.from(patched)};
  };
  test('current actual central source is BLOCKED because issuer attestation is not wired',()=>{
    const x=authentic();
    assert.throws(()=>f.rejectUnwiredDispatcher(x.dispatcher,x.core),
      /issuer_attestation_not_wired/);
    assert.throws(()=>f.simulate(x),/issuer_attestation_not_wired/);
    assert.equal(x.state.has(P.GATE),false);
  });
  test('synthetic future-wired source permits an IN-MEMORY-only rehearsal',()=>{
    const x=fakeRepaired(),before=f.checksum(x.state);
    const r=f.simulate(x);
    assert.equal(r.ok,true);assert.equal(r.fixture_only,true);
    assert.equal(r.installed_on_host,false);assert.equal(r.execution_authorized,false);
    assert.equal(r.simulated_state.has(P.ARANOB),false);
    assert.equal(r.simulated_state.has(P.HONARTIK),false);
    assert.equal(r.simulated_state.has(P.GATE),true);
    assert.equal(r.simulated_state.get(P.POLICY).equals(candidate),true);
    assert.equal(f.checksum(x.state),before);
    assert.deepEqual(r.checkpoints,[...f.CHECKPOINTS]);
  });
  for(const failureAt of f.CHECKPOINTS){
    test('synthetic rollback restores exact bytes after fault '+failureAt,()=>{
      const x={...fakeRepaired(),failureAt},original=f.checksum(x.state);
      const r=f.simulate(x);
      assert.equal(r.ok,false);
      assert.equal(r.rollback_simulated,true);
      assert.equal(r.execution_authorized,false);
      assert.equal(r.original_state_unchanged,true);
      assert.equal(f.checksum(r.restored_state),original);
      assert.equal(r.restored_state.has(P.GATE),false);
      assert.equal(r.restored_state.has(P.HELPER),false);
      assert.equal(r.restored_state.has(P.CORE),false);
      assert.equal(r.restored_state.get(P.POLICY).equals(live),true);
    });
  }
  test('unexpected preexisting sudo grant blocks before even fixture mutation',()=>{
    const x=fakeRepaired();x.state.delete(P.HONARTIK);
    assert.throws(()=>f.simulate(x),/preimage_missing/);
  });
  test('candidate sudoers drift is rejected, including wildcard ALL',()=>{
    const x=fakeRepaired();x.gatedSudoers=Buffer.from(
      sudo.toString('utf8')+'deploy-runner ALL=(root) NOPASSWD: ALL\n'
    );
    assert.throws(()=>f.simulate(x),/candidate_sudoers_drift/);
  });
  test('stale or false active issuer policy fails before any simulation',()=>{
    const x=fakeRepaired();x.issuerBefore=issuer('after');
    assert.throws(()=>f.simulate(x),/issuer_policy_version_or_hash_mismatch/);
  });
  test('unhealthy proposed issuer health triggers memory rollback',()=>{
    const x=fakeRepaired();x.issuerAfter={...issuer('after'),ok:false};
    const result=f.simulate(x);
    assert.equal(result.ok,false);
    assert.equal(result.rollback_simulated,true);
    assert.equal(result.error.includes('issuer_health_invalid'),true);
    assert.equal(f.checksum(result.restored_state),f.checksum(x.state));
  });
  test('untrusted core without health export blocks the fixture',()=>{
    const x=fakeRepaired();x.core=Buffer.from('export function consumeApprovedRelease(){}');
    assert.throws(()=>f.simulate(x),/issuer_attestation_not_wired/);
  });
  test('bad failure injection selector is rejected',()=>{
    const x={...fakeRepaired(),failureAt:'delete_everything'};
    assert.throws(()=>f.simulate(x),/failure_injection_unknown/);
  });
}
