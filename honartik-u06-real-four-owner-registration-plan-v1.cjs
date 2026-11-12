'use strict';
/**
 * U06 fixed four-owner atomic registration plan, exact reviewed sources only.
 * NEVER installs. An independent owner-signed short-lived SSHSIG manifest
 * must be checked by the Root bootstrap executor BEFORE calling executeCore.
 */
const path=require('node:path'),crypto=require('node:crypto');
const Bridge=require('./honartik-u06-root-executor-sealed-token-bridge-review-v1.cjs');
const Preview=require('./honartik-u06-owner-root-routing-preview-v1.cjs');
const Policy=require('./honartik-u06-native-l4-consumed-receipt-v1.cjs');
const A='honartik_u06_native_backup_register_v1';
const OP='host_action.'+A;
const SHA=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=x=>{throw Error('u06_fixed_four_owner_plan_'+x)};
const yes=(x,e)=>{if(!x)fail(e)};
const ASSET_NAMES=Object.freeze([
 'honartik-u06-real-root-callback-adapter-v1.cjs',
 'honartik-u06-native-root-lease-v1.cjs',
 'honartik-u06-native-root-mariadb-identity-v1.cjs',
 'honartik-u06-native-root-l4-admission-v1.cjs',
 'honartik-u06-native-l4-consumed-receipt-v1.cjs',
 'honartik-u06-owner-native-transaction-v1.cjs',
 'honartik-u06-owner-oidc-identity-gate-v1.cjs',
 'honartik-u06-owner-oidc-once-fence-v1.cjs',
 'honartik-u06-root-owner-proof-bridge-v1.cjs',
 'universal-owner-oidc-recovery-gate-v1.cjs',
 'universal-owner-oidc-sealed-transport-v1.cjs',
 'universal-installer-backup-only-native-contract-v1.cjs',
 'honartik-universal-installer-l4-approval-verify-v1.cjs',
 'honartik-universal-installer-l4-v1.cjs',
 'u06_live_native_root_worker_v1.py'
]);
const ROOT='/opt/prhm-agent-selfmaint-exec/actions';
const TARGET=Object.freeze({
 base:'/opt/prhm-agent-selfmaint/server.js',
 executor:'/opt/prhm-agent-selfmaint-exec/server.js',
 mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
 policy:'/opt/prhm-company-control-plane/config/approval-policy.json'
});
const BEFORE=Object.freeze({
 base:'57828b344aca1d1fb51e74cc2c64094edb03c5fd86fe68420d7185f0d12b6530',
 executor:'4c136a210681ee07a45d96d38d91c1253afcce67feed0a9d062f9f14d0557169',
 mcp:'0c6a74757696a0d85840a0aec1bc53c91431481024f2be56e4ecb02f789073ef',
 policy:'26359a31efdfe0acde07cc9f4001afddee98efaa206e4528880068bf93c425f5'
});
const META=Object.freeze({
 base:Object.freeze({uid:0,gid:0,mode:0o644}),
 executor:Object.freeze({uid:0,gid:0,mode:0o755}),
 mcp:Object.freeze({uid:0,gid:0,mode:0o600}),
 policy:Object.freeze({uid:0,gid:0,mode:0o644})
});
const POLICY_SHA='aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934';
const POLICY_SIZE=32036;
function exactPolicy(policyBuffer){
 yes(Buffer.isBuffer(policyBuffer)&&SHA(policyBuffer)===BEFORE.policy,
  'before_policy_sha_drift');
 const src=JSON.parse(policyBuffer.toString('utf8'));
 yes(src.schema_version==='prhm.approval-policy.v1'&&
  src.default_deny===true&&src.scope_freeze===true&&
  src.one_time_use===true&&
  src.levels?.['4']?.human_approval===true&&
  src.levels?.['4']?.second_confirmation_required===true&&
  src.levels?.['4']?.max_ttl_seconds===180 &&
  !Object.hasOwn(src.operations,OP)&&
  !src.typed_scopes.some(s=>s.action===A||s.operation===OP),
  'policy_guards_or_preimage_not_current');
 src.operations[OP]={
   level:4,risk:'critical',requires_second_confirmation:true,
   one_time_use:true,requested_approver:'mohammad',
   expires_seconds:180,policy_version:src.version,
   rollback_reference:'host-action-v2:honartik-u06-native-backup:durable-verified-root-rollback'
 };
 src.typed_scopes.push({
  tool:'host_action_v2_apply',project:'control_plane',
  environment:'production',action:A,risk:'critical',operation:OP,
  principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
 });
 const bytes=Buffer.from(JSON.stringify(src,null,2)+'\n','utf8');
 yes(bytes.length===POLICY_SIZE&&SHA(bytes)===POLICY_SHA,
  'reviewed_policy_candidate_sha_or_bytes_drift');
 return bytes;
}
function exactRootBridge(rootSource,assets){
 const pattern="throw new Error('u06_full_native_root_handler_not_installed');";
 yes(rootSource.split(pattern).length===2,'root_bridge_anchor_missing_or_duplicate');
 const targets=Object.entries(assets).map(([name,data])=>{
   const full=path.posix.join(ROOT,name);
   return [full,SHA(data)];
 });
 const replacements=[
  "  // This Root path is only reached from the official consumed Level-4 v2 request.",
  "  // Every executable asset must still have immutable SHA+root ownership.",
  "  const u06Fs=require('node:fs'),u06Crypto=require('node:crypto');",
  "  for(const [file,hash] of "+JSON.stringify(targets)+"){",
  "    const st=u06Fs.lstatSync(file);",
  "    if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||st.gid!==0||",
  "       st.nlink!==1||(st.mode&0o022)!==0||",
  "       u06Crypto.createHash('sha256').update(u06Fs.readFileSync(file)).digest('hex')!==hash)",
  "       throw new Error('u06_root_module_source_sha_or_owner_drift');",
  "  }",
  "  const ownerProof=await require('/opt/prhm-agent-selfmaint-exec/actions/honartik-u06-root-owner-proof-bridge-v1.cjs').consumeStagedOwnerProof();",
  "  return await require('/opt/prhm-agent-selfmaint-exec/actions/honartik-u06-real-root-callback-adapter-v1.cjs').runOnlyFromTrustedRootBridge({",
  "    requestId,sealedToken,authoritativeConsumed:consumedReceipt,ownerProof",
  "  });"
 ].join('\n');
 const root=rootSource.replace(pattern,replacements);
 yes(root.includes(Bridge.MARK)&&root.includes(Preview.NEW.dispatch)&&
  root.includes("u06_root_module_source_sha_or_owner_drift"),
  'root_reviewed_dispatch_missing');
 return Buffer.from(root,'utf8');
}
function build({ownerBuffers,assetBuffers,sourceCommit}={}){
 yes(/^[0-9a-f]{40}$/.test(sourceCommit||''),'git_commit_not_pinned');
 yes(ownerBuffers&&Object.keys(ownerBuffers).sort().join('|')===
  ['agent_api','root_executor','agent3_mcp','approval_policy'].sort().join('|'),
  'four_owner_input_shape');
 yes(assetBuffers&&Object.keys(assetBuffers).sort().join('|')===
  [...ASSET_NAMES].sort().join('|'),'fixed_asset_closure_missing');
 const files={};
 for(const n of ASSET_NAMES){
  const b=assetBuffers[n];
  yes(Buffer.isBuffer(b)&&b.length>30&&b.length<250000,
   'untrusted_asset_bytes_'+n);
  files[n]=b;
 }
 const reviewed=Bridge.preview(ownerBuffers);
 yes(reviewed.installation_authorized===false&&
   reviewed.direct_apply_without_trusted_context_denied===true,
   'registration_preview_security_drift');
 const policy=exactPolicy(ownerBuffers.approval_policy);
 const proposed={
  base:Buffer.from(reviewed.agent_api_candidate),
  executor:exactRootBridge(reviewed.root_executor_candidate,files),
  mcp:Buffer.from(reviewed.agent3_mcp_candidate),
  policy
 };
 const order=['base','executor','mcp','policy'];
 const steps=order.map(key=>({
  key,path:TARGET[key],beforeSha:BEFORE[key],
  afterSha:SHA(proposed[key]),nextBytes:proposed[key],
  expectedUid:META[key].uid,expectedGid:META[key].gid,
  expectedMode:META[key].mode
 }));
 const assetList=ASSET_NAMES.map(n=>Object.freeze({
   path:path.posix.join(ROOT,n),afterSha:SHA(files[n]),nextBytes:files[n]
 }));
 const digests={
  source_commit:sourceCommit,policy_post_sha256:POLICY_SHA,
  preimage_sha256:Object.fromEntries(order.map(k=>[k,BEFORE[k]])),
  postimage_sha256:Object.fromEntries(steps.map(x=>[x.key,x.afterSha])),
  asset_sha256:Object.fromEntries(ASSET_NAMES.map(n=>[n,SHA(files[n])]))
 };
 const manifestSha256=SHA(Buffer.from(JSON.stringify({
   action:A,sourceCommit,steps:steps.map(s=>[s.key,s.path,s.beforeSha,
    s.afterSha,s.expectedUid,s.expectedGid,s.expectedMode]),
   assets:assetList.map(a=>[a.path,a.afterSha])
 })));
 return Object.freeze({
  schema:'prhm.registrar.native-transaction.v1',
  sourceCommit,manifestSha256,steps,assets:assetList,
  signedDigestClosure:digests,
  approval_l4_not_issued:true,
  install_requires_independent_owner_ssh_signature:true,
  live_installed:false
 });
}
module.exports=Object.freeze({
 A,OP,ASSET_NAMES,TARGET,BEFORE,META,POLICY_SHA,POLICY_SIZE,
 exactPolicy,build,INSTALLER_EXPORTED:false
});
if(require.main===module){
 process.stderr.write('NO DIRECT INSTALL: reviewed SHA plan is not an authorization.\n');
 process.exitCode=64;
}
