'use strict';
const crypto=require('node:crypto');

const SEED_ACTION='control_plane_root_of_trust_out_of_band_fixed_seed_v1';
const TARGET_ACTION='control_plane_typed_bootstrap_fixed_verifier_native_install_v1';
const TARGET_OPERATION='host_action.control_plane_typed_bootstrap_fixed_verifier_native_install_v1';
const EXPECTED_BASELINES=Object.freeze({
  base:'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',
  executor:'1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',
  mcp:'44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71',
  policy:'76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'
});
const BOUND_ARTIFACTS=Object.freeze({
  installer_implementation:Object.freeze({name:'control-plane-typed-bootstrap-fixed-verifier-native-install-v1.js',sha256:'eeeccf448d9792ea69df4313864374945684e7cbb1ae6b0eedfa37b84d51f369'}),
  installer_test:Object.freeze({name:'test-v1-control-plane-typed-bootstrap-fixed-verifier-native-install.js',sha256:'7fb9e74d823dafc967928b65ef16bff74489d108aa2642399c027da660708a8c'}),
  installer_manifest:Object.freeze({name:'control-plane-typed-bootstrap-fixed-verifier-native-install-v1.manifest.json',sha256:'a75182d3a5160b38e27e396765e0a7fd9d1aed5e556e2f6b566c5dcdcca29d99'}),
  verifier:Object.freeze({name:'control-plane-typed-bootstrap-embedded-payload-fixed-verifier-v1.js',sha256:'f5e3cb6a9ce6c88229ffbd2fafd1e48742562f8c3edbc7aac113e2cb4f292b5a'})
});
const FIXED_SERVICES=Object.freeze(['prhm-agent-selfmaint.service','prhm-agent-selfmaint-exec.service','prhm-agent-mcp.service']);
function fail(code){throw new Error(code)}
function sha256(v){return crypto.createHash('sha256').update(Buffer.from(String(v))).digest('hex')}
function validateSeedExecutionContract(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('execution_contract_invalid');
  if(Object.keys(input).length)fail('arbitrary_input_rejected');
  return {ok:true,zero_input:true,one_shot:true,park_production_mutation:false,database_mutation:false,fixed_service_allowlist:true};
}
function verifySeedPreflight(current,artifacts){
  if(!current||typeof current!=='object')fail('baseline_map_invalid');
  for(const [k,v] of Object.entries(EXPECTED_BASELINES))if(current[k]!==v)fail('baseline_drift:'+k);
  if(!artifacts||typeof artifacts!=='object')fail('artifact_map_invalid');
  for(const [k,v] of Object.entries(BOUND_ARTIFACTS)){
    const a=artifacts[k];if(!a||a.name!==v.name||a.sha256!==v.sha256)fail('artifact_sha_mismatch:'+k);
  }
  return {ok:true,baseline_bound:true,artifact_bound:true};
}
function replaceUnique(source,anchor,replacement,label){
  const n=String(source).split(anchor).length-1;
  if(n===0)fail(label+'_anchor_missing');
  if(n!==1)fail(label+'_anchor_ambiguous');
  return source.replace(anchor,replacement);
}
function makeTestFixtures(){
  return {
    base:"const ACTIONS={\n  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }\n};\n",
    executor:"const ACTIONS={\n  imotion_credential_bind_v1:{operation:'host_action.imotion_credential_bind_v1',kind:'imotion_credential_bind_v1'}\n};\nfunction applyHostActionV2(action){return applyHostActionV2Original(action);}\n",
    mcp:"const HostActionV2=z.enum(['imotion_credential_bind_v1']);\n",
    policy:JSON.stringify({schema_version:'prhm.approval-policy.v1',operations:{'host_action.imotion_credential_bind_v1':{level:4}}},null,2)+'\n'
  };
}
function exactMarkers(){
  return {
    base:TARGET_ACTION+": { operation: '"+TARGET_OPERATION+"', rollback: 'fixed-seed:rollback' }",
    executor:TARGET_ACTION+":{operation:'"+TARGET_OPERATION+"',kind:'"+TARGET_ACTION+"'}",
    mcp:"'"+TARGET_ACTION+"'"
  };
}
function isAlreadyInstalled(s){
  const m=exactMarkers();let po;try{po=JSON.parse(s.policy)}catch{return false}
  return s.base.includes(m.base)&&s.executor.includes(m.executor)&&s.executor.includes("if(action==='"+TARGET_ACTION+"')return applyControlPlaneTypedBootstrapFixedVerifierNativeInstallV1();")&&s.mcp.includes(m.mcp)&&po?.operations?.[TARGET_OPERATION]?.level===4;
}
function planSeedPromotion(sources,currentSha=EXPECTED_BASELINES,artifacts=BOUND_ARTIFACTS){
  validateSeedExecutionContract({});verifySeedPreflight(currentSha,artifacts);
  if(!sources||typeof sources!=='object')fail('sources_invalid');
  if(isAlreadyInstalled(sources))return {ok:true,changed:false,status:'already_installed',before:{...sources},after:{...sources},invariants:{fixed_service_allowlist:true,park_production_mutation:false}};
  const marker=TARGET_ACTION;
  for(const k of ['base','executor','mcp'])if(String(sources[k]||'').includes(marker))fail(k+'_target_conflict');
  const baseAnchor="imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }";
  const executorAnchor="imotion_credential_bind_v1:{operation:'host_action.imotion_credential_bind_v1',kind:'imotion_credential_bind_v1'}";
  const dispatchAnchor='return applyHostActionV2Original(action);';
  const mcpAnchor="'imotion_credential_bind_v1'";
  const markers=exactMarkers();
  let base=replaceUnique(sources.base,baseAnchor,baseAnchor+',\n  '+markers.base,'base');
  let executor=replaceUnique(sources.executor,executorAnchor,executorAnchor+',\n  '+markers.executor,'executor');
  executor=replaceUnique(executor,dispatchAnchor,"if(action==='"+TARGET_ACTION+"')return applyControlPlaneTypedBootstrapFixedVerifierNativeInstallV1();"+dispatchAnchor,'executor_dispatch');
  let mcp=replaceUnique(sources.mcp,mcpAnchor,mcpAnchor+","+markers.mcp,'mcp');
  let po;try{po=JSON.parse(sources.policy)}catch{fail('policy_json_invalid')}
  if(!po.operations||typeof po.operations!=='object'||Array.isArray(po.operations))fail('policy_operations_invalid');
  if(Object.prototype.hasOwnProperty.call(po.operations,TARGET_OPERATION))fail('policy_target_conflict');
  po.operations[TARGET_OPERATION]={level:4};
  const policy=JSON.stringify(po,null,2)+'\n';
  const helper=JSON.stringify({schema_version:'prhm.fixed-seed-helper-binding.v1',action:TARGET_ACTION,artifact:BOUND_ARTIFACTS.installer_implementation},null,2)+'\n';
  return {ok:true,changed:true,status:'planned',before:{...sources},after:{base,executor,mcp,policy,helper},invariants:{fixed_service_allowlist:true,park_production_mutation:false,services:[...FIXED_SERVICES]}};
}
function simulateSeedTransaction(state,failurePoint=null,options={}){
  if(options?.consumed===true)return {ok:true,status:'already_consumed',changed:false,rollbackPerformed:false,state:{...state},consumed:true};
  const plan=planSeedPromotion(state,EXPECTED_BASELINES,BOUND_ARTIFACTS);
  if(plan.changed===false)return {ok:true,status:'already_installed',changed:false,rollbackPerformed:false,state:{...state},consumed:true};
  const before={...state},working={...state};
  const order=['base','executor','mcp','policy','helper'];
  try{
    for(const k of order){working[k]=plan.after[k];if(failurePoint===k)fail('simulated_failure:'+k)}
    if(failurePoint==='reload')fail('simulated_failure:reload');
    return {ok:true,status:'installed',changed:true,rollbackPerformed:false,state:working,consumed:true};
  }catch(e){return {ok:false,error:e.message,changed:false,rollbackPerformed:true,state:before,consumed:false}}
}
function runFixedSeed(){
  validateSeedExecutionContract({});
  return {ok:true,schema_version:'prhm.control-plane-root-of-trust-out-of-band-fixed-seed.v1',action:SEED_ACTION,target_action:TARGET_ACTION,zero_input:true,one_shot:true,build_only:true,park_production_mutation:false};
}
module.exports={SEED_ACTION,TARGET_ACTION,TARGET_OPERATION,EXPECTED_BASELINES,BOUND_ARTIFACTS,FIXED_SERVICES,sha256,validateSeedExecutionContract,verifySeedPreflight,makeTestFixtures,planSeedPromotion,simulateSeedTransaction,runFixedSeed};
