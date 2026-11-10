'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {POLICY,classify,KINDS}=require('./prhm-owner-controlled-delivery-policy-v1.cjs');

test('ordinary code needs no external Provider, L4, Host Action',()=>{
  assert.equal(POLICY.ordinary_development_external_provider_required,false);
  assert.equal(POLICY.ordinary_development_level4_required,false);
  assert.equal(POLICY.ordinary_development_host_action_registration_required,false);
  const x=classify('git_change');
  assert.equal(x.external_provider_approval_required,false);
  assert.equal(x.source_only_git_can_proceed,true);
  assert.equal(x.production_approved,false);
});
test('read only server audits do not depend on external Provider',()=>{
  const x=classify('read_only_host_audit');
  assert.equal(x.external_provider_approval_required,false);
  assert.equal(x.read_only_audit_can_proceed,true);
  assert.equal(x.needs_owner_production_authorization,false);
});
test('production moves to owner approval, never anonymous automated release',()=>{
  const x=classify('production_mutation');
  assert.equal(POLICY.production_external_provider_required,false);
  assert.equal(x.needs_owner_production_authorization,true);
  assert.equal(x.production_approved,false);
  assert.equal(POLICY.production_auto_deploy_enabled,false);
});
test('exact SHA, existing host integrity, backup, rollback and audit remain',()=>{
  const x=classify('production_mutation');
  assert.deepEqual(x.review_checks,[
    'source_sha_pinned','owner_environment_approval_verified',
    'host_scope_verified','native_backup_restore_verified',
    'rollback_test_verified','audit_log_configured'
  ]);
  assert.equal(POLICY.production_requires_exact_git_sha,true);
  assert.equal(POLICY.production_requires_backup_restore_evidence,true);
  assert.equal(POLICY.production_requires_health_and_rollback,true);
});
test('caller fabricated green flags never issue permission',()=>{
  const x=classify('production_mutation',{
    source_sha_pinned:true,owner_environment_approval_verified:true,
    host_scope_verified:true,native_backup_restore_verified:true,
    rollback_test_verified:true,audit_log_configured:true,
    'skip-audit':true
  });
  assert.equal(x.production_approved,false);
  assert.equal(x.action_registered,false);
  assert.equal(x.level4_token_issued,false);
  assert.equal(x.production_mutated,false);
});
test('cannot spoof operation class or inject runtime action',()=>{
  assert.throws(()=>classify('root_exec'),/unknown_operation_type/);
  assert.throws(()=>classify('production_mutation',null),/invalid_assessment/);
  assert.deepEqual(KINDS,['git_change','read_only_host_audit','production_mutation']);
});
test('existing owner OIDC path is scoped, not automatically a deploy credential',()=>{
  assert.match(POLICY.owner_recovery_workflow,/universal-owner-recovery-oidc-v1.yml/);
  assert.equal(POLICY.owner_approval_is_not_source_review,true);
  assert.equal(POLICY.owner_approval_is_not_host_execution_authority,true);
  assert.equal(POLICY.root_executor_remains_confined,true);
});
