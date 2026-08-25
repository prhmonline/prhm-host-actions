import crypto from 'node:crypto';

export const FIXED=Object.freeze({
  bridge_action:'root_scripts_fixed_stage_action_specific_request_first_install_bridge_v1',
  bridge_operation:'host_action.root_scripts_fixed_stage_action_specific_request_first_install_bridge_v1',
  bridge_arguments_sha256:'91c4dfa7b0eeda3237006a7816aac435bbab541387672ce5a5a5df16be331a1a',
  root_scripts_candidate_sha256:'d464e0aa0b8daa6c1e623f523917c27c5da065e388c1017b3fe7d9098433e60e',
  root_scripts_helper_sha256:'50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee',
  agent_api:Object.freeze({target:'agent_api',path:'selfmaintRoutes.js',expected_sha256:'45f22b6879add519c51a0dadaf9840a62b1be3d0301f562f70b92656a89fa8c4'}),
  agent_mcp:Object.freeze({target:'agent_mcp',path:'src/plugins/selfmaint.js',expected_sha256:'0cc9fd75a064fdee5e4c2f161fa8bc0c4470e65cb3b079ce3abe67113b6676ab'}),
  second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'
});

export function requestToolSchema(){return {}}
export function applyToolSchema(){return {request_id:'uuid',second_confirmation:FIXED.second_confirmation}}
function bind(cfg,newContent){
  if(typeof newContent!=='string'||Buffer.byteLength(newContent,'utf8')<1||Buffer.byteLength(newContent,'utf8')>120000)throw new Error('fixed_candidate_content_invalid');
  return {target:cfg.target,path:cfg.path,expected_sha256:cfg.expected_sha256,new_content:newContent};
}
export function agentApiSelfmaintBinding(newContent){return bind(FIXED.agent_api,newContent)}
export function agentMcpSelfmaintBinding(newContent){return bind(FIXED.agent_mcp,newContent)}
export function canonicalBridgeArguments(){return {action:FIXED.bridge_action}}
export function verifyCanonicalBridgeHash(){
  const got=crypto.createHash('sha256').update(JSON.stringify(canonicalBridgeArguments())).digest('hex');
  if(got!==FIXED.bridge_arguments_sha256)throw new Error('fixed_arguments_hash_internal_mismatch');
  return true;
}
export function validatePendingRequest(r,requestId,now=Date.now()){
  if(!r||r.status!=='pending')throw new Error('request_not_pending');
  if(String(r.request_id||'')!==String(requestId||''))throw new Error('request_id_mismatch');
  if(String(r.action||'')!==FIXED.bridge_action)throw new Error('action_mismatch');
  if(String(r.arguments_sha256||'')!==FIXED.bridge_arguments_sha256)throw new Error('arguments_sha_mismatch');
  const exp=Date.parse(String(r.expires_at||''));if(!Number.isFinite(exp)||now>=exp)throw new Error('request_expired');
  return true;
}
verifyCanonicalBridgeHash();
