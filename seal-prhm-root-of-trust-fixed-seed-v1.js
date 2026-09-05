#!/usr/local/bin/prhm-node
'use strict';

const fs=require('node:fs');
const crypto=require('node:crypto');
const mod=require('./bootstrap-prhm-root-of-trust-fixed-seed-v1.js');

const ARTIFACT='bootstrap-prhm-root-of-trust-fixed-seed-v1.js';
const MANIFEST='prhm-root-of-trust-fixed-seed-v1.manifest.json';

function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function buildManifest(){
  if(process.argv.length!==2) throw new Error('unexpected_arguments');
  if(mod.verifyFixedContract()!==true) throw new Error('fixed_contract_invalid');
  const bytes=fs.readFileSync(ARTIFACT);
  const artifactSha=sha(bytes);
  if(!/^[a-f0-9]{64}$/.test(artifactSha)) throw new Error('artifact_sha_invalid');
  return {
    schema_version:'prhm.root-of-trust-seed-manifest.v1',
    seed_id:mod.VERSION,
    action_registered:mod.ACTION,
    operation:mod.OPERATION,
    artifact:ARTIFACT,
    artifact_sha256:artifactSha,
    runtime_inputs:[],
    baseline_sha256:{...mod.BASELINE_SHA},
    transport_helper_sha256:mod.TRANSPORT_HELPER_SHA,
    production_mutation_scope:['/opt/prhm-agent-selfmaint/server.js','/opt/prhm-agent-selfmaint-exec/server.js','/opt/prhm-company-control-plane/config/approval-policy.json'],
    transport_executed_by_seed:false,
    database_mutation:false
  };
}
function main(){
  const manifest=buildManifest();
  fs.writeFileSync(MANIFEST,JSON.stringify(manifest,null,2)+'\n',{encoding:'utf8',mode:0o644});
  process.stdout.write(JSON.stringify({ok:true,manifest:MANIFEST,artifact_sha256:manifest.artifact_sha256})+'\n');
}
module.exports={ARTIFACT,MANIFEST,buildManifest};
if(require.main===module){try{main();}catch(e){console.error(JSON.stringify({ok:false,error:String(e?.message||e)}));process.exit(1);}}
