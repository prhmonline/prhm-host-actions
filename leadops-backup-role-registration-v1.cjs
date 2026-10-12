'use strict';
// Pure, non-executable Agent 3 registration candidate. Signed installer required.
const crypto=require('node:crypto');
const ACTION='leadops_backup_role_provision_v1',OPERATION='host_action.'+ACTION;
const SOURCE_COMMIT='325f8fcce1ee9289125d7cd08e495c331911f740';
const SQL_BLOB='0ecbca4fd712f8a6e87595be526305763ad539d3';
const HELPER_BLOB='dc2551dc17e4e6cc975fc365128905adbed4b3bb';
const LIVE=Object.freeze({
  executor:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
  mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166',
  policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'
});
const TARGETS=Object.freeze({
  executor:'/opt/prhm-agent-selfmaint-exec/server.js',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  helper:'/opt/prhm-agent-selfmaint-exec/actions/leadops-backup-role-provision-v1.cjs',
  sql:'/opt/prhm-agent-selfmaint-exec/actions/leadops-backup-role-provision-v1.sql'
});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const blob=b=>{b=Buffer.from(b);return crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function fail(code){throw Error(code);}
function replaceOnce(s,needle,value,label){
  if(s.split(needle).length!==2)fail('anchor_mismatch:'+label);
  return s.replace(needle,value);
}
function buildCandidates(src,{expected=LIVE}={}){
  for(const key of ['executor','mcp','policy']){
    if(typeof src[key]!=='string'||sha(src[key])!==expected[key])fail('owner_sha_mismatch:'+key);
    if(src[key].includes(ACTION))fail('already_registered:'+key);
  }
  if(blob(src.sql)!==SQL_BLOB)fail('sql_binding_mismatch');
  if(blob(src.helper)!==HELPER_BLOB)fail('helper_binding_mismatch');
  const executorAnchor="  leadops_economics_inputs_foundation_v1:{operation:'host_action.leadops_economics_inputs_foundation_v1',kind:'leadops_economics_inputs_foundation_v1'},";
  let executor=replaceOnce(src.executor,executorAnchor,
    "  "+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'},\n"+executorAnchor,'executor_spec');
  const runner=[
    "function applyLeadopsBackupRoleProvisionV1(){",
    " const p='/opt/prhm-agent-selfmaint-exec/actions/leadops-backup-role-provision-v1.cjs';",
    " const b=fs.readFileSync(p);",
    " if(require('node:crypto').createHash('sha256').update(b).digest('hex')!=='__HELPER_SHA__')",
    "   throw Error('leadops_backup_role_helper_sha_mismatch');",
    " const output=cp.execFileSync('/usr/local/bin/prhm-node',[p],{",
    "   encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:100000,maxBuffer:1048576});",
    " const result=JSON.parse(output);",
    " if(result.ok!==true||result.action!=='leadops_backup_role_provision_v1'||",
    "    result.schema_version!=='prhm.host-action-result.v1'||",
    "    result.created_role!=='leadops_backup'||",
    "    result.app_sensitive_table_select!==false||result.backup_sensitive_table_select!==true)",
    "   throw Error('leadops_backup_role_postcheck_invalid');",
    " return result;",
    "}"
  ].join('\n').replace('__HELPER_SHA__',sha(src.helper))+'\n';
  const dispatch="async function applyHostActionV2(action){const spec=hostActionV2Spec(action);";
  executor=replaceOnce(executor,dispatch,runner+dispatch+
    "if(action==='leadops_backup_role_provision_v1')return applyLeadopsBackupRoleProvisionV1();",'executor_dispatch');
  const mcp=replaceOnce(src.mcp,"'leadops_economics_inputs_foundation_v1',",
    "'"+ACTION+"','leadops_economics_inputs_foundation_v1',",'mcp_enum');
  const policy=JSON.parse(src.policy);
  if(policy.deployment_integrity?.git_first_required!==true||
     policy.deployment_integrity?.exact_commit_sha_required_for_production!==true||
     policy.deployment_integrity?.direct_production_file_edit_forbidden!==true)
    fail('missing_git_first_runtime_integrity_guard');
  if(policy.default_deny!==true||policy.one_time_use!==true||
     policy.levels?.['4']?.human_approval!==true||
     !Array.isArray(policy.typed_scopes)||policy.operations?.[OPERATION])
    fail('level4_policy_baseline_invalid');
  policy.operations[OPERATION]={
    level:4,risk:'critical',requires_second_confirmation:true,
    one_time_use:true,requested_approver:'mohammad',expires_seconds:180,
    rollback_reference:'leadops-backup-role:atomic-precommit-manual-postcommit'
  };
  policy.typed_scopes.push({
    tool:'host_action_v2_apply',project:'control_plane',environment:'production',
    action:ACTION,risk:'critical',operation:OPERATION,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  });
  const output={executor,mcp,policy:JSON.stringify(policy,null,2)+'\n',
    helper:src.helper,sql:src.sql};
  return Object.freeze({
    schema:'prhm.leadops.backup-role.registration-plan.v1',action:ACTION,
    operation:OPERATION,source_commit:SOURCE_COMMIT,
    expected_live_sha256:{...expected},
    requires_signed_level4:true,installation_authorized:false,
    production_database_mutation:false,
    targets:Object.fromEntries(Object.entries(output).map(([k,s])=>[
      k,{path:TARGETS[k],sha256:sha(s),bytes:Buffer.byteLength(s)}
    ])),
    candidate_sources:output
  });
}
module.exports={ACTION,OPERATION,SOURCE_COMMIT,SQL_BLOB,HELPER_BLOB,
  LIVE,TARGETS,sha,blob,buildCandidates};
