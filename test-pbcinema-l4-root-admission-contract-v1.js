'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('./pbcinema-l4-root-admission-contract-v1.js');

const data={base:'// base test file',executor:'// executor test file',policy:JSON.stringify({enabled:true,default_deny:true,operations:{},typed_scopes:[]}),mcp:'// mcp file',mcp_candidate:'// mcp candidate file'};
function fixture(){
  const targets={},files={};
  for(const [name,s] of Object.entries(data)){
    const p='/test/'+name;files[p]=Buffer.from(s);
    targets[name]={path:p,sha256:c.sha256(files[p])};
  }
  const mk=(overrides={})=>({
    targets,readFile:p=>files[p],
    lstat:p=>({uid:0,mode:0o100644,isFile:()=>true,isSymbolicLink:()=>false,...overrides})
  });
  return {mk,targets,files};
}
function approval(overrides={}){return {
  action:c.ACTIONS[0].action,operation:c.ACTIONS[0].operation,
  second_confirmation:'CONFIRM_LEVEL_4_CRITICAL',level:4,risk:'critical',
  project:'control_plane',environment:'production',
  universal_git_sha:c.RELEASE.universal_git_sha,disabled_profile_digest:c.RELEASE.disabled_profile_digest,
  signed:true,one_time:true,expired:false,consumed:false,...overrides
};}
test('two exact actions; no wildcard or generic privilege',()=>{
  assert.deepEqual(c.ACTIONS.map(x=>x.action),[
    'pbcinema_mysql_backup_credential_issue_v1',
    'pbcinema_universal_installer_upgrade_v1'
  ]);
  assert.equal(new Set(c.ACTIONS.map(x=>x.operation)).size,2);
  assert.ok(c.ACTIONS.every(x=>x.operation.startsWith('host_action.pbcinema_')));
  assert.equal(c.RELEASE.universal_git_sha.length,40);
  assert.equal(c.RELEASE.disabled_profile_digest.length,64);
});
test('proposal never claims to be executable or pre-approved',()=>{
  const p=c.registrationProposal();
  assert.equal(p.installable,false);
  assert.equal(p.approval.level,4);
  assert.equal(p.approval.one_time,true);
  assert.equal(p.release.secret_file,'/etc/deploy-control/secrets/pbcinema/mysql.cnf');
  assert.equal(p.release.database,'cfpark_park_bazar');
});
test('exact clean owner preimages pass in synthetic fixture',()=>{
  const f=fixture();const result=c.inspectOwners(f.mk());
  assert.equal(result.ready_for_review,true);
  assert.equal(result.production_changed,false);
});
test('baseline drift, broken policy, partial registration and unsafe files fail closed',()=>{
  {
    const f=fixture();f.files['/test/executor']=Buffer.from('unexpected');
    assert.throws(()=>c.inspectOwners(f.mk()),/owner_sha_drift:executor/);
  }
  {
    const f=fixture();f.files['/test/policy']=Buffer.from('{"enabled":false}');
    f.targets.policy.sha256=c.sha256(f.files['/test/policy']);
    assert.throws(()=>c.inspectOwners(f.mk()),/policy_not_fail_closed/);
  }
  {
    const f=fixture();f.files['/test/base']=Buffer.from(c.ACTIONS[0].action);
    f.targets.base.sha256=c.sha256(f.files['/test/base']);
    assert.throws(()=>c.inspectOwners(f.mk()),/partial_registration:base/);
  }
  const f=fixture();
  assert.throws(()=>c.inspectOwners(f.mk({uid:1000})),/untrusted_owner:base/);
  assert.throws(()=>c.inspectOwners(f.mk({mode:0o100666})),/untrusted_owner:base/);
  assert.throws(()=>c.inspectOwners(f.mk({isSymbolicLink:()=>true})),/untrusted_owner:base/);
});
test('approval metadata rejects missing signed L4 fields and release drift',()=>{
  assert.equal(c.exactApproval(approval()),true);
  for(const [k,v] of Object.entries({
    second_confirmation:'CONFIRM_LEVEL_3_PRODUCTION',level:3,risk:'high',
    project:'pbcinema',environment:'staging',universal_git_sha:'0'.repeat(40),
    disabled_profile_digest:'0'.repeat(64),action:'pbcinema_*',operation:'host_action.any',
    signed:false,one_time:false,expired:true,consumed:true
  })){
    assert.throws(()=>c.exactApproval(approval({[k]:v})),/pbcinema_root_admission_denied:/,k);
  }
});
test('real installed Root preimages match reviewed SHA; read only',()=>{
  // Only run on the known production machine; keep portable CI isolated.
  if(process.env.PBCINEMA_ROOT_ADMISSION_READONLY!=='1')return;
  assert.equal(c.inspectOwners().ready_for_review,true);
});
