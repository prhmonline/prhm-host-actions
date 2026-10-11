'use strict';
// PRHM central offsite post-run evidence fix v1.
// Read-only SHA-bound patch planner: NEVER modifies the production service file.
// Production changes require separate explicit approval, pinned commit deployment,
// service restart, health checks and rollback evidence.
const fs=require('node:fs');
const crypto=require('node:crypto');
const vm=require('node:vm');

const TARGET='/opt/prhm-agent-selfmaint-exec/centralOffsiteRoutes.js';
const PREIMAGE_SHA256='165993d00a8ee6caadd9bf6d232d3c595d9fd3e0486c6912ab9ae9e6245e3921';
const OLD="!SHA.test(String(x.sha256||''))";
const NEW="!SHA.test(String(x.bundle_sha256||''))";
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

function plan(source,{preimageSha256=PREIMAGE_SHA256}={}){
  if(typeof source!=='string'||hash(source)!==preimageSha256)throw Error('PREIMAGE_SHA256_MISMATCH');
  if(!source.includes('function post(b)'))throw Error('POSTRUN_VALIDATOR_NOT_FOUND');
  if(source.split(OLD).length!==2)throw Error('POSTRUN_SHA_FIELD_MATCH_COUNT_NOT_ONE');
  const patched=source.replace(OLD,NEW);
  if(patched.split(NEW).length!==2)throw Error('POSTRUN_PATCH_NOT_EXACTLY_ONCE');
  new vm.Script(patched,{filename:'centralOffsiteRoutes.js'});
  return Object.freeze({target:TARGET,old_sha256:hash(source),new_sha256:hash(patched),change_count:1,patch_content:patched});
}

function validPostrun(state,binding){
  const SHA=/^[a-f0-9]{64}$/;
  if(!state||!binding)return false;
  return state.status==='pass'
    &&state.snapshot===binding.snapshot
    &&state.runner_sha256===binding.runner_sha256
    &&state.local_encrypted_repository_check_5pct==='pass'
    &&state.remote_object_exact_size==='pass'
    &&SHA.test(String(state.bundle_sha256||''));
}

if(require.main===module){
  if(process.argv.length!==3||process.argv[2]!=='--preflight'){
    console.error('READ_ONLY_ONLY: usage node central-offsite-postrun-sha-fix-v1.js --preflight');
    process.exitCode=2;
  }else{
    const st=fs.lstatSync(TARGET);
    if(!st.isFile()||st.isSymbolicLink())throw Error('INVALID_PRODUCTION_TARGET');
    const p=plan(fs.readFileSync(TARGET,'utf8'));
    console.log(JSON.stringify({status:'PREFLIGHT_PASS',target:p.target,old_sha256:p.old_sha256,new_sha256:p.new_sha256,change_count:p.change_count,production_mutation:false},null,2));
  }
}
module.exports={TARGET,PREIMAGE_SHA256,OLD,NEW,hash,plan,validPostrun};
