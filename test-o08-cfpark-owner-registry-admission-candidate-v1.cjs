'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('./o08-cfpark-owner-registry-admission-candidate-v1.cjs');
function evidence() {
  return {
    owner_shas:Object.fromEntries(Object.entries(c.OWNERS).map(([k,v])=>[k,v.sha256])),
    asset_git_blob:c.SOURCE_GIT_BLOB,
    helper_installed:false,
    profile_installed:false,
    fixed_sudo_installed:false,
    shared_registry_registered:false
  };
}
test('the observed four owner SHAs and exact source blob produce BLOCKED review only',()=>{
  const result=c.reviewInventory(evidence());
  assert.equal(result.decision,'BLOCKED');
  assert.equal(result.reason,'shared_registry_not_installed');
  assert.equal(result.installation_authorized,false);
  assert.equal(result.production_deploy_authorized,false);
});
test('each independently controlled owner preimage drift fails closed',()=>{
  for(const owner of Object.keys(c.OWNERS)){
    const x=evidence();
    x.owner_shas[owner]='a'.repeat(64);
    assert.throws(()=>c.reviewInventory(x),new RegExp('owner_sha_drift_'+owner));
  }
});
test('asset SHA-1 cannot be swapped for PBCinema or an unreviewed helper',()=>{
  const x=evidence();x.asset_git_blob='b'.repeat(40);
  assert.throws(()=>c.reviewInventory(x),/untrusted_asset_blob/);
});
test('extra keys, omitted keys and missing owner names are rejected',()=>{
  let x=evidence();x.command='git reset --hard';assert.throws(()=>c.reviewInventory(x),/schema/);
  x=evidence();delete x.fixed_sudo_installed;assert.throws(()=>c.reviewInventory(x),/schema/);
  x=evidence();delete x.owner_shas.mcp;assert.throws(()=>c.reviewInventory(x),/schema/);
});
test('invalid booleans and simulated installation cannot grant privileges',()=>{
  let x=evidence();x.profile_installed='yes';
  assert.throws(()=>c.reviewInventory(x),/invalid_flag_profile_installed/);
  x=evidence();x.helper_installed=true;x.profile_installed=true;
  x.fixed_sudo_installed=true;x.shared_registry_registered=true;
  const result=c.reviewInventory(x);
  assert.equal(result.reason,'signed_l4_receipt_and_native_installer_required');
  assert.equal(result.installation_authorized,false);
  assert.equal(result.production_deploy_authorized,false);
});
test('fixed action contract has zero arguments, fixed owner/target, and Level 4 approval',()=>{
  const p=c.immutableRegistrationSpec();
  assert.equal(p.action,'cfpark_front_readonly_attest');
  assert.equal(p.project,'cfpark_front');
  assert.equal(p.source_commit,'232e090124657f4637fd9583ea60634f9554b930');
  assert.equal(p.source_blob_sha1,'caceb90cf20b760efa465d1e880d71a837931235');
  assert.equal(p.install_target,'/usr/local/libexec/deploy-control/cfpark-front-readonly-attestor-v1.sh');
  assert.equal(p.universal_profile,'/etc/deploy-control/projects/cfpark_front.production.json');
  assert.equal(p.permitted_arguments,0);
  assert.equal(p.run_as,'cfpark');assert.equal(p.install_owner,'root:root');
  assert.equal(p.required_level,4);
  assert.equal(p.requires_fresh_signed_approval,true);
  assert.equal(p.requires_atomic_rollback,true);
  assert.equal(p.install_allowed,false);
  assert.equal(p.production_deploy_allowed,false);
  assert.equal(Object.isFrozen(p),true);
});
test('module remains purely declarative; no privileged process or registry bypass',()=>{
  const fs=require('node:fs');
  const s=fs.readFileSync(require.resolve('./o08-cfpark-owner-registry-admission-candidate-v1.cjs'),'utf8');
  assert.equal(s.includes('child_process'),false);
  assert.equal(s.includes('spawnSync('),false);
  assert.equal(s.includes('execSync('),false);
  assert.equal(s.includes('writeFileSync('),false);
  assert.equal(s.includes('sudo -u'),false);
  assert.equal(s.includes('systemctl restart'),false);
  assert.equal(s.includes('install_allowed:true'),false);
});
