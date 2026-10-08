'use strict';
// FIXED read-only preflight. Not an installer; no registration or Production write.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const M=require('./drtarjomeh-preflight-agent3-registration-pins-v1.json');

const EXPECTED_PREIMAGES=Object.freeze([
  Object.freeze({root:'/home/agent/ssh-agent-api',path:'server.js',sha256:'c8af6a5ce5955629e5d6dd7737337d26164a267c00de36cd4ebec89a9e5a890c'}),
  Object.freeze({root:'/home/agent/ssh-agent-api',path:'honartikIticketV14PreflightRoutes.js',sha256:'d5f18db17ab57c9f82c1d3a6b9d1805e12ba813fb9a80001bdb781c42eefc42c'}),
  Object.freeze({root:'/home/agent/ssh-mcp-server',path:'src/core/registry.js',sha256:'7432741650ee5c5bc3bb72c1403050b27a665e9218153b40e58955da77b471a4'}),
  Object.freeze({root:'/home/agent/ssh-mcp-server',path:'src/plugins/honartikIticketPreflight.js',sha256:'963529d9ebec49e64ea98798ca0dbf2cd8542f4fb648213a05cb3351f83d28a2'})
]);
const EXPECTED_BLOBS=Object.freeze([
  Object.freeze({path:'drtarjomeh-current-release-preflight-v1.js',git_blob_sha:'b69bcc0bab682bd741c66d93b86c82c2091db7c8'}),
  Object.freeze({path:'drtarjomeh-preflight-agent-api-route-v1.js',git_blob_sha:'f6d5f921f3903a7da0c6c1873f908fc811a7f5a6'}),
  Object.freeze({path:'drtarjomeh-preflight-mcp-adapter-v1.mjs',git_blob_sha:'8103dd0dc7527180dbfdb595501a7112841d31b4'})
]);
function sha256(b){return crypto.createHash('sha256').update(b).digest('hex');}
function gitBlobSha(b){return crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function validateManifest(manifest=M){
  if(manifest.schema_version!=='prhm.drtarjomeh.readonly-registration-pins.v1'||
    manifest.mode!=='preflight_only'||manifest.production_mutation_authorized!==false||
    manifest.registration_authorized!==false||manifest.arbitrary_commands_allowed!==false||
    manifest.provider_credentials_returned!==false||
    manifest.host_actions_repository!=='prhmonline/prhm-host-actions'||
    manifest.approved_adapter_merge_commit!=='858fba81f53be63c1257b637fb4a9ca39c7fb7a4'||
    manifest.approved_audit_merge_commit!=='d2a56b13a7c076552461bea4d6ea7aaf8e02b683'||
    manifest.application_remediation_commit!=='f22b1d17801239f7539f84e5aa8b91250c87dc58'||
    manifest.expected_application_release!=='20261006-224241-0e8686eed30f'||
    !eq(manifest.live_control_plane_preimages,EXPECTED_PREIMAGES)||
    !eq(manifest.approved_artifacts,EXPECTED_BLOBS)||
    !Array.isArray(manifest.gates)||manifest.gates.length!==7||
    !manifest.gates.includes('EXPLICIT_LEVEL_4_FOR_ANY_CONTROL_PLANE_MUTATION'))
    throw new Error('drtarjomeh_registration_manifest_mismatch');
  return true;
}
function validateArtifactBytes(reader=(file)=>fs.readFileSync(path.join(__dirname,file))){
  return EXPECTED_BLOBS.map(({path:file,git_blob_sha})=>{
    try {
      const bytes=reader(file);
      return {path:file,status:gitBlobSha(bytes)===git_blob_sha?'MATCH':'DRIFT'};
    }catch{
      return {path:file,status:'UNAVAILABLE'};
    }
  });
}
// Never follow a symlink under the fixed root. This intentionally fails closed
// for symlink-backed current installations until manually reconciled by review.
function checkConfinement(root,rel,readFs=fs){
  if(!path.isAbsolute(root)||path.posix.normalize(rel)!==rel||
    rel.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(rel))
    return {status:'UNSAFE_PATH'};
  try{
    const st=readFs.lstatSync(root);
    if(!st.isDirectory()||st.isSymbolicLink())return {status:'UNSAFE_ROOT'};
    let current=root;
    const seg=rel.split('/');
    for(let i=0;i<seg.length;i++){
      current=path.join(current,seg[i]);
      const stat=readFs.lstatSync(current);
      if(stat.isSymbolicLink())return {status:'SYMLINK_BLOCKED'};
      if(i!==seg.length-1 && !stat.isDirectory())return {status:'PARENT_NOT_DIRECTORY'};
      if(i===seg.length-1 && !stat.isFile())return {status:'NON_REGULAR'};
    }
    return {status:'REGULAR',file:current};
  }catch(e){
    return {status:e&&e.code==='ENOENT'?'MISSING':'UNAVAILABLE'};
  }
}
function evaluateLivePins(readFs=fs){
  return EXPECTED_PREIMAGES.map(({root,sha256:expected,path:rel})=>{
    const entry=checkConfinement(root,rel,readFs);
    if(entry.status!=='REGULAR')return {root,relative_path:rel,status:entry.status};
    try{
      const actual=sha256(readFs.readFileSync(entry.file));
      return {root,relative_path:rel,status:actual===expected?'MATCH':'DRIFT',
        expected_sha256:expected,observed_sha256:actual};
    }catch{return {root,relative_path:rel,status:'UNAVAILABLE'};}
  });
}
function audit({readFs=fs,reader}={}){
  const manifestOk=validateManifest();
  const artifacts=validateArtifactBytes(reader);
  const preimages=evaluateLivePins(readFs);
  return {schema:'prhm.drtarjomeh.registration-live-preflight.v1',
    audit_only:true,mutation_performed:false,registration_authorized:false,
    source_git_commit:M.approved_adapter_merge_commit,
    manifest_ok:manifestOk,artifacts,live_preimages:preimages,
    pins_match:artifacts.every(x=>x.status==='MATCH')&&preimages.every(x=>x.status==='MATCH'),
    status:artifacts.every(x=>x.status==='MATCH')&&preimages.every(x=>x.status==='MATCH')?
      'PINS_MATCH_INSTALL_REQUIRES_SEPARATE_REVIEW_AND_LEVEL4':'BLOCKED_SHA_OR_FILE_DRIFT'};
}
if(require.main===module){
  if(process.argv.length!==3 || !['--selftest-only','--live-readonly-preflight'].includes(process.argv[2])){
    process.stderr.write('fixed args: --selftest-only or --live-readonly-preflight\n');
    process.exitCode=2;
  } else if(process.argv[2]==='--selftest-only'){
    const artifacts=validateArtifactBytes();
    const ok=validateManifest()&&artifacts.every(x=>x.status==='MATCH');
    process.stdout.write(JSON.stringify({schema:'prhm.drtarjomeh.registration-local-contract.v1',
      audit_only:true,mutation_performed:false,registration_authorized:false,
      artifacts,status:ok?'PASS':'FAIL'})+'\n');
    if(!ok)process.exitCode=1;
  } else {
    const r=audit();
    process.stdout.write(JSON.stringify(r)+'\n');
    if(!r.pins_match)process.exitCode=1;
  }
}
module.exports=Object.freeze({EXPECTED_PREIMAGES,EXPECTED_BLOBS,sha256,gitBlobSha,validateManifest,validateArtifactBytes,checkConfinement,evaluateLivePins,audit});
