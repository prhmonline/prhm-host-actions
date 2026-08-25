'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const v = require('./control-plane-typed-bootstrap-embedded-payload-fixed-verifier-v1.js');

function sha(b){return crypto.createHash('sha256').update(b).digest('hex');}
function makeMediator(transportRaw, bootstrapRaw){
  const specs={
    transport:{name:'control-plane-typed-bootstrap-transport-v1.js',bytes:transportRaw.length,sha256:sha(transportRaw),brotli_base64:zlib.brotliCompressSync(transportRaw).toString('base64')},
    bootstrap:{name:'bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js',bytes:bootstrapRaw.length,sha256:sha(bootstrapRaw),brotli_base64:zlib.brotliCompressSync(bootstrapRaw).toString('base64')}
  };
  return `const STAGE_ARTIFACTS=Object.freeze(${JSON.stringify(specs)});`;
}

test('fixed contract exposes no arbitrary input',()=>{
  assert.equal(v.MEDIATOR_PATH,'/opt/prhm-company-control-plane/root-scripts-stage-mediator-v1/control-plane-root-scripts-stage-mediator-v1.js');
  assert.equal(v.EXPECTED.transport.name,'control-plane-typed-bootstrap-transport-v1.js');
  assert.equal(v.EXPECTED.transport.bytes,72854);
  assert.equal(v.EXPECTED.transport.sha256,'049250921dda0aa98ade7cf3707634668590bd66163606de5906841f5ca34335e');
  assert.equal(v.EXPECTED.bootstrap.name,'bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js');
  assert.equal(v.EXPECTED.bootstrap.bytes,109634);
  assert.equal(v.EXPECTED.bootstrap.sha256,'d3be569a4fd63b8e0c78e370ad689a27aa2751ea772891cb6b7ffe7fbd49b35e');
  assert.equal(v.RESULT_SCHEMA,'prhm.control-plane-typed-bootstrap-embedded-payload-integrity.v1');
});

test('verifier independently decompresses and hashes both payloads',()=>{
  const t=Buffer.from('transport fixture');
  const b=Buffer.from('bootstrap fixture');
  const out=v.verifyMediatorSource(makeMediator(t,b),{
    transport:{name:'control-plane-typed-bootstrap-transport-v1.js',bytes:t.length,sha256:sha(t)},
    bootstrap:{name:'bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js',bytes:b.length,sha256:sha(b)}
  });
  assert.equal(out.ok,true);
  assert.equal(out.transport.verified,true);
  assert.equal(out.bootstrap.verified,true);
});

test('verifier fails closed on SHA mismatch',()=>{
  const t=Buffer.from('transport fixture'); const b=Buffer.from('bootstrap fixture');
  assert.throws(()=>v.verifyMediatorSource(makeMediator(t,b),{
    transport:{name:'control-plane-typed-bootstrap-transport-v1.js',bytes:t.length,sha256:'0'.repeat(64)},
    bootstrap:{name:'bootstrap-host-actions-control-plane-typed-bootstrap-transport-v1.js',bytes:b.length,sha256:sha(b)}
  }),/artifact_integrity_mismatch/);
});

test('verifier rejects malformed or ambiguous mediator declarations',()=>{
  assert.throws(()=>v.verifyMediatorSource('const x=1;',v.EXPECTED),/stage_artifacts_declaration_missing/);
  const t=Buffer.from('a'), b=Buffer.from('b'); const one=makeMediator(t,b);
  assert.throws(()=>v.verifyMediatorSource(one+'\n'+one,v.EXPECTED),/stage_artifacts_declaration_ambiguous/);
});
