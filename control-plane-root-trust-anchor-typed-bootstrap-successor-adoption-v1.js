'use strict';
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const ACTION = 'control_plane_root_scripts_stage_transport_v1';
const OPERATION = 'host_action.control_plane_root_scripts_stage_transport_v1';
const ARTIFACTS = Object.freeze({
  transport: Object.freeze({bytes:72854, sha256:'049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335e'}),
  bootstrap: Object.freeze({bytes:109634, sha256:'d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e'})
});
const EXECUTION_CONTRACT = Object.freeze({level4Required:true, legacyFallback:false, parkProductionMutation:false});
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
function decodeOne(value, expected) {
  if (typeof value !== 'string' || !value.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('artifact_base64_invalid');
  let raw; try { raw=zlib.brotliDecompressSync(Buffer.from(value,'base64')); } catch { throw new Error('artifact_brotli_invalid'); }
  if (raw.length !== expected.bytes) throw new Error('artifact_bytes_mismatch');
  if (sha256(raw) !== expected.sha256) throw new Error('artifact_sha256_mismatch');
  return raw;
}
function verifyEmbeddedArtifacts(input) {
  const transport=decodeOne(input.transportCompressedBase64, ARTIFACTS.transport);
  const bootstrap=decodeOne(input.bootstrapCompressedBase64, ARTIFACTS.bootstrap);
  return {ok:true,transportSha256:sha256(transport),transportBytes:transport.length,bootstrapSha256:sha256(bootstrap),bootstrapBytes:bootstrap.length};
}
function validateExecutionContract(c) {
  const allowed=['level4Required','legacyFallback','parkProductionMutation'];
  if (!c || Object.keys(c).some(k=>!allowed.includes(k))) throw new Error('execution_contract_unknown_key');
  if (c.level4Required!==true) throw new Error('level4_required');
  if (c.legacyFallback!==false) throw new Error('legacy_fallback_forbidden');
  if (c.parkProductionMutation!==false) throw new Error('park_production_mutation_forbidden');
  return {ok:true};
}
function planSuccessorAdoption({baseSource,approvalPolicy}) {
  if (typeof baseSource!=='string' || typeof approvalPolicy!=='string') throw new Error('adoption_input_invalid');
  const actionKey=`'${ACTION}'`;
  const count=(baseSource.match(new RegExp(actionKey.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&'),'g'))||[]).length;
  if (count>1) throw new Error('duplicate_action_registration');
  const policyCount=(approvalPolicy.match(new RegExp(OPERATION.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&'),'g'))||[]).length;
  if (policyCount!==1) throw new Error('approval_policy_binding_invalid');
  if (!approvalPolicy.includes('critical') && !approvalPolicy.includes('level4')) throw new Error('approval_policy_level4_missing');
  if (count===1) return {baseSource,approvalPolicy,changed:false,invariants:EXECUTION_CONTRACT};
  const anchor='const HOST_ACTIONS = {';
  if ((baseSource.split(anchor).length-1)!==1) throw new Error('registry_anchor_invalid');
  const patched=baseSource.replace(anchor,`${anchor}\n  '${ACTION}': { fixed: true, operation: '${OPERATION}' },`);
  return {baseSource:patched,approvalPolicy,changed:true,invariants:EXECUTION_CONTRACT};
}
function simulateTransactionalAdoption(state,failurePoint) {
  const before=structuredClone(state); let next=structuredClone(state);
  try {
    next.registryPatched=true; if(failurePoint==='after_registry') throw new Error('injected_failure');
    next.policyPatched=true; if(failurePoint==='after_policy') throw new Error('injected_failure');
    next.firstArtifactStaged=true; if(failurePoint==='after_first_artifact') throw new Error('injected_failure');
    if (state.registryPatched && state.policyPatched && state.firstArtifactStaged) return {ok:true,rollbackPerformed:false,changed:false,state:next};
    return {ok:true,rollbackPerformed:false,changed:true,state:next};
  } catch { return {ok:false,rollbackPerformed:true,changed:false,state:before}; }
}
module.exports={ACTION,OPERATION,ARTIFACTS,EXECUTION_CONTRACT,verifyEmbeddedArtifacts,validateExecutionContract,planSuccessorAdoption,simulateTransactionalAdoption};
