import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
const candidatePath=new URL('../../candidates/agent-mcp/safeFiles-control-plane-root-staging-v1.js',import.meta.url);
const source=fs.readFileSync(candidatePath,'utf8');
const baselineSha='9f291891673806e34d2681ba7b8227ddd4470f73cec12f69a7c3e9035808caa2';
const specs={
 transport:{name:'control-plane-typed-bootstrap-transport-v1.js',bytes:72854,sha256:'049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335'},
 bootstrap:{name:'bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js',bytes:109634,sha256:'d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e'}
};
function marker(){
 const m=source.match(/\/\* ROOT_STAGE_ARTIFACTS_V1_BEGIN \*\/\n([\s\S]*?)\n\/\* ROOT_STAGE_ARTIFACTS_V1_END \*\//);
 assert.ok(m,'root stage artifact marker must exist');
 return JSON.parse(m[1]);
}
function sha(b){return crypto.createHash('sha256').update(b).digest('hex')}
test('candidate preserves verified live baseline identity marker',()=>{
 assert.match(source,new RegExp(baselineSha));
});
test('embedded artifacts reconstruct exact immutable bytes',()=>{
 const data=marker();
 for(const key of Object.keys(specs)){
  const spec=specs[key]; const row=data[key];
  assert.equal(row.name,spec.name); assert.equal(row.bytes,spec.bytes); assert.equal(row.sha256,spec.sha256);
  const raw=zlib.brotliDecompressSync(Buffer.from(row.brotli_base64,'base64'));
  assert.equal(raw.length,spec.bytes); assert.equal(sha(raw),spec.sha256);
 }
});
test('candidate remains inside selfmaint 120000-byte ceiling',()=>{
 assert.ok(Buffer.byteLength(source,'utf8')<=120000,`candidate bytes=${Buffer.byteLength(source,'utf8')}`);
});
