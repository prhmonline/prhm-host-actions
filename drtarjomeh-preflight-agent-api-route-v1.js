'use strict';
// SHA-bound, fixed-input API route; does NOT install/register itself.
// Registration on Agent 3 is a distinct Level-4 control-plane change.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');

const ROUTE='/drtarjomeh/security/current-release/preflight';
const TOOL='drtarjomeh_current_release_preflight_readonly_v1';
const ARTIFACT='/opt/prhm-agent-readonly-actions/drtarjomeh-current-release-preflight-v1.js';
const SOURCE_GIT_BLOB='b69bcc0bab682bd741c66d93b86c82c2091db7c8';
const SOURCE_COMMIT='d2a56b13a7c076552461bea4d6ea7aaf8e02b683';
const EXPECTED_RELEASE='20261006-224241-0e8686eed30f';

function fail(code){throw new Error(code);}
function gitBlobSha(bytes){
  const hdr=Buffer.from('blob '+bytes.length+'\0','utf8');
  return crypto.createHash('sha1').update(hdr).update(bytes).digest('hex');
}
function readPinnedModule(){
  // No symlink at the exact artifact or its fixed parent.
  const dir=path.dirname(ARTIFACT);
  const dst=fs.lstatSync(dir);
  if(!dst.isDirectory()||dst.isSymbolicLink()||fs.realpathSync(dir)!==dir)fail('preflight_artifact_directory_invalid');
  const st=fs.lstatSync(ARTIFACT);
  if(!st.isFile()||st.isSymbolicLink())fail('preflight_artifact_not_regular');
  const bytes=fs.readFileSync(ARTIFACT);
  if(gitBlobSha(bytes)!==SOURCE_GIT_BLOB)fail('preflight_artifact_git_blob_mismatch');
  // Compile verified bytes rather than loading a file again (no read/check/reload race).
  const mod=new Module(ARTIFACT,module);
  mod.filename=ARTIFACT;
  mod.paths=Module._nodeModulePaths(dir);
  mod._compile(bytes.toString('utf8'),ARTIFACT);
  if(typeof mod.exports?.preflight!=='function')fail('preflight_export_missing');
  if(mod.exports.EXPECTED_RELEASE!==EXPECTED_RELEASE)fail('preflight_release_mismatch');
  return mod.exports;
}
function validateEvidence(out){
  if(!out||typeof out!=='object'||Array.isArray(out))fail('preflight_result_invalid');
  if(out.schema!=='prhm.drtarjomeh.security-preflight.v1'||out.audit_only!==true ||
    out.production_mutation!==false||out.cutover_authorized!==false||
    out.expected_release!==EXPECTED_RELEASE||
    out.source_commit!=='f22b1d17801239f7539f84e5aa8b91250c87dc58'||
    typeof out.gate!=='string'||!out.gate.startsWith('BLOCKED'))fail('preflight_contract_invalid');
  if(!['MATCH','MISMATCH','NOT_SYMLINK','MISSING','UNAVAILABLE'].includes(out.pointer_identity))fail('preflight_pointer_invalid');
  if(!Array.isArray(out.files)||(out.pointer_identity==='MATCH'&&out.files.length!==24)||
    (out.pointer_identity!=='MATCH'&&out.files.length!==0))fail('preflight_files_invalid');
  const statuses=['REGULAR','MISSING','UNAVAILABLE','SYMLINK','PARENT_SYMLINK','NON_REGULAR','PARENT_NOT_DIRECTORY','UNSAFE_PATH'];
  for(const f of out.files){
    if(!f||typeof f.path!=='string'||typeof f.status!=='string'||!statuses.includes(f.status))fail('preflight_item_invalid');
    if(f.status==='REGULAR'&&(!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isInteger(f.bytes)))fail('preflight_sha_invalid');
    if('content' in f||'data' in f)fail('preflight_leak_risk');
  }
  if(!out.protected_env||out.protected_env.contents_read!==false||
    'content' in out.protected_env||'sha256' in out.protected_env)fail('preflight_env_leak_risk');
  return out;
}
function runPinnedPreflight(){
  const source=readPinnedModule();
  return validateEvidence(source.preflight());
}
function handler(req,res,runner=runPinnedPreflight){
  const body=req?.body==null?{}:req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==0)
    return res.status(400).json({ok:false,error:'drtarjomeh_preflight_zero_input_required'});
  try{return res.json(runner());}
  catch{return res.status(409).json({ok:false,error:'drtarjomeh_preflight_readonly_failed'});}
}
function registerDrtarjomehReadonlyPreflightRoute(app,{auth}){
  if(!app||typeof app.post!=='function'||typeof auth!=='function')fail('preflight_registration_invalid');
  app.post(ROUTE,auth,(req,res)=>handler(req,res));
}
module.exports=Object.freeze({ROUTE,TOOL,ARTIFACT,SOURCE_GIT_BLOB,SOURCE_COMMIT,EXPECTED_RELEASE,gitBlobSha,validateEvidence,runPinnedPreflight,handler,registerDrtarjomehReadonlyPreflightRoute});
