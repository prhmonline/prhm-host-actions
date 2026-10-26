'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SPEC = Object.freeze({
  action: 'control_plane_root_trust_anchor_one_shot_recovery_v1',
  schema_version: 'prhm.root-trust-anchor-recovery-result.v1',
  operation: 'host_action.root_scripts_fixed_stage_v1',
  target_action: 'root_scripts_fixed_stage_v1',
  reference_action: 'honartik_iticket_dark_backend_batch2_v1',
  helper_path: '/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js',
  landing_dir: '/home/agent/ssh-agent-api/root-stage-v1',
  paths: Object.freeze({
    base:'/opt/prhm-agent-selfmaint/server.js',
    executor:'/opt/prhm-agent-selfmaint-exec/server.js',
    mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
    policy:'/opt/prhm-company-control-plane/config/approval-policy.json'
  }),
  expected: Object.freeze({
    base:'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',
    executor:'1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',
    mcp:'44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71',
    policy:'c0cb39528b9658cc01d9c97f4011f9200efa9e0a862d202cf4ef82824594c9e0'
  }),
  artifacts: Object.freeze({
    'control-plane-approval-bootstrap-recovery-v1.sh':'142383a58e5647a95bf2c7a4200772e7b7eb7cdde6783df991aec89d6f8151dd',
    'control-plane-approval-bootstrap-recovery-v1.json':'b3918639f19a489373489e714c86c733f5b8c0a851727b2b65b3831b071cb1d2'
  })
});

function sha256(bytes){ return crypto.createHash('sha256').update(bytes).digest('hex'); }
function fail(msg){ throw new Error(msg); }
function readRegular(file){ const st=fs.lstatSync(file); if(st.isSymbolicLink()||!st.isFile()) fail('not_regular:'+file); return fs.readFileSync(file); }
function verifyBaselines(ctx, expected=SPEC.expected){
  for(const k of ['base','executor','mcp','policy']){
    const actual=sha256(readRegular(ctx.paths[k]));
    if(actual!==expected[k]) fail('baseline_sha_mismatch:'+k);
  }
  return {baseline_verified:true};
}
function verifyExecutorCapability(ctx){
  const s=fs.readFileSync(ctx.paths.executor,'utf8');
  if(!s.includes('root_scripts_fixed_stage_v1')||!s.includes(SPEC.helper_path)) fail('root_scripts_executor_implementation_missing');
  return true;
}
function patchBaseRegistry(text){
  const key='root_scripts_fixed_stage_v1';
  const keyRe=/^\s*root_scripts_fixed_stage_v1\s*:/gm;
  const existing=(text.match(keyRe)||[]).length;
  if(existing===1) return text;
  if(existing>1) fail('base_duplicate_action');
  const anchor="  honartik_iticket_dark_backend_batch2_v1: { operation: 'host_action.honartik_iticket_dark_backend_batch2_v1', rollback: 'host-action-v2:honartik-iticket-dark-backend-batch2-v1:worktree-file-rollback' },";
  const count=text.split(anchor).length-1;
  if(count!==1) fail('base_anchor_ambiguous');
  const line="  root_scripts_fixed_stage_v1: { operation: 'host_action.root_scripts_fixed_stage_v1', rollback: 'host-action-v2:root-scripts-fixed-stage-v1:fixed-artifact-restore' },";
  return text.replace(anchor, anchor+'\n'+line);
}
function patchApprovalPolicy(text){
  let p; try{p=JSON.parse(text)}catch{fail('policy_json_invalid')}
  if(!p.operations || !Array.isArray(p.scopes)) fail('policy_shape_invalid');
  const op='host_action.root_scripts_fixed_stage_v1';
  if(p.operations[op] && p.operations[op].level!==4) fail('policy_operation_conflict');
  if(!p.operations[op]) p.operations[op]={level:4};
  const matches=p.scopes.filter(x=>x && x.action===SPEC.target_action);
  if(matches.length>1) fail('policy_scope_duplicate');
  if(matches.length===0){
    const ref=p.scopes.filter(x=>x && x.action===SPEC.reference_action);
    if(ref.length!==1) fail('policy_reference_scope_ambiguous');
    const scope=JSON.parse(JSON.stringify(ref[0]));
    scope.action=SPEC.target_action; scope.operation=op;
    p.scopes.push(scope);
  } else if(matches[0].operation!==op) fail('policy_scope_conflict');
  return JSON.stringify(p,null,2)+'\n';
}
function materializeOne(source,destination,expectedSha,mode=0o600){
  const src=readRegular(source), actual=sha256(src); if(actual!==expectedSha) fail('artifact_source_sha_mismatch:'+path.basename(source));
  fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
  if(fs.existsSync(destination)){
    const cur=readRegular(destination); if(sha256(cur)===expectedSha) return {changed:false,sha256:expectedSha};
    fail('artifact_destination_conflict:'+path.basename(destination));
  }
  const tmp=destination+'.tmp-'+process.pid+'-'+Date.now();
  fs.writeFileSync(tmp,src,{mode,flag:'wx'}); fs.fsyncSync(fs.openSync(tmp,'r')); fs.chmodSync(tmp,mode); fs.renameSync(tmp,destination);
  if(sha256(readRegular(destination))!==expectedSha) fail('artifact_destination_sha_mismatch:'+path.basename(destination));
  return {changed:true,sha256:expectedSha};
}
function runRecovery(){ fail('canonical_artifact_provenance_unresolved'); }
module.exports={SPEC,sha256,verifyBaselines,verifyExecutorCapability,patchBaseRegistry,patchApprovalPolicy,materializeOne,runRecovery};
