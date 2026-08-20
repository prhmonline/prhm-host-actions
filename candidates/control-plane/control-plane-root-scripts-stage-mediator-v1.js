import crypto from 'node:crypto';

export const FIXED_BINDING=Object.freeze({
  principal_id:'mohammad',
  role:'mcp-operator',
  tool:'control_plane_root_scripts_stage_transport_apply_v1',
  project:'control_plane',
  environment:'production',
  action:'control_plane_root_scripts_stage_transport_v1',
  risk:'critical',
  operation:'host_action.control_plane_root_scripts_stage_transport_v1'
});
export const ROLLBACK_REFERENCE='root-stage-v1:invocation-bound-two-files';
export const CONFIRM_LITERAL='CONFIRM_LEVEL_4_CRITICAL';
export const ARGUMENTS=Object.freeze({action:FIXED_BINDING.action});
export const ARGUMENTS_SHA256=crypto.createHash('sha256').update(JSON.stringify(ARGUMENTS)).digest('hex');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireFn(value,name){if(typeof value!=='function')throw new Error(`${name}_required`);return value}
function requireRequestId(id){const v=String(id||'');if(!UUID.test(v))throw new Error('invalid_request_id');return v}
function requestFrom(result){return result?.request||result}
function assertRequestBinding(request,id){
  if(!request||typeof request!=='object')throw new Error('request_binding_mismatch');
  if(id&&String(request.request_id||'')!==id)throw new Error('request_binding_mismatch');
  const expected={action:FIXED_BINDING.action,operation:FIXED_BINDING.operation,project:FIXED_BINDING.project,environment:FIXED_BINDING.environment,risk:FIXED_BINDING.risk,arguments_sha256:ARGUMENTS_SHA256};
  for(const [k,v] of Object.entries(expected))if(request[k]!==undefined&&String(request[k])!==String(v))throw new Error('request_binding_mismatch');
  if(Number(request.level)!==4)throw new Error('request_binding_mismatch');
  if(!UUID.test(String(request.request_id||'')))throw new Error('request_binding_mismatch');
  return request;
}
function boundedRequest(request){
  const out={request_id:String(request.request_id),status:String(request.status||'unknown'),level:Number(request.level),action:FIXED_BINDING.action,operation:FIXED_BINDING.operation,project:FIXED_BINDING.project,environment:FIXED_BINDING.environment,risk:FIXED_BINDING.risk,arguments_sha256:ARGUMENTS_SHA256,expires_at:request.expires_at??null};
  return out;
}
function approvalTokenFrom(result){const token=String(result?.approval_token||result?.token||result?.approval?.token||'');if(token.length<32||token.length>16384)throw new Error('approval_token_not_returned');return token}
function assertApprovalBinding(approval,requestId){
  if(!approval||approval.execution_authorized!==true)throw new Error('approval_not_execution_authorized');
  if(approval.request_id&&String(approval.request_id)!==requestId)throw new Error('approval_request_mismatch');
  for(const [k,v] of [['action',FIXED_BINDING.action],['operation',FIXED_BINDING.operation],['arguments_sha256',ARGUMENTS_SHA256]])if(approval[k]&&String(approval[k])!==String(v))throw new Error('approval_binding_mismatch');
}
function bridgeBinding(token){return {approval_token:token,...FIXED_BINDING,arguments_sha256:ARGUMENTS_SHA256}}
function assertSecretFree(value){
  const bad=/token|authorization|password|passwd|secret|private[_-]?key/i;
  const visit=v=>{if(Array.isArray(v)){for(const x of v)visit(x);return}if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v)){if(bad.test(k))throw new Error('stage_result_secret_key_forbidden');visit(x)}}};
  visit(value); return value;
}

export function createRootScriptsStageMediator(deps){
  const createApprovalRequest=requireFn(deps?.createApprovalRequest,'createApprovalRequest');
  const getApprovalRequest=requireFn(deps?.getApprovalRequest,'getApprovalRequest');
  const decideApprovalRequest=requireFn(deps?.decideApprovalRequest,'decideApprovalRequest');
  const approvalBridge=requireFn(deps?.approvalBridge,'approvalBridge');
  return Object.freeze({
    async createRequest(){
      const body={...FIXED_BINDING,arguments:ARGUMENTS,arguments_sha256:ARGUMENTS_SHA256,ttl_seconds:180,rollback_reference:ROLLBACK_REFERENCE};
      const request=assertRequestBinding(requestFrom(await createApprovalRequest(body)));
      if(String(request.status||'')!=='pending')throw new Error('request_not_pending');
      return {request_id:request.request_id,binding_metadata:{action:FIXED_BINDING.action,operation:FIXED_BINDING.operation,project:FIXED_BINDING.project,environment:FIXED_BINDING.environment,risk:FIXED_BINDING.risk,arguments_sha256:ARGUMENTS_SHA256,level:4,expires_at:request.expires_at??null}};
    },
    async getStatus({request_id}){
      const id=requireRequestId(request_id); const request=assertRequestBinding(requestFrom(await getApprovalRequest(id)),id); return boundedRequest(request);
    },
    async applyApprovedRequest({request_id,second_confirmation},executeStage){
      const id=requireRequestId(request_id);
      if(String(second_confirmation||'')!==CONFIRM_LITERAL)throw new Error('critical_second_confirmation_required');
      requireFn(executeStage,'executeStage');
      const request=assertRequestBinding(requestFrom(await getApprovalRequest(id)),id);
      if(String(request.status||'')!=='pending')throw new Error('request_not_pending');
      const decided=await decideApprovalRequest(id,{decision:'accept',second_confirmation:CONFIRM_LITERAL,rollback_reference:ROLLBACK_REFERENCE,note:'Approved fixed root scripts staging transaction'});
      const token=approvalTokenFrom(decided); assertApprovalBinding(decided?.approval||{},id);
      const binding=bridgeBinding(token);
      const validated=await approvalBridge('/v1/validate',binding); if(validated?.valid!==true)throw new Error('approval_validation_failed');
      const consumed=await approvalBridge('/v1/consume',{...binding,consumer:'prhm-root-scripts-stage-mediator-v1'}); if(consumed?.consumed!==true)throw new Error('approval_consume_failed');
      return assertSecretFree(await executeStage());
    }
  });
}
