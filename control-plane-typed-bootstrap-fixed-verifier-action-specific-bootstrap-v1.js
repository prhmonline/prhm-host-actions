'use strict';
const ACTION='control_plane_typed_bootstrap_fixed_verifier_bootstrap_v1';
const TARGET_TOOL='control_plane_typed_bootstrap_embedded_payload_integrity_verify_v1';
const VERIFIER_SHA='f5e3cb6a9ce6c88229ffbd2fafd1e48742562f8c3edbc7aac113e2cb4f292b5a';
const BASELINE_SHAS=Object.freeze({base:'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',executor:'1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',mcp:'44520b67bb352ab243698c5cf50b39d09a65c833fee9cfd3ebc5a50379ecaa71',policy:'76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'});
const CONTRACT=Object.freeze({level4Required:true,zeroInput:true,arbitraryCommand:false,arbitraryPath:false,arbitraryRepo:false,externalNetwork:false,parkProductionMutation:false});
function planRegistration(current){
 if(!current||typeof current!=='object'||Array.isArray(current))throw new Error('baseline_input_invalid');
 for(const k of Object.keys(BASELINE_SHAS))if(current[k]!==BASELINE_SHAS[k])throw new Error('baseline_sha_mismatch:'+k);
 return {ok:true,schema_version:'prhm.control-plane-fixed-verifier-bootstrap-plan.v1',action:ACTION,target_tool:TARGET_TOOL,verifier_sha256:VERIFIER_SHA,inputs:{},level4_required:true,fixed_scope:true,arbitrary_command:false,arbitrary_path:false,arbitrary_repo:false,external_network:false,production_application_mutation:false};
}
module.exports={ACTION,TARGET_TOOL,VERIFIER_SHA,BASELINE_SHAS,CONTRACT,planRegistration};
