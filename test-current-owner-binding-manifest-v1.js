'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const m=require('./current-owner-binding-manifest-v1.js');

test('owner specs are frozen, fixed, absolute, unique and have no wildcard input surface',()=>{
  assert.equal(Object.isFrozen(m.OWNER_SPECS),true);
  const ids=m.OWNER_SPECS.map(x=>x.id);
  assert.equal(new Set(ids).size,ids.length);
  for(const spec of m.OWNER_SPECS){
    assert.equal(Object.isFrozen(spec),true);
    assert.match(spec.id,/^[a-z0-9_]+$/);
    assert.equal(path.isAbsolute(spec.path),true);
    assert.doesNotMatch(spec.path,/[*?\[\]{}$]/);
    assert.equal(Number.isInteger(spec.max_bytes)&&spec.max_bytes>0,true);
  }
  assert.equal(Object.isFrozen(m.INITIAL_CONSUMER_PREIMAGES),true);
  const registryOwner=m.OWNER_SPECS.find(x=>x.id==='registry_base');
  const mcpSourceOwner=m.OWNER_SPECS.find(x=>x.id==='mcp_source');
  assert.equal(registryOwner?.path,'/home/agent/ssh-mcp-server/src/core/.registry-imotion-vm-stable-base-e91c3062539353a7a9d097b0877f1e612051e4fe8a489c101edab3e56d268c9b.mjs');
  assert.equal(mcpSourceOwner?.path,'/home/agent/ssh-mcp-server/server.js');
  assert.deepEqual(m.INITIAL_CONSUMER_PREIMAGES.registry_bridge,{target_path:'/home/agent/ssh-mcp-server/src/core/registry.js',sha256:'19a0bea3d0c7c5ac33121463d26d892dac207022dbb07f76bf6c71acb64b5f35'});
  assert.deepEqual(m.INITIAL_CONSUMER_PREIMAGES.rolling_refresh,{target_path:'/opt/prhm-agent-selfmaint-exec/actions/agent-zdt-existing-topology-rolling-refresh-v1.js',sha256:'d80fca8d7c74c6f6ab7f03c72a866a16c1de3fc547e421eb507e309321048a2a'});
  assert.equal(Object.prototype.hasOwnProperty.call(m.INITIAL_CONSUMER_PREIMAGES,'current_baseline_refresh'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(m.INITIAL_CONSUMER_PREIMAGES,'titan_handoff_sandbox'),false);
  assert.equal(JSON.stringify(m.INITIAL_CONSUMER_PREIMAGES).includes('TODO'),false);
});

test('validateFileOwner accepts regular canonical file and rejects symlink, noncanonical path and oversize file',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'owner-manifest-'));
  try{
    const file=path.join(dir,'owner.js');
    fs.writeFileSync(file,'abc');
    const ok=m.validateFileOwner(Object.freeze({id:'fixture',path:file,max_bytes:16}));
    assert.equal(ok.path,file);
    assert.equal(ok.bytes,3);
    assert.match(ok.sha256,/^[a-f0-9]{64}$/);

    const link=path.join(dir,'owner-link.js');
    fs.symlinkSync(file,link);
    assert.throws(()=>m.validateFileOwner(Object.freeze({id:'link',path:link,max_bytes:16})),/owner_symlink_rejected/);

    const noncanonical=dir+'/nested/../owner.js';
    assert.throws(()=>m.validateFileOwner(Object.freeze({id:'noncanonical',path:noncanonical,max_bytes:16})),/owner_path_noncanonical/);

    assert.throws(()=>m.validateFileOwner(Object.freeze({id:'large',path:file,max_bytes:2})),/owner_too_large/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('canonicalJson is stable across key insertion order',()=>{
  const a={z:1,a:{q:2,b:3},arr:[{y:2,x:1}]};
  const b={arr:[{x:1,y:2}],a:{b:3,q:2},z:1};
  assert.equal(m.canonicalJson(a),m.canonicalJson(b));
});

test('manifest hash is deterministic for fixed facts and output is metadata-only',()=>{
  const owners=[
    {id:'b',path:'/fixed/b',sha256:'b'.repeat(64),bytes:2,mode:0o644,uid:0,gid:0},
    {id:'a',path:'/fixed/a',sha256:'a'.repeat(64),bytes:1,mode:0o600,uid:0,gid:0},
  ];
  const x=m.buildManifest({capturedAt:'2026-09-28T00:00:00.000Z',owners,serviceFacts:{selfmaint_exec:{active:true,main_pid:123}}});
  const y=m.buildManifest({capturedAt:'2026-09-28T00:00:00.000Z',owners:[...owners].reverse(),serviceFacts:{selfmaint_exec:{main_pid:123,active:true}}});
  assert.deepEqual(x,y);
  assert.match(x.manifest_sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(x.owners.map(o=>o.id),['a','b']);
  const text=JSON.stringify(x).toLowerCase();
  for(const forbidden of ['file_content','contents','environment','authorization','approval_token','credential','password','private_key']){
    assert.equal(text.includes(forbidden),false,forbidden);
  }
});
