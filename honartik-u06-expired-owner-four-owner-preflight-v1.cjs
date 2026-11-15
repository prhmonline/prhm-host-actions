'use strict';
/**
 * U06 exact production FOUR-OWNER registration preimage manifest.
 *
 * This is a read-only planning / drift-fence module. There is NO executor,
 * no Root CLI, no signed grant, and no file replacement. Never treat a
 * positive preimage match as authorization to mutate production.
 *
 * Measured 2026-11-15 09:53 UTC, prhm-production.prhm.ir (read-only).
 * The canonical installed four-owner source has diverged from the original
 * U06 bootstrap preimages, so the old registrar MUST NOT be replayed.
 */
const crypto=require('node:crypto');
const Registry=require('./honartik-u06-expired-owner-reconcile-registration-review-v1.cjs');
const SHA=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=x=>{throw Error('u06_reconcile_four_owner_'+x)};
const need=(v,x)=>{if(!v)fail(x)};
const PATHS=Object.freeze({
 agent_api:'/opt/prhm-agent-selfmaint/server.js',
 root_executor:'/opt/prhm-agent-selfmaint-exec/server.js',
 agent3_mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
 approval_policy:'/opt/prhm-company-control-plane/config/approval-policy.json'
});
const SHA256=Object.freeze({
 agent_api:'649941e1a2f77a9a1515327e47fa7176a0ae8f4602042750d53847e568deed0e',
 root_executor:'34ce844008fbb7763250cdfa7859ca16360db1aa414fff77d107ffb0ccfa4121',
 agent3_mcp:'01eb930e8e9177b8754ab5cf36a004cb69141d44b74e70b4d42dc3f0f33f1c56',
 approval_policy:'aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934'
});
const KIND=Object.freeze({
 action:Registry.ACTION,operation:Registry.OPERATION,
 owner:Registry.ROOT_HOST,repo:Registry.REPO
});
const NATIVE_ACTION='honartik_u06_native_backup_register_v1';
const NATIVE_OPERATION='host_action.'+NATIVE_ACTION;
const fixedKeys=o=>Object.keys(o).sort().join('|');
const OWNER_KEYS=fixedKeys(PATHS);
function strictPolicy(data){
 need(data&&typeof data==='object'&&!Array.isArray(data)&&
   data.schema_version==='prhm.approval-policy.v1'&&
   data.default_deny===true&&data.scope_freeze===true&&
   data.one_time_use===true,'policy_fail_closed_guards');
 const l4=data.levels?.['4'];
 need(l4?.human_approval===true&&
   l4?.second_confirmation_required===true&&
   l4?.max_ttl_seconds===180,'policy_level4_guards');
 need(data.operations&&typeof data.operations==='object'&&
   !Object.hasOwn(data.operations,Registry.OPERATION)&&
   Object.hasOwn(data.operations,NATIVE_OPERATION)&&
   Array.isArray(data.typed_scopes)&&
   !data.typed_scopes.some(s=>s.operation===Registry.OPERATION||
    s.action===Registry.ACTION)&&
   data.typed_scopes.some(s=>s.operation===NATIVE_OPERATION&&
    s.action===NATIVE_ACTION),'policy_operation_scope_drift');
 return true;
}
function auditReadOnly({host,ownerBytes,policy}={}){
 need(host===Registry.ROOT_HOST,'wrong_host');
 need(ownerBytes&&typeof ownerBytes==='object'&&!Array.isArray(ownerBytes)&&
   fixedKeys(ownerBytes)===OWNER_KEYS,'four_owner_shape');
 for(const [name,expected] of Object.entries(SHA256)){
  const b=ownerBytes[name];
  need(Buffer.isBuffer(b)&&b.length>200&&b.length<2000000,'owner_bytes_untrusted_'+name);
  need(SHA(b)===expected,'owner_preimage_sha_drift_'+name);
 }
 need(Buffer.isBuffer(ownerBytes.approval_policy),'policy_bytes_missing');
 let parsed;
 try{parsed=JSON.parse(ownerBytes.approval_policy.toString('utf8'))}
 catch{fail('policy_parse_failed')}
 strictPolicy(parsed);
 return Object.freeze({
  schema:'prhm.u06.expired-owner-oidc.four-owner-source-review.v1',
  host:Registry.ROOT_HOST,action:Registry.ACTION,operation:Registry.OPERATION,
  preimage_sha256:SHA256,owner_paths:PATHS,
  native_action_already_registered:true,
  reconciliation_action_not_registered:true,
  proposed_scope:Object.freeze({
   tool:'host_action_v2_apply',project:'control_plane',
   environment:'production',action:Registry.ACTION,
   operation:Registry.OPERATION,risk:'critical',
   principal_id:'mohammad',level:4,
   requires_second_confirmation:true,one_time_use:true,expires_seconds:180
  }),
  registration_changes_prepared:false,
  authorization_issued:false,
  production_mutation_authorized:false,
  root_handler_registered:false,
  is_review_only:true
 });
}
module.exports=Object.freeze({
 PATHS,SHA256,KIND,NATIVE_ACTION,NATIVE_OPERATION,auditReadOnly,
 ROOT_INSTALLER_EXPORTED:false,LEVEL4_ISSUER:false,PRODUCTION_AUTHORIZED:false
});
if(require.main===module){
 process.stderr.write('U06 four-owner preimage audit only, no Root apply or registration.\n');
 process.exitCode=64;
}
