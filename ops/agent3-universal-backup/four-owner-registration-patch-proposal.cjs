'use strict';
/**
 * Four-owner Agent 3 registration PATCH PROPOSAL, NEVER an installer.
 *
 * Only pure transforms of exact preimage-pinned byte strings are permitted.
 * It deliberately DOES NOT inject a runnable executor dispatcher. The
 * authenticated consumed-Level-4 execution adapter must be reviewed before
 * the four output buffers may become a release manifest.
 *
 * No CLI --apply, no filesystem writes, no signing, no restart, no secrets.
 */
const crypto=require('node:crypto');
const {TextDecoder}=require('node:util');
const pins=require('./production-registration-contract.json');
const {OWNERS}=require('./four-owner-readonly-preflight.cjs');
const ACTION='agent3_universal_backup_engine_install_v1';
const OPERATION='host_action.'+ACTION;
const KEYS=Object.freeze(['base','executor','policy','mcp']);
const HASH=/^[a-f0-9]{64}$/;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false});
function deny(reason){throw Error('agent3_owner_patch_denied:'+reason);}
function textOf(bytes,key){
 if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>20*1024*1024)
  deny('invalid_owner_buffer:'+key);
 if(sha(bytes)!==pins.preimage_sha256[key])deny('preimage_drift:'+key);
 let s;
 try{s=utf8.decode(bytes);}catch{deny('invalid_utf8:'+key);}
 if(Buffer.from(s,'utf8').equals(bytes)===false)deny('noncanonical_utf8:'+key);
 if(s.includes(ACTION)||s.includes(OPERATION))deny('action_already_present:'+key);
 return s;
}
function insertOnce(s,anchor,newText,label){
 if(typeof s!=='string'||typeof anchor!=='string'||!anchor||typeof newText!=='string')
  deny('invalid_transform_input:'+label);
 if(s.split(anchor).length!==2)deny('anchor_missing_or_duplicate:'+label);
 return s.replace(anchor,newText+anchor);
}
function baseTransform(s){
 const anchor="  host_action_v2_installer_v1: { operation: 'host_action.host_action_v2_installer_v1', rollback: 'host-action-v2:host-action-v2-installer-v1:four-file-restore' }";
 return insertOnce(s,anchor,
  "  "+ACTION+": { operation: '"+OPERATION+
  "', rollback: 'host-action-v2:agent3-universal-backup-engine-install-v1:verified-four-owner-restore' },\n",
  'base_operation');
}
function executorTransform(s){
 const anchor="  host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'},";
 const dispatchAnchor="if(action==='host_action_v2_installer_v1')return applyHostActionV2InstallerV1();";
 if(s.split(dispatchAnchor).length!==2)deny('executor_trusted_dispatch_anchor_missing');
 return insertOnce(s,anchor,
  "  "+ACTION+":{operation:'"+OPERATION+"',kind:'"+ACTION+"'},\n",
  'executor_spec');
}
function mcpTransform(s){
 const anchor="'control_plane_current_owner_binding_refresh_v1']);";
 return insertOnce(s,anchor,"'"+ACTION+"',",'mcp_enum');
}
function policyTransform(s){
 let p;
 try{p=JSON.parse(s);}catch{deny('policy_invalid_json');}
 if(!p||typeof p!=='object'||Array.isArray(p)||
    !p.operations||typeof p.operations!=='object'||Array.isArray(p.operations)||
    !Array.isArray(p.typed_scopes))deny('policy_schema_mismatch');
 if(Object.prototype.hasOwnProperty.call(p.operations,OPERATION)||
    p.typed_scopes.some(x=>x&&x.action===ACTION||x&&x.operation===OPERATION))
  deny('duplicate_approval_operation');
 p.operations[OPERATION]={level:4,risk:'critical'};
 p.typed_scopes.push({
  tool:'host_action_v2_apply',project:'control_plane',
  environment:'production',action:ACTION,risk:'critical',
  operation:OPERATION,
  principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
 });
 return JSON.stringify(p,null,2)+'\n';
}
function propose(ownerBytes){
 if(!pins||pins.schema!=='prhm.agent3.universal-backup.registration-contract.v1'||
    pins.action!==ACTION||pins.approval?.level!==4||
    pins.host!=='prhm-production')deny('pin_contract_invalid');
 if(!ownerBytes||typeof ownerBytes!=='object'||Array.isArray(ownerBytes)||
    Object.keys(ownerBytes).sort().join('|')!==KEYS.slice().sort().join('|'))
  deny('exact_four_owner_buffers_required');
 const source=Object.fromEntries(KEYS.map(k=>[k,textOf(ownerBytes[k],k)]));
 const out=Object.freeze({
  base:Buffer.from(baseTransform(source.base)),
  executor:Buffer.from(executorTransform(source.executor)),
  policy:Buffer.from(policyTransform(source.policy)),
  mcp:Buffer.from(mcpTransform(source.mcp))
 });
 return Object.freeze({
  schema:'prhm.agent3.four-owner-patch-proposal.v1',
  action:ACTION,operation:OPERATION,
  owner_paths:OWNERS,
  after_sha256:Object.freeze(Object.fromEntries(KEYS.map(k=>[k,sha(out[k])]))),
  candidate_buffers:out,
  // An action entry without verified Level-4 executor wiring is unsafe.
  execution_adapter_reviewed:false,
  dispatcher_connected:false,
  ready_for_registration_manifest:false,
  registration_performed:false,
  approval_consumed:false,
  production_mutation:false
 });
}
if(require.main===module){
 process.stderr.write('source-only patch proposal; no install or registry mutation\n');
 process.exitCode=78;
}
module.exports=Object.freeze({ACTION,OPERATION,KEYS,baseTransform,
 executorTransform,mcpTransform,policyTransform,insertOnce,propose});
