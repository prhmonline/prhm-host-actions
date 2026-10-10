'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const m=require('./drtarjomeh-incident47-l4-registration-candidate-v1.js');

const fixture=()=>Buffer.from(JSON.stringify({
  schema_version:'prhm.approval-policy.v1',
  version:'2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1',
  operations:{
    'host_action.preexisting_v1':{level:3,risk:'high',one_time_use:true}
  },
  typed_scopes:[
    {action:'preexisting_v1',operation:'host_action.preexisting_v1',
     principals:[{principal_id:'test_existing_operator',roles:['mcp-operator']}]}
  ]
}));
test('fixed action, SHA pins, and narrow one-time Level-4 policy',()=>{
  assert.equal(m.ACTION,'drtarjomeh_incident47_uploads_guard_install_v1');
  assert.equal(m.OPERATION,'host_action.drtarjomeh_incident47_uploads_guard_install_v1');
  assert.equal(m.SOURCE_COMMIT,'e20f4055610d9e61bd8ec42e4d271d97f7433ace');
  assert.equal(Object.keys(m.LIVE).length,4);
  assert.equal(Object.keys(m.APP_BLOBS).length,2);
  const spec=m.approvalPolicyOperation();
  assert.equal(spec.level,4);
  assert.equal(spec.risk,'critical');
  assert.equal(spec.one_time_use,true);
  assert.equal(spec.requires_second_confirmation,true);
  assert.equal(spec.expires_seconds,180);
  assert.equal(m.typedScope().environment,'production');
  assert.equal(m.typedScope().project,'control_plane');
  assert.deepEqual(m.typedScope().principals,[{principal_id:'mohammad',roles:['mcp-operator']}]);
});
test('policy transform adds only one operation and scope without changing existing action',()=>{
  const original=fixture();
  const result=JSON.parse(m.buildPolicyStructure(original).toString('utf8'));
  const baseline=JSON.parse(original.toString('utf8'));
  assert.equal(Object.keys(result.operations).length,Object.keys(baseline.operations).length+1);
  assert.equal(result.typed_scopes.length,baseline.typed_scopes.length+1);
  assert.deepEqual(result.operations['host_action.preexisting_v1'],
                   baseline.operations['host_action.preexisting_v1']);
  assert.deepEqual(result.typed_scopes[0],baseline.typed_scopes[0]);
  assert.equal(result.operations[m.OPERATION].level,4);
  assert.equal(result.operations[m.OPERATION].one_time_use,true);
  assert.equal(result.typed_scopes[1].action,m.ACTION);
  assert.throws(()=>m.buildPolicyStructure(Buffer.from(JSON.stringify(result))),/policy_baseline_mismatch|already_registered/);
});
test('malformed policy, unpinned real-policy bytes and unsupported grants fail closed',()=>{
  assert.throws(()=>m.buildPolicyStructure(Buffer.from('invalid-json')),/policy_json_invalid/);
  const altered=JSON.parse(fixture());
  altered.typed_scopes=[];
  altered.schema_version='alien';
  assert.throws(()=>m.buildPolicyStructure(Buffer.from(JSON.stringify(altered))),/policy_baseline_mismatch/);
  const duplicate=JSON.parse(fixture());
  duplicate.operations[m.OPERATION]={level:1};
  assert.throws(()=>m.buildPolicyStructure(Buffer.from(JSON.stringify(duplicate))),/already_registered/);
  duplicate.operations[m.OPERATION]=null;
  assert.throws(()=>m.buildPolicyStructure(Buffer.from(JSON.stringify(duplicate))),/already_registered/);
  assert.throws(()=>m.buildPolicyCandidate(fixture()),/policy_sha_drift/);
  assert.throws(()=>m.buildPolicyCandidate('arbitrary-user-value'),/policy_bytes_required/);
});
test('pin validation refuses missing live owner or forged artifact bytes',()=>{
  assert.throws(()=>m.verifyOwnerPreimages(),/read_owner_required/);
  assert.throws(()=>m.verifyOwnerPreimages(()=>Buffer.from('drift')),/live_base_sha_drift/);
  assert.throws(()=>m.verifyApplicationBlobs(),/read_artifact_required/);
  assert.throws(()=>m.verifyApplicationBlobs(()=>Buffer.from('drift')),/application_guard_blob_drift/);
  assert.equal(m.gitBlob(Buffer.from('hello')),'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
});
test('wrong exact source or host SHA fails before reading any live file',()=>{
  const rejectRead=()=>{throw Error('unexpected_live_read');};
  assert.throws(()=>m.buildReadOnlyPlan({readOwner:rejectRead,readArtifact:rejectRead,
       hostMainCommit:'f'.repeat(40)}),/host_actions_base_sha_drift/);
  assert.throws(()=>m.buildReadOnlyPlan({readOwner:rejectRead,readArtifact:rejectRead,
       appHeadCommit:'f'.repeat(40)}),/application_head_sha_drift/);
});
test('no install or approval action exists in the CLI and source never mutates',()=>{
  const candidate=path.join(__dirname,'drtarjomeh-incident47-l4-registration-candidate-v1.js');
  const ok=spawnSync(process.execPath,[candidate,'--selftest'],{encoding:'utf8'});
  assert.equal(ok.status,0,ok.stderr);
  const selftest=JSON.parse(ok.stdout);
  assert.equal(selftest.registration_authorized,false);
  assert.equal(selftest.deploy_allowed,false);
  for(const arg of ['--install','--apply','--approve','--register']){
    const bad=spawnSync(process.execPath,[candidate,arg],{encoding:'utf8'});
    assert.notEqual(bad.status,0);
    assert.match(bad.stderr,/readonly_selftest_only/);
  }
  const src=fs.readFileSync(candidate,'utf8');
  assert.doesNotMatch(src,/execFileSync|spawnSync|writeFileSync|renameSync|unlinkSync|systemctl|fetch\(|https\.request/);
  assert.doesNotMatch(src,/function\s+(install|apply|deploy|consumeRequest)\s*\(/);
});
