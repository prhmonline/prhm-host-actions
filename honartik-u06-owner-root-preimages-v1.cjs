'use strict';
/*
 * U06 owner root preimages, grounded in exact live Root console SHA evidence.
 * This is a read-only static trust boundary, NOT an installer, approval,
 * Host Action registry, or credential/bootstrap authority.
 */
const BASELINE=Object.freeze({
 schema:'prhm.u06.native-root-registration.owner-preimages.v1',
 host:'prhm-production.prhm.ir',
 project:'honartik_back.production',
 action:'honartik_u06_native_backup_register_v1',
 profile_sha256:'79783874cb5170eec3dedcc536f713c4567c585e118f881c1035862a7bba8698',
 adapter_sha256:'d81223e31bde684f83d1b8b3c93a8fdf2bd4797db33159bf681e6d3898ade2a3',
 owners:Object.freeze({
  agent_api:Object.freeze({path:'/opt/prhm-agent-selfmaint/server.js',sha256:'57828b344aca1d1fb51e74cc2c64094edb03c5fd86fe68420d7185f0d12b6530',uid:0,gid:0,mode:'0644',size:34605}),
  root_executor:Object.freeze({path:'/opt/prhm-agent-selfmaint-exec/server.js',sha256:'4c136a210681ee07a45d96d38d91c1253afcce67feed0a9d062f9f14d0557169',uid:0,gid:0,mode:'0755',size:115918}),
  agent3_mcp:Object.freeze({path:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',sha256:'0c6a74757696a0d85840a0aec1bc53c91431481024f2be56e4ecb02f789073ef',uid:0,gid:0,mode:'0600',size:12321}),
  approval_policy:Object.freeze({path:'/opt/prhm-company-control-plane/config/approval-policy.json',sha256:'26359a31efdfe0acde07cc9f4001afddee98efaa206e4528880068bf93c425f5',uid:0,gid:0,mode:'0644',size:31167})
 })
});
const HEX64=/^[a-f0-9]{64}$/;
function fail(m){throw Error('u06_root_preimage_'+m);}
function exactKeys(actual,expected){
 if(!actual||typeof actual!=='object'||Array.isArray(actual))return false;
 return Object.keys(actual).sort().join('|')===expected.slice().sort().join('|');
}
/** validate *claimed* audit metadata only. Neither this nor caller-supplied
 * booleans prove that a trusted root actor performed the measurements.
 */
function reviewMetadata(evidence){
 if(!exactKeys(evidence,['host','profile_sha256','adapter_sha256','files']))fail('shape');
 if(evidence.host!==BASELINE.host||evidence.profile_sha256!==BASELINE.profile_sha256||
   evidence.adapter_sha256!==BASELINE.adapter_sha256)fail('host_or_universal_sha_drift');
 if(!exactKeys(evidence.files,Object.keys(BASELINE.owners)))fail('owner_count_or_shape');
 for(const [key,pin] of Object.entries(BASELINE.owners)){
  const item=evidence.files[key];
  if(!exactKeys(item,['path','sha256','uid','gid','mode','size','regular_file','symlink']))fail('file_shape_'+key);
  if(item.path!==pin.path||!HEX64.test(item.sha256)||item.sha256!==pin.sha256||
    item.uid!==pin.uid||item.gid!==pin.gid||item.mode!==pin.mode||item.size!==pin.size||
    item.regular_file!==true||item.symlink!==false)fail('owner_preimage_drift_'+key);
 }
 return Object.freeze({
  source_claims_match:true,
  authorized_root_registry_installer:false,
  native_root_action_installed:false,
  production_writes_allowed:false,
  next:'independent_root_owned_byte_review_and_fixed_installer'
 });
}
module.exports=Object.freeze({BASELINE,reviewMetadata,ROOT_REGISTRATION_ALLOWED:false,APPLICATION_DEPLOY_ALLOWED:false});
