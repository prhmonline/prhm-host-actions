'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const c=require('./honartik-iticket-worktree-level4-policy-contract-v1.cjs');
function valid(){
  return {
    schema_version:'prhm.approval-policy.v1',
    version:c.EXISTING_VERSION,
    default_deny:true,one_time_use:true,
    issuer:'prhm-company-approval',high_risk_approver:'mohammad',
    levels:{
      '3':{name:'production-sensitive',max_ttl_seconds:300,risks:['high'],human_approval:false},
      '4':{name:'destructive-critical',risks:['critical'],max_ttl_seconds:180,
        human_approval:true,required_approver:'mohammad',second_confirmation_required:true}
    },
    operations:{
      'host_action.host_action_v2_installer_v1':{level:3},
      'host_action.agent_zero_downtime_bootstrap_v1':{level:3}
    },
    typed_scopes:[{action:'host_action_v2_installer_v1',risk:'high',operation:'host_action.host_action_v2_installer_v1'}]
  };
}
const source=x=>JSON.stringify(x??valid(),null,2)+'\n';
test('full Level4 operation has critical, one-time, 180s, second confirmation and rollback',()=>{
  const input=valid(),out=JSON.parse(c.transform(source(input)));
  const op=out.operations[c.OPERATION],scope=out.typed_scopes.find(x=>x.action===c.ACTION);
  assert.deepEqual(op,{
    level:4,risk:'critical',requires_second_confirmation:true,
    one_time_use:true,requested_approver:'mohammad',expires_seconds:180,
    policy_version:c.CANDIDATE_VERSION,rollback_reference:c.ROLLBACK
  });
  assert.equal(scope.risk,'critical');
  assert.equal(scope.tool,'host_action_v2_apply');
  assert.equal(scope.environment,'production');
  assert.equal(scope.operation,c.OPERATION);
  assert.deepEqual(scope.principals,[{principal_id:'mohammad',roles:['mcp-operator']}]);
  assert.equal(out.version,c.CANDIDATE_VERSION);
  assert.equal(out.operations['host_action.host_action_v2_installer_v1'].level,3);
  assert.equal(out.default_deny,true);
});
for(const [label,mutate] of [
  ['unsupported schema',p=>p.schema_version='unknown'],
  ['wrong baseline version',p=>p.version='historic'],
  ['default allow',p=>p.default_deny=false],
  ['replay protection off',p=>p.one_time_use=false],
  ['issuer mismatch',p=>p.issuer='unknown'],
  ['approver mismatch',p=>p.high_risk_approver='different'],
  ['level4 absent',p=>delete p.levels['4']],
  ['level4 no human signoff',p=>p.levels['4'].human_approval=false],
  ['level4 no second confirm',p=>p.levels['4'].second_confirmation_required=false],
  ['level4 wrong approver',p=>p.levels['4'].required_approver='different'],
  ['level4 TTL too long',p=>p.levels['4'].max_ttl_seconds=360],
  ['level4 no critical risk',p=>p.levels['4'].risks=['high']],
  ['operations missing',p=>delete p.operations],
  ['typed scopes malformed',p=>p.typed_scopes={} ],
  ['old installer classification drift',p=>p.operations['host_action.host_action_v2_installer_v1'].level=4],
  ['duplicate registered operation',p=>p.operations[c.OPERATION]={level:4}],
  ['duplicate registered scope',p=>p.typed_scopes.push({action:c.ACTION})]
]){
  test('fail closed: '+label,()=>{
    const p=valid();mutate(p);
    assert.throws(()=>c.transform(source(p)),/honartik_l4_policy_blocked_/);
  });
}
test('unverified bytes are not a live audit',()=>{
  assert.throws(()=>c.audit(Buffer.from(source())),/original_sha/);
});
test('malformed JSON is rejected',()=>{
  assert.throws(()=>c.transform('not json'),/json_invalid/);
});
test('read-only helper has no access to files, processes, network or approval tokens',()=>{
  const source=fs.readFileSync(require.resolve('./honartik-iticket-worktree-level4-policy-contract-v1.cjs'),'utf8');
  for(const frag of ["require('node:fs')","require('node:child_process')","writeFileSync(",
      "renameSync(","spawnSync(","process.argv","https.request(","fetch("])
    assert.equal(source.includes(frag),false,frag);
  assert.equal(c.audit instanceof Function,true);
});
