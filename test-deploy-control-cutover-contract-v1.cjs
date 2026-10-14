'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const c=require('./deploy-control-cutover-contract-v1.cjs');

const validHealth=phase=>({
  ok:true,service:'prhm-company-approval',mode:'mcp-operator',
  algorithm:'Ed25519',one_time_use:true,
  policy_version:phase==='before'?c.CONTRACT.live_policy_version:c.CONTRACT.candidate_policy_version,
  policy_hash:phase==='before'?c.CONTRACT.live_policy_object_sha256:c.CONTRACT.candidate_policy_object_sha256
});
const allReviewEvidence=()=>Object.fromEntries(c.REVIEW_EVIDENCE.map(k=>[k,true]));

test('review contract cannot execute or request approval with runtime parameters',()=>{
  assert.equal(c.CONTRACT.action,'deploy_control_cutover_install_v1');
  assert.equal(c.CONTRACT.level,4);
  assert.equal(c.CONTRACT.risk,'critical');
  assert.equal(c.CONTRACT.production_mutation_allowed,false);
  assert.equal(c.CONTRACT.approval_required,true);
  assert.deepEqual(Object.keys(c.CONTRACT.source_shas).sort(),[
    'prhmonline/Honar-front-new','prhmonline/aranob','prhmonline/deploy-control',
    'prhmonline/honar-back-new','prhmonline/prhm-company-control-plane'].sort());
  assert.equal(Object.keys(c).includes('install'),false);
  assert.equal(Object.keys(c).includes('apply'),false);
  assert.equal(Object.keys(c).includes('consume'),false);
  assert.equal(Object.keys(c).includes('requestApproval'),false);
  assert.deepEqual(c.assertNoRuntimeInputs([]),{
    action:'deploy_control_cutover_install_v1',source_only:true,may_install:false
  });
  for(const args of [['/etc/sudoers'],['--apply'],['sha','secret'],['../../evil']]){
    assert.throws(()=>c.assertNoRuntimeInputs(args),/runtime_arguments_forbidden/);
  }
});

test('pinned live and proposed policy are different immutable identities',()=>{
  assert.equal(c.CONTRACT.live_policy_version,'2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1');
  assert.equal(c.CONTRACT.candidate_policy_version,'2026-10-14.1-deploy-control-exact-sha-scopes-v1');
  assert.match(c.CONTRACT.live_policy_raw_sha256,/^[a-f0-9]{64}$/);
  assert.match(c.CONTRACT.live_policy_object_sha256,/^[a-f0-9]{64}$/);
  assert.match(c.CONTRACT.candidate_policy_object_sha256,/^[a-f0-9]{64}$/);
  assert.notEqual(c.CONTRACT.live_policy_object_sha256,c.CONTRACT.candidate_policy_object_sha256);
});

test('typed scope shortlist exactly three projects, no wildcard',()=>{
  assert.deepEqual([...c.expectedProjects],['aranob','honartik_front','honartik_back']);
  assert.deepEqual(c.expectedIntegrity.allowed_remediation,['fix_forward','explicit_revert_commit']);
  assert.equal(c.expectedIntegrity.automatic_git_reset,false);
  assert.equal(c.expectedIntegrity.automatic_git_revert,false);
  assert.equal(c.expectedIntegrity.rollback_scope,'runtime_only');
});

test('issuer healthy with pinned before and after hash can be reviewed READ-ONLY',()=>{
  assert.equal(c.verifyIssuerHealth(validHealth('before'),'before').phase,'before');
  assert.equal(c.verifyIssuerHealth(validHealth('after'),'after').phase,'after');
});

test('reject stale policy after cutover, and premature candidate before cutover',()=>{
  assert.throws(()=>c.verifyIssuerHealth(validHealth('before'),'after'),/policy_version_or_hash_mismatch/);
  assert.throws(()=>c.verifyIssuerHealth(validHealth('after'),'before'),/policy_version_or_hash_mismatch/);
});

