'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const repair=require('./mcp-selfmaint-level3-wrapper-repair-v1.js');
const FIXTURE=fs.readFileSync(path.join(__dirname,'fixtures/mcp-server-wrapper-831c872f.mjs'),'utf8');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

test('fixture is exact production wrapper preimage',()=>{
  assert.equal(sha(Buffer.from(FIXTURE)),repair.EXPECTED_SHA256);
});

test('transform permits Level-3 and Level-4 while preserving existing delegation hooks',()=>{
  const out=repair.transformWrapper(FIXTURE);
  assert.match(out.source,/import \{ z \} from 'zod';/);
  assert.match(out.source,/z\.union\(\[z\.literal\(SELFMAINT_LEVEL3\),z\.literal\(SELFMAINT_LEVEL4\)\]\)/);
  assert.match(out.source,/previousRegisterTool\.call\(this,name,selfmaintApplyConfig\(name,config\),next,/);
  assert.match(out.source,/previousTool\.call\(this,name,selfmaintApplyDescription\(name,description\),selfmaintApplySchema\(name,schema\),next,/);
  assert.ok(out.source.includes('const next=wrapRootStageRequest(name,baseNext);'));
  assert.ok(out.source.includes("if(name==='ops_execute')titanOpsHandler=handler;"));
  assert.ok(out.source.includes("const TITAN_DEPLOY_TOOL='titan_front_handoff_deploy_v2';"));
});

test('transform fails closed on any wrapper preimage drift',()=>{
  assert.throws(()=>repair.transformWrapper(FIXTURE+'\n// drift'),/preimage_sha_mismatch/);
});

test('apply creates backup and restores exact preimage on post-write failure',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-level3-repair-'));
  const target=path.join(root,'server.js'),backups=path.join(root,'backups');
  fs.writeFileSync(target,FIXTURE,{mode:0o600});
  try{
    assert.throws(()=>repair.applyToPath({target,backupRoot:backups,injectFailure:true}),/injected_after_wrapper_write/);
    assert.equal(fs.readFileSync(target,'utf8'),FIXTURE);
    const names=fs.readdirSync(backups); assert.equal(names.length,1);
    assert.equal(fs.readFileSync(path.join(backups,names[0]),'utf8'),FIXTURE);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('successful fixture apply produces a changed, syntactically valid wrapper',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-level3-repair-'));
  const target=path.join(root,'server.js'),backups=path.join(root,'backups');
  fs.writeFileSync(target,FIXTURE,{mode:0o600});
  try{
    const result=repair.applyToPath({target,backupRoot:backups});
    assert.equal(result.ok,true); assert.equal(result.old_sha256,repair.EXPECTED_SHA256);
    assert.notEqual(result.new_sha256,result.old_sha256);
    const source=fs.readFileSync(target,'utf8');
    assert.ok(source.includes(repair.LEVEL3)); assert.ok(source.includes(repair.LEVEL4));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
