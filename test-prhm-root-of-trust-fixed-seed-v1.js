const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const mod = require('./bootstrap-prhm-root-of-trust-fixed-seed-v1.js');

const ACTION = 'control_plane_root_scripts_stage_transport_v1';
const fixtureBase = "const HOST_ACTION_V2={\n  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'host-action-v2:imotion-credential-bind-v1:remote-controller-backup-restore' }\n});\n";
const fixtureExecutor = "const HOST_ACTION_V2_SPECS={\n  imotion_credential_bind_v1:{operation:'host_action.imotion_credential_bind_v1',kind:'imotion_credential_bind_v1'}\n});\nconst applyHostActionV2Original=applyHostActionV2;\napplyHostActionV2=async function(action){if(action==='imotion_credential_bind_v1')return applyImotionCredentialBindV1();return applyHostActionV2Original(action);};\n";
const fixturePolicy = JSON.stringify({
  version:'fixture',
  operations:{
    'host_action.control_plane_root_scripts_stage_transport_v1':{level:4},
    'host_action.imotion_credential_bind_v1':{level:4}
  },
  typed_scopes:[
    {tool:'control_plane_root_scripts_stage_transport_apply_v1',project:'control_plane',environment:'production',action:'control_plane_root_scripts_stage_transport_v1',risk:'critical',operation:'host_action.control_plane_root_scripts_stage_transport_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]},
    {tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'imotion_credential_bind_v1',risk:'critical',operation:'host_action.imotion_credential_bind_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}
  ]
});

test('registers only the fixed root-scripts transport action in base, executor, and policy', () => {
  const out = mod.buildPatchedFrom({base: fixtureBase, executor: fixtureExecutor, policy: fixturePolicy});
  assert.match(out.base, new RegExp(ACTION));
  assert.match(out.executor, new RegExp(ACTION));
  const p = JSON.parse(out.policy);
  assert.equal(p.operations['host_action.' + ACTION].level, 4);
  assert.equal(p.typed_scopes.filter(x => x.action === ACTION && x.tool === 'control_plane_root_scripts_stage_transport_apply_v1').length, 1);
  assert.equal(p.typed_scopes.filter(x => x.action === ACTION && x.tool === 'host_action_v2_apply').length, 1);
});

test('rejects missing or duplicate structural anchors', () => {
  assert.throws(() => mod.buildPatchedFrom({base:'const HOST_ACTION_V2={};\n', executor:fixtureExecutor, policy:fixturePolicy}), /base_imotion_anchor_missing/);
  assert.throws(() => mod.buildPatchedFrom({
    base:"const HOST_ACTION_V2={\n  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'x' },\n  imotion_credential_bind_v1: { operation: 'host_action.imotion_credential_bind_v1', rollback: 'x' }\n});\n",
    executor:fixtureExecutor,
    policy:fixturePolicy
  }), /base_imotion_anchor_duplicate/);
});

test('completes compatible policy-only partial registration without deleting action-specific scope', () => {
  const out = mod.buildPatchedFrom({base:fixtureBase, executor:fixtureExecutor, policy:fixturePolicy});
  const p = JSON.parse(out.policy);
  assert.equal(p.operations['host_action.' + ACTION].level, 4);
  assert.equal(p.typed_scopes.filter(x => x.action === ACTION && x.tool === 'control_plane_root_scripts_stage_transport_apply_v1').length, 1);
  assert.equal(p.typed_scopes.filter(x => x.action === ACTION && x.tool === 'host_action_v2_apply').length, 1);
});

test('rejects conflicting existing target policy operation', () => {
  const p = JSON.parse(fixturePolicy);
  p.operations['host_action.' + ACTION] = {level:3};
  assert.throws(() => mod.buildPatchedFrom({base:fixtureBase, executor:fixtureExecutor, policy:JSON.stringify(p)}), /conflicting_existing_registration/);
});

test('rejects any unexpected runtime argument surface', () => {
  assert.deepEqual(mod.RUNTIME_INPUTS, []);
});

test('pins the production baseline hashes and transport helper SHA', () => {
  assert.deepEqual(mod.BASELINE_SHA, {
    base: 'e186036e8efd9c9663b977a20f62fb90cedb70b48bfa0f1fb48cbc53a64020cd',
    executor: '1e683d0962bc1e0503b9deb1f0d266ad44d6fc5d3c1566dc87f2f7733d4802bd',
    policy: '76cca4574708709c921d67e91068e9f25508c6769f4d150718c8b068f870233d'
  });
  assert.equal(mod.TRANSPORT_HELPER_SHA, 'c64d2fb4c2ae2b048f7f57f6a5e4923588b76ae8a134a540e791b03285ff4d87');
});

test('seed contract excludes generic root inputs and production app/database capabilities', () => {
  const src = fs.readFileSync(require.resolve('./bootstrap-prhm-root-of-trust-fixed-seed-v1.js'),'utf8');
  for (const forbidden of ['process.argv.slice(2)','authorized_keys','ssh-rsa','BEGIN OPENSSH PRIVATE KEY','createServer(','mysql2','node:pg','/home/drtarjomeh/domains/']) {
    assert.equal(src.includes(forbidden), false, forbidden);
  }
});

function makeAdapter(options={}){
  const files={base:fixtureBase,executor:fixtureExecutor,policy:fixturePolicy,transport:'fixed-helper'};
  const originals={...files};
  const stats={base:{isFile:true,isSymlink:false,mode:0o640,uid:0,gid:0},executor:{isFile:true,isSymlink:false,mode:0o640,uid:0,gid:0},policy:{isFile:true,isSymlink:false,mode:0o640,uid:0,gid:0},transport:{isFile:true,isSymlink:false,mode:0o644,uid:0,gid:0}};
  const writes=[]; const restores=[]; const restarts=[]; let healthCalls=0;
  if(options.symlink) stats[options.symlink].isSymlink=true;
  const hashMap={...mod.BASELINE_SHA,transport:mod.TRANSPORT_HELPER_SHA,...(options.hashMap||{})};
  return {
    files,originals,stats,writes,restores,restarts,
    getuid(){return 0;},
    stat(layer){return stats[layer];},
    read(layer){return Buffer.from(files[layer]);},
    hash(layer){return hashMap[layer];},
    syntaxCheck(layer){if(options.syntaxFailure===layer) throw new Error('candidate_syntax_invalid:'+layer);},
    beginBackup(){return {id:'fixture-backup'};},
    atomicWrite(layer,bytes){files[layer]=Buffer.from(bytes).toString('utf8');writes.push(layer);if(options.failAfterWrite===layer) throw new Error('failure_after_'+layer+'_write');},
    restore(layer,bytes){files[layer]=Buffer.from(bytes).toString('utf8');restores.push(layer);if(options.restoreFailure===layer) throw new Error('restore_failed:'+layer);},
    restart(service){restarts.push(service);if(options.restartFailure && restarts.length===1) throw new Error('failure_during_service_restart');},
    health(service){healthCalls++;if(options.healthFailure && healthCalls===1) throw new Error('failure_during_post_health');return true;},
    verifyInstalled(layer,expected){return require('node:crypto').createHash('sha256').update(Buffer.from(files[layer])).digest('hex')===expected;},
    verifyRestored(layer){return files[layer]===originals[layer];}
  };
}

test('preflight rejects baseline drift before writes', async () => {
  const a=makeAdapter({hashMap:{base:'0'.repeat(64)}});
  await assert.rejects(() => mod.executeWithAdapter(a), /baseline_sha_mismatch:base/);
  assert.deepEqual(a.writes,[]);
});

test('preflight rejects symlink targets before writes', async () => {
  const a=makeAdapter({symlink:'executor'});
  await assert.rejects(() => mod.executeWithAdapter(a), /target_symlink_rejected:executor/);
  assert.deepEqual(a.writes,[]);
});

test('preflight rejects transport helper SHA mismatch before writes', async () => {
  const a=makeAdapter({hashMap:{transport:'1'.repeat(64)}});
  await assert.rejects(() => mod.executeWithAdapter(a), /transport_helper_sha_mismatch/);
  assert.deepEqual(a.writes,[]);
});

test('preflight rejects candidate syntax failure before writes', async () => {
  const a=makeAdapter({syntaxFailure:'executor'});
  await assert.rejects(() => mod.executeWithAdapter(a), /candidate_syntax_invalid:executor/);
  assert.deepEqual(a.writes,[]);
});

for(const layer of ['base','executor','policy']){
  test('verified rollback after injected '+layer+' write failure', async () => {
    const a=makeAdapter({failAfterWrite:layer});
    const out=await mod.executeWithAdapter(a);
    assert.equal(out.result,'FAILED_ROLLED_BACK');
    assert.equal(out.rollback_performed,true);
    assert.deepEqual(a.files,a.originals);
  });
}

test('verified rollback after service restart failure', async () => {
  const a=makeAdapter({restartFailure:true});
  const out=await mod.executeWithAdapter(a);
  assert.equal(out.result,'FAILED_ROLLED_BACK');
  assert.deepEqual(a.files,a.originals);
});

test('permanent post-health failure is surfaced as rollback incomplete', async () => {
  const a=makeAdapter();
  a.sleep=async()=>{};
  a.health=async()=>{throw new Error('failure_during_post_health');};
  const out=await mod.executeWithAdapter(a);
  assert.equal(out.result,'FAILED_ROLLBACK_INCOMPLETE');
  assert.deepEqual(a.files,a.originals);
});

test('rollback verification failure is surfaced as incomplete', async () => {
  const a=makeAdapter({failAfterWrite:'executor',restoreFailure:'base'});
  const out=await mod.executeWithAdapter(a);
  assert.equal(out.result,'FAILED_ROLLBACK_INCOMPLETE');
});

test('preflight rejects malformed policy before writes', async () => {
  const a=makeAdapter();
  a.files.policy='{';
  await assert.rejects(() => mod.executeWithAdapter(a), /JSON|Unexpected|position/);
  assert.deepEqual(a.writes,[]);
});



test('retries transient post-restart health errors before declaring failure', async () => {
  const a=makeAdapter();
  let calls=0;
  a.sleep=async()=>{};
  a.health=async()=>{calls++;if(calls<3)throw new Error('connect ECONNREFUSED fixture.sock');return true;};
  const out=await mod.executeWithAdapter(a);
  assert.equal(out.result,'APPLIED');
  assert.equal(out.rollback_performed,false);
  assert.ok(calls>=3);
});

test('retries transient rollback health errors before declaring rollback incomplete', async () => {
  const a=makeAdapter({failAfterWrite:'executor'});
  let calls=0;
  a.sleep=async()=>{};
  a.health=async()=>{calls++;if(calls<3)throw new Error('connect ENOENT fixture.sock');return true;};
  const out=await mod.executeWithAdapter(a);
  assert.equal(out.result,'FAILED_ROLLED_BACK');
  assert.equal(out.rollback_performed,true);
  assert.ok(calls>=3);
});
test('sealed manifest matches the exact root seed artifact and fixed contract', () => {
  const manifest = require('./prhm-root-of-trust-fixed-seed-v1.manifest.json');
  const actual = require('node:crypto').createHash('sha256').update(fs.readFileSync('bootstrap-prhm-root-of-trust-fixed-seed-v1.js')).digest('hex');
  assert.equal(manifest.schema_version, 'prhm.root-of-trust-seed-manifest.v1');
  assert.equal(manifest.seed_id, 'prhm-root-of-trust-fixed-seed-v1');
  assert.equal(manifest.action_registered, ACTION);
  assert.match(manifest.artifact_sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.artifact_sha256, actual);
  assert.deepEqual(manifest.runtime_inputs, []);
  assert.deepEqual(manifest.baseline_sha256, mod.BASELINE_SHA);
  assert.equal(manifest.transport_helper_sha256, mod.TRANSPORT_HELPER_SHA);
});

test('seed and sealer expose no prohibited generic execution surface', () => {
  const sources=['bootstrap-prhm-root-of-trust-fixed-seed-v1.js','seal-prhm-root-of-trust-fixed-seed-v1.js'].map(x=>fs.readFileSync(x,'utf8')).join('\n');
  for(const forbidden of ['process.argv.slice(2)','authorized_keys','ssh-rsa','BEGIN OPENSSH PRIVATE KEY','createServer(','mysql2','node:pg','/home/drtarjomeh/domains/','shell:true','shell: true','.exec(']) {
    assert.equal(sources.includes(forbidden),false,forbidden);
  }
  assert.equal(sources.includes('http.createServer'),false);
});

test('runbook generator pure builder pins a validated immutable commit and manifest SHA', () => {
  const gen=require('./generate-prhm-root-of-trust-fixed-seed-runbook-v1.js');
  const commit='a'.repeat(40);
  const body=gen.buildRunbookForCommit(commit);
  assert.match(body,new RegExp(commit));
  const manifest=require('./prhm-root-of-trust-fixed-seed-v1.manifest.json');
  assert.match(body,new RegExp(manifest.artifact_sha256));
  assert.throws(()=>gen.buildRunbookForCommit('bad'),/invalid_artifact_commit/);
});
