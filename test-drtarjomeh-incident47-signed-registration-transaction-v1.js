'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const child=require('node:child_process');
const gitBlob=b=>crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex');
const runnerBytes=fs.readFileSync(path.join(__dirname,'drtarjomeh-incident47-reviewed-host-runner-v1.js'));
const runtime=require('./drtarjomeh-incident47-runtime-registration-v1.js');
const appScriptBlob='39e78c45f4c454e56874bc3941f82a5a43cfc8f8';
test('corrected application Git blob is bound in reviewed runner',()=>{
  const s=runnerBytes.toString('utf8');
  assert.ok(s.includes(appScriptBlob));
  assert.ok(!s.includes('39e78c45f4c954e56874bc3941f82a5a43cfc8f8'));
  assert.equal(gitBlob(runnerBytes),runtime.RUNNER_GIT_BLOB);
  assert.doesNotThrow(()=>runtime.verifyRunner(()=>runnerBytes));
  const mockScript=Buffer.from('not the reviewed app');
  const runner=require('./drtarjomeh-incident47-reviewed-host-runner-v1.js');
  assert.throws(()=>runner.inspectPrerequisites({
    cmd:(cmd,args)=>args[args.length-1]==='HEAD'?runner.APP_SHA:'',
    readFile:()=>mockScript
  }),/application_script_blob_changed/);
});
function fixture(){
  const src=fs.readFileSync(path.join(__dirname,'drtarjomeh-incident47-signed-registration-transaction-v1.js'),'utf8');
  const kinds=['base','executor','policy','mcp'];
  const appSha='d'.repeat(40),baseline='b'.repeat(40);
  const before=Object.fromEntries(kinds.map(k=>[k,Buffer.from('original-'+k)]));
  const after=Object.fromEntries(kinds.map(k=>[k,'candidate-'+k]));
  const runner=Buffer.from('test-fixture-runner');
  const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  const paths=Object.fromEntries(kinds.map(k=>[k,'/fixed/'+k]));
  const live=Object.fromEntries(kinds.map(k=>[k,{path:paths[k],sha256:hash(before[k])}]));
  const pins={LIVE:live,SOURCE_COMMIT:appSha,OPERATION:'host_action.i47_test',
    gitBlob};
  const reg={ACTION:'i47_test',OPERATION:pins.OPERATION,
    HOST_BASE:baseline,RUNNER_TARGET:'/fixed/runner',RUNNER_GIT_BLOB:gitBlob(runner),
    buildCandidates:()=>({candidate_sources:after})};
  const moduleObj={exports:{}};
  const mockRequire=(id)=>id==='node:crypto'?crypto:
    id.includes('runtime-registration-v1')?reg:
    id.includes('l4-registration-candidate-v1')?pins:
    (()=>{throw Error('unexpected require')})();
  const ctx={require:mockRequire,module:moduleObj,Buffer,process,console};
  vm.runInNewContext(src,ctx,{timeout:3000});
  const impl=moduleObj.exports;
  const storage=new Map(kinds.map(k=>[paths[k],Buffer.from(before[k])]));
  const original=new Map([...storage]);
  const state=p=>storage.has(p)?({exists:true,isFile:true,isSymlink:false,sha256:hash(storage.get(p)),mode:0o644,uid:0,gid:0}):({exists:false});
  const events=[];const records=[];
  let failAt=null,failRestore=false;
  const adapter={
    hostMainSha:()=>baseline,
    readOwner:p=>Buffer.from(storage.get(p)||''),
    readRunner:()=>runner,
    targetState:state,
    lock:async()=>{events.push('lock');return async()=>events.push('unlock');},
    snapshot:async steps=>{events.push('snapshot');return steps.map(s=>({kind:s.kind,before:storage.get(s.path)||null}));},
    backup:async()=>{events.push('backup');},
    writeExact:async step=>{events.push('write:'+step.kind);if(failAt===step.kind)throw Error('failed_for_fixture');storage.set(step.path,Buffer.from(step.bytes));},
    verify:async step=>{events.push('verify:'+step.kind);if(hash(storage.get(step.path))!==step.after_sha256)throw Error('verification_failed');},
    reloadAndHealth:async kind=>{events.push('reload:'+kind);},
    restore:async(p,kind)=>{events.push('restore:'+kind);if(failRestore)throw Error('restore_unavailable');if(original.has(p))storage.set(p,original.get(p));else storage.delete(p);},
    record:async result=>{records.push(result);events.push('record:'+result.ok);}
  };
  return {impl,adapter,storage,original,events,records,paths,reg,pins,
    setFail:k=>{failAt=k;},setRestoreFailure:v=>{failRestore=v;},before};
}
test('five path allowlist, exact-owner hashes and unused runner target',()=>{
  const x=fixture(),p=x.impl.getPlan(x.adapter);
  assert.equal(p.steps.length,5);
  assert.deepEqual(Array.from(p.steps,x=>x.kind),['base','executor','policy','mcp','runner']);
  assert.ok(p.steps.every(x=>x.path.startsWith('/fixed/')));
  assert.equal(p.installation_authorized,false);
  x.storage.set('/fixed/runner',Buffer.from('preexisting'));
  assert.throws(()=>x.impl.getPlan(x.adapter),/runner_target_not_absent/);
  x.storage.delete('/fixed/runner');
  x.storage.set('/fixed/base',Buffer.from('drift'));
  assert.throws(()=>x.impl.getPlan(x.adapter),/live_base_sha_drift|owner_preimage_drift/);
});
test('successful transaction snapshots first, writes exactly five and verifies health',async()=>{
  const x=fixture(),p=x.impl.getPlan(x.adapter);
  const result=await x.impl.applyPrepared(p,x.adapter);
  assert.equal(result.ok,true);
  assert.equal(result.rollback_performed,false);
  assert.equal(x.events.indexOf('backup')<x.events.indexOf('write:base'),true);
  assert.deepEqual(x.events.filter(e=>e.startsWith('write:')),['write:base','write:executor','write:policy','write:mcp','write:runner']);
  assert.ok(x.events.includes('reload:candidate'));
  assert.equal(x.events.at(-1),'unlock');
  assert.equal(x.records.length,1);
});
test('third-step failure rolls back all partially touched files and preserves backup',async()=>{
  const x=fixture(),p=x.impl.getPlan(x.adapter);x.setFail('policy');
  await assert.rejects(x.impl.applyPrepared(p,x.adapter),/registration_failed_rollback_complete/);
  assert.equal(x.storage.has('/fixed/runner'),false);
  assert.equal(x.storage.get('/fixed/base').toString(),'original-base');
  assert.equal(x.storage.get('/fixed/executor').toString(),'original-executor');
  assert.ok(x.events.includes('backup'));
  assert.deepEqual(x.events.filter(e=>e.startsWith('restore:')),['restore:policy','restore:executor','restore:base']);
  assert.ok(x.events.includes('reload:baseline'));
  assert.equal(x.records[0].rollback_performed,true);
});
test('rollback failure is unmistakably critical, and lock is always released',async()=>{
  const x=fixture(),p=x.impl.getPlan(x.adapter);x.setFail('policy');x.setRestoreFailure(true);
  await assert.rejects(x.impl.applyPrepared(p,x.adapter),/registration_rollback_incomplete/);
  assert.equal(x.records[0].rollback_incomplete,true);
  assert.equal(x.events.at(-1),'unlock');
});
test('drift after preparing plan prevents any backup or write',async()=>{
  const x=fixture(),p=x.impl.getPlan(x.adapter);
  x.storage.set('/fixed/base',Buffer.from('changed after plan'));
  await assert.rejects(x.impl.applyPrepared(p,x.adapter),/live_base_sha_drift|owner_preimage_drift/);
  assert.ok(!x.events.includes('backup'));
  assert.equal(x.events.at(-1),'unlock');
});
test('untrusted plan cannot route a different target, command, blob or action',async()=>{
  const x=fixture(),p=x.impl.getPlan(x.adapter);
  const forged={...p,steps:p.steps.map(s=>({...s}))};
  forged.steps[0].path='/etc/shadow';
  await assert.rejects(x.impl.applyPrepared(forged,x.adapter),/plan_step_invalid/);
  assert.equal(x.events.length,0);
  await assert.rejects(x.impl.applyPrepared({...p,action:'unregistered'},x.adapter),/plan_identity_invalid/);
});
test('no executable installer or arbitrary shell CLI is offered',()=>{
  const p=path.join(__dirname,'drtarjomeh-incident47-signed-registration-transaction-v1.js');
  const run=child.spawnSync(process.execPath,[p,'--install'],{encoding:'utf8'});
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/No installer CLI/);
});
