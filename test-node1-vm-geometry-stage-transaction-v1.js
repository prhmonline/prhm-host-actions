'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const m=require('./node1-vm-geometry-stage-transaction-v1');
const pre=require('./node1-vm-geometry-deploy-preflight-v1');
const makeSources=()=>Object.fromEntries(m.FILES.map(f=>[f.path,fs.readFileSync(path.join(__dirname,f.path))]));
const owners=()=>Object.fromEntries(pre.OWNERS.map(x=>[x.key,{
 path:x.path,sha256:x.sha256,isFile:true,isSymlink:false,size:2048,writableByOther:false,writableByGroup:false
}]));
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'node1-release-sandbox-'));
 try{return fn(root)}finally{fs.rmSync(root,{recursive:true,force:true})}
}
test('verified 7-file SHA-bound release plan is explicitly NONproduction',()=>{
 const plan=m.releasePlan();
 assert.equal(plan.files.length,7);
 assert.equal(plan.stage_only,true);
 assert.equal(plan.production_activation,false);
 assert.equal(plan.agent3_registration,false);
 assert.equal(plan.requires_explicit_level4_for_deployment,true);
 assert.equal(plan.rollback_on_stage_failure,true);
 assert.equal(plan.no_git_history_reset,true);
});
test('real filesystem sandbox stages complete seven-file tree atomically with audit',()=>fixture(root=>{
 const storage=m.makeSandboxStore(root);
 const result=m.stageCandidate({sources:makeSources(),observedOwners:owners(),store:storage});
 assert.equal(result.staged,true);
 assert.equal(result.owner_baseline_verified,true);
 assert.equal(result.production_mutation,false);
 assert.equal(result.active_services_changed,false);
 assert.equal(result.agent3_registered,false);
 assert.equal(result.ready_for_production,false);
 assert.deepEqual(storage.inspect().files,m.FILES.map(x=>x.path).sort());
 assert.equal(storage.inspect().sealed,true);
 assert.equal(storage.inspect().tempExists,false);
 for(const f of m.FILES){
  const b=fs.readFileSync(path.join(root,'candidate-sealed',f.path));
  assert.equal(require('./node1-vm-geometry-attested-bundle-v1').gitBlobSha(b),f.sha);
  assert.equal(fs.statSync(path.join(root,'candidate-sealed',f.path)).mode&0o777,0o600);
 }
 const logs=fs.readFileSync(path.join(root,'release-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(logs.map(x=>x.event),['stage_preseal_verified','stage_sealed']);
}));
test('tampered source is rejected BEFORE any filesystem staging',()=>fixture(root=>{
 const store=m.makeSandboxStore(root),sources=makeSources();sources[m.FILES[1].path]=Buffer.from('tampered');
 assert.throws(()=>m.stageCandidate({sources,observedOwners:owners(),store}),/source_blob_verification_failed/);
 assert.equal(store.inspect().phase,'initial');
 assert.equal(fs.readdirSync(root).length,0);
}));
test('owner SHA drift cannot stage any file',()=>fixture(root=>{
 const o=owners();o.agent_mcp.sha256='f'.repeat(64);
 const store=m.makeSandboxStore(root);
 assert.throws(()=>m.stageCandidate({sources:makeSources(),observedOwners:o,store}),/installed_agent_owner_mismatch/);
 assert.equal(store.inspect().phase,'initial');
}));
test('mid-write failure automatically removes incomplete candidate',()=>fixture(root=>{
 const base=m.makeSandboxStore(root);let count=0;
 const store={...base,writeExclusive(...args){if(++count===4)throw Error('synthetic_io_failure');return base.writeExclusive(...args)}};
 assert.throws(()=>m.stageCandidate({sources:makeSources(),observedOwners:owners(),store}),/synthetic_io_failure/);
 assert.equal(base.inspect().phase,'rolled_back');
 assert.equal(base.inspect().sealed,false);
 assert.equal(base.inspect().tempExists,false);
}));
test('post-rename journal failure rolls sealed candidate back',()=>fixture(root=>{
 const base=m.makeSandboxStore(root),store={...base,record(row){if(row.event==='stage_sealed')throw Error('synthetic_log_disk_full');return base.record(row)}};
 assert.throws(()=>m.stageCandidate({sources:makeSources(),observedOwners:owners(),store}),/synthetic_log_disk_full/);
 assert.equal(base.inspect().phase,'rolled_back');
 assert.equal(base.inspect().sealed,false);
}));
test('failed rollback is surfaced instead of suggesting recovery succeeded',()=>{
 let stage=false,roll=false;
 const store={
  begin(){stage=true},
  writeExclusive(){throw Error('disk_failure')},
  readBack(){throw Error('not reached')},record(){},seal(){},rollback(){roll=true;throw Error('disk_cleanup_failure')}
 };
 assert.throws(()=>m.stageCandidate({sources:makeSources(),observedOwners:owners(),store}),/stage_rollback_failed/);
 assert.equal(stage,true);assert.equal(roll,true);
});
test('arbitrary host filesystem locations are never valid sandbox targets',()=>{
 for(const d of ['/opt/prhm-node1-readonly','/var/lib/prhm-backup/node1','/','/tmp']){
  assert.throws(()=>m.makeSandboxStore(d));
 }
});
test('candidate files can only use exact source file allowlist',()=>fixture(root=>{
 const store=m.makeSandboxStore(root);
 store.begin();
 assert.throws(()=>store.writeExclusive('/etc/shadow',Buffer.from('x'),0o600),/sandbox_file_not_allowlisted/);
 assert.throws(()=>store.writeExclusive('../escape',Buffer.from('x'),0o600),/sandbox_file_not_allowlisted/);
 assert.throws(()=>store.writeExclusive(m.FILES[0].path,Buffer.from('x'),0o644),/sandbox_write_invalid/);
 store.rollback();
}));
test('no executable production activation API or background work in release module',()=>{
 const source=fs.readFileSync(path.join(__dirname,'node1-vm-geometry-stage-transaction-v1.js'),'utf8');
 assert.doesNotMatch(source,/\bsystemctl\b|ssh\s+-|\.restart\(|execSync\s*\(|shell:\s*true|host_action_v2_apply/);
 assert.equal(m.releasePlan().production_activation,false);
});
