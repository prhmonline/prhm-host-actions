'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const m=require('./drtarjomeh-preflight-agent3-live-pins-check-v1.js');
const pins=require('./drtarjomeh-preflight-agent3-registration-pins-v1.json');

const DIR={isDirectory:()=>true,isSymbolicLink:()=>false,isFile:()=>false};
const FILE={isDirectory:()=>false,isSymbolicLink:()=>false,isFile:()=>true};
const LINK={isDirectory:()=>false,isSymbolicLink:()=>true,isFile:()=>false};
function mockFs({symlink=false,missing=false,secret='FAKE_CREDENTIAL_MUST_NOT_LEAK'}={}){
  return {
    lstatSync(file){
      if(missing && file.endsWith('server.js')){const e=new Error('absent');e.code='ENOENT';throw e;}
      if(symlink && file.endsWith('server.js'))return LINK;
      if(file.endsWith('.js'))return FILE;
      return DIR;
    },
    readFileSync(){return Buffer.from(secret);}
  };
}
test('fixed manifest binds exact merged SHA and 4 current control-plane file hashes',()=>{
  assert.equal(m.validateManifest(),true);
  assert.equal(pins.mode,'preflight_only');
  assert.equal(pins.registration_authorized,false);
  assert.equal(pins.production_mutation_authorized,false);
  assert.equal(m.EXPECTED_PREIMAGES.length,4);
  assert.deepEqual([...new Set(m.EXPECTED_PREIMAGES.map(x=>x.root))].sort(),
    ['/home/agent/ssh-agent-api','/home/agent/ssh-mcp-server']);
  for(const entry of m.EXPECTED_PREIMAGES){
    assert.match(entry.sha256,/^[a-f0-9]{64}$/);
    assert.ok(!entry.path.startsWith('/'));
  }
});
test('strict manifest rejects preimage, scope, or authorization drift',()=>{
  for(const change of [
    {mode:'install'},
    {registration_authorized:true},
    {production_mutation_authorized:true},
    {live_control_plane_preimages:pins.live_control_plane_preimages.slice(1)},
    {approved_adapter_merge_commit:'0'.repeat(40)}
  ])assert.throws(()=>m.validateManifest({...pins,...change}),/manifest_mismatch/);
});
test('preflight source artifacts exactly match reviewed Git blobs',()=>{
  const res=m.validateArtifactBytes();
  assert.equal(res.length,3);
  assert.ok(res.every(x=>x.status==='MATCH'));
  assert.deepEqual(res.map(x=>x.path).sort(),pins.approved_artifacts.map(x=>x.path).sort());
});
test('tampered artifact fails SHA check without content disclosure',()=>{
  const result=m.validateArtifactBytes(()=>Buffer.from('FAKE_CREDENTIAL_MUST_NOT_LEAK'));
  assert.ok(result.every(x=>x.status==='DRIFT'));
  assert.ok(!JSON.stringify(result).includes('FAKE_CREDENTIAL'));
});
test('live preimage mismatch blocks; never returns file contents',()=>{
  const result=m.audit({readFs:mockFs()});
  assert.equal(result.audit_only,true);
  assert.equal(result.mutation_performed,false);
  assert.equal(result.registration_authorized,false);
  assert.equal(result.pins_match,false);
  assert.equal(result.status,'BLOCKED_SHA_OR_FILE_DRIFT');
  assert.equal(result.live_preimages.length,4);
  assert.ok(result.live_preimages.every(x=>x.status==='DRIFT'));
  assert.ok(!JSON.stringify(result).includes('FAKE_CREDENTIAL'));
});
test('missing or linked live entry fails closed before content read',()=>{
  const linked=m.evaluateLivePins(mockFs({symlink:true}));
  assert.equal(linked[0].status,'SYMLINK_BLOCKED');
  const missing=m.evaluateLivePins(mockFs({missing:true}));
  assert.equal(missing[0].status,'MISSING');
});
test('path traversal rejected; caller cannot inject paths',()=>{
  assert.equal(m.checkConfinement('/home/agent/ssh-agent-api','../secrets',mockFs()).status,'UNSAFE_PATH');
  assert.equal(m.checkConfinement('/home/agent/ssh-agent-api','/etc/passwd',mockFs()).status,'UNSAFE_PATH');
  assert.equal(m.checkConfinement('relative','server.js',mockFs()).status,'UNSAFE_PATH');
});
test('CLI selftest has no live access and no arbitrary path parameter',()=>{
  const script=path.join(__dirname,'drtarjomeh-preflight-agent3-live-pins-check-v1.js');
  const ok=spawnSync(process.execPath,[script,'--selftest-only'],{encoding:'utf8'});
  assert.equal(ok.status,0,ok.stderr);
  assert.equal(JSON.parse(ok.stdout).status,'PASS');
  assert.equal(JSON.parse(ok.stdout).registration_authorized,false);
  const bad=spawnSync(process.execPath,[script,'--live-readonly-preflight','--path=/etc/passwd'],{encoding:'utf8'});
  assert.equal(bad.status,2);
  assert.equal(bad.stdout,'');
});
