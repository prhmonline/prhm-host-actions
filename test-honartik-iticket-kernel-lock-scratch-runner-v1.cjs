'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {once}=require('node:events');
const disk=require('./honartik-iticket-root-installer-disk-fixture-v1.cjs');
const engine=require('./honartik-iticket-root-installer-transaction-engine-v1.cjs');
const runner=require('./honartik-iticket-kernel-lock-scratch-runner-v1.cjs');
function setup(t){
  const p=disk.createFixture();
  t.after(()=>disk.destroyFixture(p.root));
  return p;
}
const original=key=>engine.sha256(Buffer.from('DISK_FIXTURE_ORIGINAL_'+key));
const candidate=key=>engine.sha256(Buffer.from('DISK_FIXTURE_CANDIDATE_'+key));
function journal(p){
  return JSON.parse(fs.readFileSync(path.join(p.root,'transactions',runner.TX_ID,'journal.json'),'utf8'));
}
test('kernel lock scratch probe via inherited POSIX lock descriptor',t=>{
  const p=setup(t);
  const child=runner.runFixture(p.root,'probe');
  assert.equal(child.status,0,'stderr: '+child.stderr);
  assert.match(child.stdout,/KERNEL_FLOCK_INHERITED=PASS/);
});
test('kernel lock ownership rejects concurrent independent child without overwrite',async t=>{
  const p=setup(t);
  const holder=runner.spawnFixture(p.root,'hold');
  let out='',err='';
  holder.stdout.on('data',x=>{out+=x;});
  holder.stderr.on('data',x=>{err+=x;});
  t.after(()=>{if(holder.exitCode===null)holder.kill('SIGKILL');});
  await new Promise((resolve,reject)=>{
    const limit=setTimeout(()=>reject(Error('holder_did_not_acquire_lock: '+err)),4500);
    function onData(){
      if(out.includes('LOCK_HOLD_READY=YES')){clearTimeout(limit);holder.stdout.off('data',onData);resolve();}
    }
    holder.stdout.on('data',onData);
    onData();
  });
  const blocked=runner.runFixture(p.root,'probe');
  assert.equal(blocked.status,73,'contention should use util-linux flock -E code');
  assert.equal(blocked.stdout,'');
  assert.equal(blocked.stderr,'');
  const bad=runner.runFixture(p.root,'apply');
  assert.equal(bad.status,73);
  assert.equal(fs.existsSync(path.join(p.root,'transactions',runner.TX_ID,'journal.json')),false);
  holder.kill('SIGKILL');
  await once(holder,'exit');
  const resumed=runner.runFixture(p.root,'probe');
  assert.equal(resumed.status,0,'flock must release lock on SIGKILL: '+resumed.stderr);
  assert.match(resumed.stdout,/KERNEL_FLOCK_INHERITED=PASS/);
});
test('flock wraps real scratch four-owner commit in exact command only',t=>{
  const p=setup(t);
  const res=runner.runFixture(p.root,'apply');
  assert.equal(res.status,0,'stderr: '+res.stderr);
  assert.match(res.stdout,/SCRATCH_TRANSACTION_COMMITTED=PASS/);
  assert.equal(journal(p).state,'COMMITTED');
  for(const key of engine.ORDER){
    const bytes=fs.readFileSync(path.join(p.root,'owners',key+'.owner'));
    assert.equal(engine.sha256(bytes),candidate(key));
  }
  // Existing committed transaction cannot be silently re-applied.
  const again=runner.runFixture(p.root,'apply');
  assert.notEqual(again.status,0);
  assert.match(again.stderr,/transaction_id_reuse/);
});
test('flock exits abruptly after second rename and releases kernel lock for recover',t=>{
  const p=setup(t);
  const crash=runner.runFixture(p.root,'crash-after-exec');
  assert.equal(crash.status,86,'error: '+crash.stderr);
  assert.match(crash.stdout,/CRASH_AFTER_SECOND_REAL_RENAME=YES/);
  assert.equal(journal(p).state,'APPLYING');
  assert.equal(journal(p).inflight,'exec');
  assert.equal(engine.sha256(fs.readFileSync(path.join(p.root,'owners','base.owner'))),candidate('base'));
  assert.equal(engine.sha256(fs.readFileSync(path.join(p.root,'owners','exec.owner'))),candidate('exec'));
  const recovered=runner.runFixture(p.root,'recover');
  assert.equal(recovered.status,0,'error: '+recovered.stderr);
  assert.match(recovered.stdout,/SCRATCH_RECOVERY=PASS/);
  assert.equal(journal(p).state,'ROLLED_BACK');
  for(const key of engine.ORDER)
    assert.equal(engine.sha256(fs.readFileSync(path.join(p.root,'owners',key+'.owner'))),original(key));
  const retry=runner.runFixture(p.root,'recover');
  assert.equal(retry.status,0,'idempotent verified receipt: '+retry.stderr);
});
test('recover refuses third-party changes after process crash and preserves evidence',t=>{
  const p=setup(t);
  assert.equal(runner.runFixture(p.root,'crash-after-exec').status,86);
  fs.writeFileSync(path.join(p.root,'owners','exec.owner'),Buffer.from('EXTERNAL_CHANGE'));
  const blocked=runner.runFixture(p.root,'recover');
  assert.notEqual(blocked.status,0);
  assert.match(blocked.stderr,/unrecognized_live_drift/);
  assert.equal(journal(p).state,'RECOVERY_BLOCKED');
  assert.equal(engine.sha256(fs.readFileSync(path.join(p.root,'owners','exec.owner'))),
    engine.sha256(Buffer.from('EXTERNAL_CHANGE')));
});
test('no acceptance of foreign paths or dynamic shell commands',t=>{
  const p=setup(t);
  assert.throws(()=>runner.runFixture('/root','probe'),/root_invalid|root_outside_scratch/);
  assert.throws(()=>runner.runFixture(p.root,'rm -rf /'),/operation_not_allowed/);
  const f=runner.lockFile(p.root);
  fs.unlinkSync(f);fs.symlinkSync('/etc/hostname',f);
  assert.throws(()=>runner.runFixture(p.root,'probe'),/lock_file_untrusted/);
});
test('synthetic kernel adapter never identifies as signed live root installer',()=>{
  const src=fs.readFileSync(require.resolve('./honartik-iticket-kernel-lock-scratch-runner-v1.cjs'),'utf8');
  for(const str of ['systemctl restart','sudo ','/opt/prhm-agent-selfmaint/server.js',
    "mode:'production'",'host_action_v2_apply('])
    assert.equal(src.includes(str),false,'production primitive in scratch runner: '+str);
});

test('security: forged inherited fd without flock is rejected as unlocked',t=>{
  const p=setup(t);
  const fd=fs.openSync(runner.lockFile(p.root),'r');
  let result;
  try{
    result=require('node:child_process').spawnSync(process.execPath,[
      require.resolve('./honartik-iticket-kernel-lock-scratch-runner-v1.cjs'),
      '--worker','probe',p.root
    ],{stdio:['ignore','pipe','pipe',fd],encoding:'utf8',timeout:5000});
  }finally{fs.closeSync(fd);}
  assert.equal(result.status,65,'forged unlocked FD must fail: '+result.stderr);
  assert.match(result.stderr,/kernel_lock_fd_not_inherited/);
});