test('reject wrong identity, unsigned mode, disabled replay guard and malformed health',()=>{
  for(const health of [
    null,{}, {...validHealth('before'),ok:false},
    {...validHealth('before'),service:'wrong'},
    {...validHealth('before'),mode:'other'},
    {...validHealth('before'),algorithm:'HS256'},
    {...validHealth('before'),one_time_use:false}
  ]) assert.throws(()=>c.verifyIssuerHealth(health,'before'),/issuer_health_invalid/);
  assert.throws(()=>c.verifyIssuerHealth(validHealth('before'),'custom'),/phase_invalid/);
});

test('missing or mismatched raw preimage cannot be accepted',()=>{
  for(const live of [null,'text',Buffer.alloc(0),Buffer.from('{}'),Buffer.from('invalid'.repeat(100))])
    assert.throws(()=>c.verifyPolicyTransition(live,Buffer.alloc(1024)),/live_policy_invalid_buffer|live_policy_invalid_json|live_policy_preimage_drift/);
  assert.throws(()=>c.verifyPolicyTransition(Buffer.alloc(2048),Buffer.alloc(2048)),/live_policy_invalid_json/);
});

test('source-only evidence checklist remains a blocker, never an authorization',()=>{
  const ready=c.verifyReviewEvidence(allReviewEvidence());
  assert.deepEqual(ready,{
    source_review_ready:true,execution_authorized:false,
    requires:'independently_signed_one_time_level4_token',may_install:false
  });
  for(const k of c.REVIEW_EVIDENCE){
    const missing=allReviewEvidence();missing[k]=false;
    assert.throws(()=>c.verifyReviewEvidence(missing),new RegExp('review_missing_'+k));
  }
  for(const x of [undefined,null,{}, {...allReviewEvidence(),extra:true}]){
    assert.throws(()=>c.verifyReviewEvidence(x),/review_evidence_schema/);
  }
});

test('contract is source-only: no runtime filesystem, approval or exec entrypoint',()=>{
  const exported=Object.keys(c).sort();
  assert.deepEqual(exported,['CONTRACT','REVIEW_EVIDENCE','assertNoRuntimeInputs',
    'expectedIntegrity','expectedProjects','verifyIssuerHealth',
    'verifyPolicyTransition','verifyReviewEvidence'].sort());
});

const livePath=process.env.PRHM_CUTOVER_LIVE_POLICY_FIXTURE;
const proposedPath=process.env.PRHM_CUTOVER_CANDIDATE_POLICY_FIXTURE;
if(livePath&&proposedPath){
  const live=fs.readFileSync(livePath);
  const proposed=fs.readFileSync(proposedPath);
  test('actual Git-verified live-to-candidate policies preserve 75 operations and 52 scopes',()=>{
    const result=c.verifyPolicyTransition(live,proposed);
    assert.equal(result.ok,true);
    assert.equal(result.original_operations,75);
    assert.equal(result.preserved_typed_scopes,52);
    assert.equal(result.added_exact_deploy_scopes,3);
    assert.equal(result.source_only,true);
  });
  test('candidate tampering, additional scopes and version drift are refused',()=>{
    const p=JSON.parse(proposed.toString('utf8'));
    for(const mutate of [
      x=>x.typed_scopes.pop(),
      x=>x.typed_scopes.push({tool:'*',project:'*'}),
      x=>{x.operations['deploy.production'].level=0},
      x=>{x.deployment_integrity.automatic_git_reset=true},
      x=>{x.version='2026-10-02-stale'}
    ]){
      const clone=structuredClone(p);mutate(clone);
      assert.throws(()=>c.verifyPolicyTransition(live,Buffer.from(JSON.stringify(clone))),
        /candidate_policy_hash_drift|typed_scope_count_drift|policy_version_drift|operations_mutated_or_missing/);
    }
  });
  test('modified live policy preimage is refused',()=>{
    const tampered=Buffer.from(live);
    tampered[100]^=1;
    assert.throws(()=>c.verifyPolicyTransition(tampered,proposed),/live_policy_preimage_drift|live_policy_invalid_json/);
  });
}else{
  test('external authenticated live/candidate policy fixtures are required for full regression',{skip:'Supply both PRHM_CUTOVER_LIVE_POLICY_FIXTURE and PRHM_CUTOVER_CANDIDATE_POLICY_FIXTURE in isolated CI'},()=>{});
}
