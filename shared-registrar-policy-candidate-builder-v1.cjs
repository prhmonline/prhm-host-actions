'use strict';
/**
 * OFFLINE, SOURCE-ONLY candidate builder for the EXISTING Approval Center
 * policy owner. No installed/root/Approval Center side effects.
 * Reads only an exact-SHA private baseline, writes a distinct private
 * candidate path (exclusive create). Never sees credentials/signing keys.
 * This candidate is INERT until independently approved trusted bootstrap.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ORIGINAL_SHA='148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174';
const OLD_VERSION='2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1';
const NEW_VERSION='2026-10-27.2-shared-registrar-bootstrap-proposal';
const ACTION='prhm_action_registry_install_v1';
const OPERATION='host_action.'+ACTION;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function stop(s){throw Error('registrar_policy_candidate_'+s)}
function build(original){
 if(!Buffer.isBuffer(original)||sha(original)!==ORIGINAL_SHA)
  stop('baseline_sha_mismatch');
 let p;
 try{p=JSON.parse(original.toString('utf8'))}
 catch{stop('baseline_json_invalid')}
 if(p.schema_version!=='prhm.approval-policy.v1'||
    p.version!==OLD_VERSION||p.default_deny!==true||
    p.scope_freeze!==true||p.one_time_use!==true||
    !p.operations||typeof p.operations!=='object'||
    !Array.isArray(p.typed_scopes)||
    Object.hasOwn(p.operations,OPERATION)||
    p.typed_scopes.some(x=>x?.action===ACTION))
  stop('baseline_policy_contract_drift');
 if(!original.equals(Buffer.from(JSON.stringify(p,null,2)+'\n')))
  stop('baseline_format_changed');
 const oldOperations=Object.keys(p.operations);
 const oldScopeCount=p.typed_scopes.length;
 p.version=NEW_VERSION;
 p.operations[OPERATION]={
  level:4,risk:'critical',one_time_use:true,
  requires_second_confirmation:true,policy_version:NEW_VERSION
 };
 p.typed_scopes.push({
  tool:'host_action_v2_apply',project:'control_plane',
  environment:'production',action:ACTION,risk:'critical',
  operation:OPERATION,principals:[{
   principal_id:'mohammad',roles:['mcp-operator']
  }]
 });
 if(Object.keys(p.operations).length!==oldOperations.length+1||
    oldOperations.some((k,i)=>Object.keys(p.operations)[i]!==k)||
    p.typed_scopes.length!==oldScopeCount+1)stop('existing_policy_modified');
 const bytes=Buffer.from(JSON.stringify(p,null,2)+'\n');
 const reparsed=JSON.parse(bytes.toString('utf8'));
 if(reparsed.version!==NEW_VERSION||
   reparsed.operations[OPERATION].level!==4||
   reparsed.typed_scopes.at(-1).action!==ACTION)
  stop('candidate_validation_failed');
 // Issuer computes policy_hash as SHA256 of compact JSON.stringify(config).
 const issuerHash=sha(Buffer.from(JSON.stringify(reparsed)));
 return Object.freeze({
  bytes,after_sha256:sha(bytes),issuer_policy_hash:issuerHash,
  before_sha256:ORIGINAL_SHA,operation:OPERATION,
  version:NEW_VERSION,old_operation_count:oldOperations.length,
  old_scope_count:oldScopeCount
 });
}
function createPrivate(inputDir,outputDir){
 const inp=path.resolve(inputDir),out=path.resolve(outputDir);
 if(inp===out||out===path.parse(out).root)stop('unsafe_output_path');
 const original=fs.readFileSync(path.join(inp,'approval-policy.json'));
 const result=build(original);
 // Output directory must already be provisioned with restrictive ACLs.
 if(!fs.statSync(out).isDirectory())stop('output_dir_invalid');
 const target=path.join(out,'approval-policy.json');
 const fd=fs.openSync(target,'wx',0o600);
 try{fs.writeSync(fd,result.bytes);fs.fsyncSync(fd)}
 finally{fs.closeSync(fd)}
 return Object.freeze({ok:true,candidate_only:true,production_mutation:false,
  path:target,before_sha256:result.before_sha256,
  after_sha256:result.after_sha256,issuer_policy_hash:result.issuer_policy_hash,
  version:result.version,added_operation:result.operation,
  retained_operations:result.old_operation_count,
  retained_scopes:result.old_scope_count});
}
module.exports=Object.freeze({ORIGINAL_SHA,OLD_VERSION,NEW_VERSION,
 ACTION,OPERATION,build,createPrivate});
if(require.main===module){
 try{
  if(process.argv.length!==4)stop('usage_private_baseline_dir_and_private_candidate_dir_required');
  process.stdout.write(JSON.stringify(createPrivate(process.argv[2],process.argv[3]))+'\n');
 }catch(e){process.stderr.write(e.message+'\n');process.exitCode=1}
}
