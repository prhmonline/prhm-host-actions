'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const m=require('./honartik-u06-native-backup-registration-review-v1.cjs');
const EXPECTED=m.EXPECTED;
const good=()=>Object.fromEntries(m.STATUS_KEYS.map(x=>[
  x,x.endsWith('_sha256')?'a'.repeat(64):true
]));
const matching=()=>{
  const x=good();
  x.adapter_sha256=EXPECTED.installed_native_adapter_sha256;
  x.profile_sha256=EXPECTED.installed_production_profile_sha256;
  return x;
};
test('fixed U06 identity and legitimate exact hash preimages',()=>{
  assert.equal(m.ACTION,'honartik_u06_native_backup_register_v1');
  assert.equal(EXPECTED.operation,'host_action.'+m.ACTION);
  assert.equal(EXPECTED.project,'honartik_back.production');
  assert.equal(EXPECTED.level,4);
  assert.equal(EXPECTED.installed_native_adapter_sha256.length,64);
  assert.equal(EXPECTED.installed_production_profile_sha256.length,64);
  assert.equal(EXPECTED.signed_root_registration_authority_pinned,false);
  assert.equal(EXPECTED.installed_host_action_binding,false);
});
test('no executable entrypoint or registration method',()=>{
  assert.equal(m.cli,undefined);
  assert.equal(m.register,undefined);
  assert.equal(m.apply,undefined);
  assert.equal(m.execute,undefined);
  assert.deepEqual(m.noRuntimeArguments([]),{
    action:m.ACTION,source_only:true,installed:false,
    registration_authorized:false,production_deploy_authorized:false
  });
});
test('never accept caller-controlled shell, path, SQL or flags',()=>{
  for(const args of [['--apply'],['--root'],['--command','bash'],['--mysql-password','x']]){
    assert.throws(()=>m.noRuntimeArguments(args),/runtime_arguments_forbidden/);
  }
  assert.throws(()=>m.noRuntimeArguments(''),/runtime_arguments_forbidden/);
});
test('exact four scoped MySQL grants without admin, DDL or application deploy',()=>{
  assert.deepEqual(EXPECTED.mysql_privileges,['SELECT','SHOW VIEW','TRIGGER','EVENT']);
  assert.equal(EXPECTED.mysql_host,'127.0.0.1');
  assert.equal(EXPECTED.mysql_database,'honartik_db');
  assert.equal(EXPECTED.mysql_global_grants,false);
  assert.equal(EXPECTED.grant_option,false);
  assert.equal(EXPECTED.production_yii_migrate_allowed,false);
  assert.equal(EXPECTED.apache_restart_allowed,false);
  assert.equal(EXPECTED.application_deploy_allowed,false);
  assert.equal(EXPECTED.auto_production_release_allowed,false);
});
test('credential and native adapter paths bound, mode private',()=>{
  assert.equal(EXPECTED.credential_path,
    '/etc/deploy-control/secrets/honartik_back/mysql.cnf');
  assert.equal(EXPECTED.secret_mode,'0600');
  assert.equal(EXPECTED.secret_parent_mode,'0700');
  assert.equal(EXPECTED.native_backup_function,'backup_database');
  assert.equal(EXPECTED.native_restore_function,'verify_database_restore');
});
test('all even falsely green claims never authorize registration or production',()=>{
  const x=m.reviewCandidate(matching());
  assert.equal(x.source_review_claims_satisfied,true);
  for(const key of [
    'trusted_registration_authorized','native_mysql_account_created',
    'credential_file_written','production_database_mutated',
    'production_profile_modified','level4_approval_requested_or_consumed',
    'universal_native_backup_admitted','production_deploy_authorized'])
    assert.equal(x[key],false,key);
  assert.deepEqual(x.blockers,[]);
});
test('current real U06 missing credential/mandatory offsite/native proof blocked',()=>{
  const s=matching();
  s.credential_file_private_and_executor_owned=false;
  s.offsite_required_true=false;
  s.native_backup_and_restore_verified=false;
  s.signed_one_time_l4_consumed=false;
  s.native_root_binding_present=false;
  const x=m.reviewCandidate(s);
  assert.equal(x.source_review_claims_satisfied,false);
  assert.deepEqual(x.blockers,[
    'mysql_credential_not_private','native_backup_restore_evidence_missing',
    'mandatory_offsite_profile_missing','authentic_l4_consumption_missing',
    'trusted_native_root_binding_missing'
  ]);
  assert.equal(x.production_deploy_authorized,false);
});
test('reject adapter SHA drift, including different project code',()=>{
  const s=matching();s.adapter_sha256='b'.repeat(64);
  assert.deepEqual(m.reviewCandidate(s).blockers,['adapter_sha_drift']);
});
test('reject profile SHA drift after unreviewed profile edit',()=>{
  const s=matching();s.profile_sha256='c'.repeat(64);
  assert.deepEqual(m.reviewCandidate(s).blockers,['profile_sha_drift']);
});
test('reject malformed source hashes',()=>{
  const s=matching();s.profile_sha256='not a digest';
  assert.throws(()=>m.reviewCandidate(s),/invalid_digest/);
});
test('reject missing or injected extra attestation keys',()=>{
  const s=matching();delete s.no_global_or_write_grants;
  assert.throws(()=>m.reviewCandidate(s),/attestation_shape_untrusted/);
  const b=matching();b.command='run arbitrary';
  assert.throws(()=>m.reviewCandidate(b),/attestation_shape_untrusted/);
});
test('reject excessive grants or unverified live database origin',()=>{
  const s=matching();s.no_global_or_write_grants=false;
  s.four_database_grants_exact=false;s.real_mysql_origin_verified=false;
  assert.deepEqual(m.reviewCandidate(s).blockers,[
    'mysql_origin_unverified','database_grants_not_minimal',
    'excessive_mysql_grants'
  ]);
});
test('reject old/absent offsite restore evidence even with native backup',()=>{
  const s=matching();s.fresh_node1_database_restore_verified=false;
  assert.deepEqual(m.reviewCandidate(s).blockers,['offsite_recovery_evidence_missing']);
});
test('reject lack of financial aggregates and mysqlcheck after native restore',()=>{
  const s=matching();s.financial_aggregates_unchanged=false;
  s.full_mysqlcheck_passed=false;
  assert.deepEqual(m.reviewCandidate(s).blockers,[
    'full_database_integrity_not_verified','financial_consistency_not_verified'
  ]);
});
test('reject untested rollback or missing authentic one-time L4 receipt',()=>{
  const s=matching();s.installer_transaction_rollback_test_passed=false;
  s.signed_one_time_l4_consumed=false;
  assert.deepEqual(m.reviewCandidate(s).blockers,[
    'native_transaction_rollback_unverified','authentic_l4_consumption_missing'
  ]);
});
test('no secret management, command execution, or filesystem imports',()=>{
  const source=fs.readFileSync(
    require('node:path').join(__dirname,
      'honartik-u06-native-backup-registration-review-v1.cjs'),'utf8');
  for(const token of [
    "require('node:child_process')","require('node:fs')",
    "require('node:net')","require('node:http')",
    'execSync(', 'spawnSync(', 'eval(', 'new Function('])
    assert.equal(source.includes(token),false,token);
});
