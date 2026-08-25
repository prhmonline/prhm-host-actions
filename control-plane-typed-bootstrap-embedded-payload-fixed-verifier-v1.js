#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const zlib=require('node:zlib');

const MEDIATOR_PATH='/opt/prhm-company-control-plane/root-scripts-stage-mediator-v1/control-plane-root-scripts-stage-mediator-v1.js';
const RESULT_SCHEMA='prhm.control-plane-typed-bootstrap-embedded-payload-integrity.v1';
const EXPECTED=Object.freeze({
  transport:Object.freeze({name:'control-plane-typed-bootstrap-transport-v1.js',bytes:72854,sha256:'049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335e'}),
  bootstrap:Object.freeze({name:'bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js',bytes:109634,sha256:'d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e'})
});
function sha256(b){return crypto.createHash('sha256').update(b).digest('hex');}
function extractStageArtifacts(source){
  const anchor='const STAGE_ARTIFACTS=Object.freeze(';
  const count=source.split(anchor).length-1;
  if(count===0)throw new Error('stage_artifacts_declaration_missing');
  if(count!==1)throw new Error('stage_artifacts_declaration_ambiguous');
  const start=source.indexOf(anchor)+anchor.length;
  const end=source.indexOf(');',start);
  if(end<0)throw new Error('stage_artifacts_declaration_malformed');
  let parsed;
  try{parsed=JSON.parse(source.slice(start,end));}catch{throw new Error('stage_artifacts_json_invalid');}
  return parsed;
}
function verifyOne(spec,expected,key){
  if(!spec||typeof spec!=='object')throw new Error('artifact_spec_missing:'+key);
  if(spec.name!==expected.name||spec.bytes!==expected.bytes||spec.sha256!==expected.sha256)throw new Error('artifact_metadata_mismatch:'+key);
  if(typeof spec.brotli_base64!=='string'||!spec.brotli_base64.length)throw new Error('artifact_payload_missing:'+key);
  let compressed;
  try{compressed=Buffer.from(spec.brotli_base64,'base64');}catch{throw new Error('artifact_base64_invalid:'+key);}
  let raw;
  try{raw=zlib.brotliDecompressSync(compressed);}catch{throw new Error('artifact_brotli_invalid:'+key);}
  const actualSha=sha256(raw);
  if(raw.length!==expected.bytes||actualSha!==expected.sha256)throw new Error('artifact_integrity_mismatch:'+key);
  return {name:expected.name,bytes:raw.length,sha256:actualSha,verified:true};
}
function verifyMediatorSource(source,expected=EXPECTED){
  if(typeof source!=='string')throw new Error('mediator_source_invalid');
  const specs=extractStageArtifacts(source);
  return {ok:true,schema_version:RESULT_SCHEMA,read_only:true,fixed_scope:true,production_mutation:false,transport:verifyOne(specs.transport,expected.transport,'transport'),bootstrap:verifyOne(specs.bootstrap,expected.bootstrap,'bootstrap')};
}
function runFixedVerifier(){
  const source=fs.readFileSync(MEDIATOR_PATH,'utf8');
  return verifyMediatorSource(source,EXPECTED);
}
if(require.main===module){process.stdout.write(JSON.stringify(runFixedVerifier())+'\n');}
module.exports={MEDIATOR_PATH,RESULT_SCHEMA,EXPECTED,verifyMediatorSource,runFixedVerifier};
