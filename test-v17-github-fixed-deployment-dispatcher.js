const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const dispatcherPath=path.join(__dirname,'prhm-host-actions-github-fixed-dispatcher-v1.js');

test('fixed dispatcher exposes only the approved promotion contract',()=>{
  assert.equal(fs.existsSync(dispatcherPath),true,'dispatcher must exist');
  const d=require(dispatcherPath);
  assert.deepEqual(d.CONTRACT,{
    schema_version:'prhm.github-fixed-deployment.v1',
    action:'root_scripts_fixed_stage_promotion_v1',
    source:'agent_api/root-stage-fixed-v1.candidate.txt',
    source_sha256:'22181213d9c6a1b5982778530a9b674782f6de023e6ed75f915366f995eb5bd8',
    target:'/opt/prhm-agent-selfmaint-exec/actions/root-scripts-fixed-stage-v1.js',
    target_preimage_sha256:'50c07d21fb2def962e6f801663f3293ce7c25ba00a410caa039792832910c5ee'
  });
  assert.throws(()=>d.validateInvocation(['node','dispatcher','anything'],{}),/unexpected_arguments/);
  assert.throws(()=>d.validateInvocation(['node','dispatcher'],{SSH_ORIGINAL_COMMAND:'id'}),/unexpected_original_command/);
  assert.doesNotThrow(()=>d.validateInvocation(['node','dispatcher'],{}));
});

function makeFixture(kind='valid'){
  const d=require(dispatcherPath);
  const sourceSha=d.CONTRACT.source_sha256;
  const preSha=d.CONTRACT.target_preimage_sha256;
  let targetSha=kind==='target_sha_mismatch'?'0'.repeat(64):preSha;
  const mutations=[];
  const state={targetSha,sourceSha,sourceSymlink:kind==='source_symlink',targetSymlink:kind==='target_symlink',health:kind==='executor_unhealthy'?false:true,nodeOk:kind==='candidate_syntax_failure'?false:true,postHealthFail:kind==='post_write_health_failure'};
  const ops={
    stat(which){
      if(which==='source') return {isFile:()=>true,isSymbolicLink:()=>state.sourceSymlink,mode:0o600,uid:1000,gid:1000};
      if(which==='target') return {isFile:()=>true,isSymbolicLink:()=>state.targetSymlink,mode:0o700,uid:0,gid:0};
      throw new Error('unexpected_stat');
    },
    sha256File(which){
      if(which==='source') return kind==='source_sha_mismatch'?'f'.repeat(64):state.sourceSha;
      if(which==='target') return state.targetSha;
      if(which==='installed') return state.targetSha;
      throw new Error('unexpected_sha');
    },
    nodeCheck(){if(!state.nodeOk) throw new Error('candidate_syntax_failure'); return true;},
    executorHealth(){
      if(state.postHealthFail && state.targetSha===state.sourceSha) return {ok:false,host_actions_v2:[]};
      return {ok:state.health,host_actions_v2:['root_scripts_fixed_stage_v1']};
    },
    readFile(which){if(which==='target') return Buffer.from('preimage'); if(which==='source') return Buffer.from('candidate'); throw new Error('unexpected_read');},
    writeExclusive(which,bytes,meta){mutations.push(`write_${which}`); return {which,bytes,meta};},
    fsyncFile(which){mutations.push(`fsync_${which}`);},
    rename(from,to){
      if(to==='target'){mutations.push('rename_install');state.targetSha=state.sourceSha;}
      if(to==='rollback_target'){mutations.push('rename_rollback');state.targetSha=preSha;}
    },
    fsyncDir(){mutations.push('fsync_dir');},
    restartExecutor(){mutations.push('restart');},
    now(){return '20260824T000000Z';}
  };
  return {d,ops,mutations,state,currentTargetSha:()=>state.targetSha};
}

for(const name of ['source_sha_mismatch','target_sha_mismatch','source_symlink','target_symlink','candidate_syntax_failure','executor_unhealthy']){
  test(`preflight denies ${name} before mutation`,()=>{
    const fx=makeFixture(name);
    const dispatcher=fx.d.createDispatcher(fx.ops);
    assert.throws(()=>dispatcher.preflight(),new RegExp(name));
    assert.equal(fx.mutations.length,0);
  });
}

test('valid promotion backs up, atomically replaces, verifies and reports exact final SHA',()=>{
  const fx=makeFixture('valid');
  const result=fx.d.createDispatcher(fx.ops).apply();
  assert.equal(result.ok,true);
  assert.equal(result.action,fx.d.CONTRACT.action);
  assert.equal(result.before_sha256,fx.d.CONTRACT.target_preimage_sha256);
  assert.equal(result.after_sha256,fx.d.CONTRACT.source_sha256);
  assert.equal(result.rollback_performed,false);
  assert.equal(fx.currentTargetSha(),fx.d.CONTRACT.source_sha256);
  assert.ok(fx.mutations.indexOf('write_backup') < fx.mutations.indexOf('rename_install'));
  assert.ok(fx.mutations.includes('fsync_temp'));
  assert.ok(fx.mutations.includes('fsync_dir'));
});

test('post-write verification failure restores exact preimage',()=>{
  const fx=makeFixture('post_write_health_failure');
  const result=fx.d.createDispatcher(fx.ops).apply();
  assert.equal(result.ok,false);
  assert.equal(result.rollback_performed,true);
  assert.equal(result.status,'FAILED_ROLLED_BACK');
  assert.equal(fx.currentTargetSha(),fx.d.CONTRACT.target_preimage_sha256);
  assert.ok(fx.mutations.includes('rename_rollback'));
});

test('second execution is idempotent and performs zero mutation',()=>{
  const fx=makeFixture('valid');
  fx.state.targetSha=fx.d.CONTRACT.source_sha256;
  const result=fx.d.createDispatcher(fx.ops).apply();
  assert.equal(result.ok,true);
  assert.equal(result.already_applied,true);
  assert.equal(result.mutation,false);
  assert.equal(fx.mutations.length,0);
});
