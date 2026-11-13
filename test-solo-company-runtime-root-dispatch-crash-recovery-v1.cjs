'use strict';
/**
 * Linux native SIGKILL crash-recovery integration. Only disposable temporary
 * files, never real /opt, /etc, /home, or systemd units.
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const native=require('./honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.argv[2]==='--simulate-crash'){
  const file=process.argv[3];
  const m=JSON.parse(fs.readFileSync(file,'utf8'));
  const plan={...m.plan,
    steps:m.plan.steps.map(x=>({...x,nextBytes:Buffer.from(x.candidate,'base64')})),
    assets:m.plan.assets.map(x=>({...x,nextBytes:Buffer.from(x.candidate,'base64')}))};
  native.executeCore(plan,{workRoot:m.workRoot,
    postInstall:async()=>true,postRollback:async()=>true,
    onRenamed:(key,index)=>{
      if(index===5)process.kill(process.pid,'SIGKILL');
    }}).catch(e=>{process.stderr.write(String(e.message));process.exitCode=1});
}else{
  const test=require('node:test');
  const assert=require('node:assert/strict');
  test('SIGKILL after sixth rename restores owners/core and removes worker',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'solo-sigkill-'));
    fs.chmodSync(root,0o700);
    const workRoot=path.join(root,'work'),owners=path.join(root,'owners'),assets=path.join(root,'assets');
    for(const d of [workRoot,owners,assets])fs.mkdirSync(d,{mode:0o700});
    try{
      const steps=native.KEYS.map((key,i)=>{
        const filename=path.join(owners,key+'.js');
        const before=Buffer.from('original-'+key),after=Buffer.from('new-'+key);
        fs.writeFileSync(filename,before,{mode:0o600});
        return {key,path:filename,beforeSha:sha(before),afterSha:sha(after),
          expectedUid:process.getuid(),expectedGid:process.getgid(),expectedMode:0o600,
          candidate:after.toString('base64')};
      });
      const core=path.join(assets,'core.js'),worker=path.join(assets,'worker.js');
      const coreBefore=Buffer.from('existing-core'),coreAfter=Buffer.from('candidate-core'),
        workerAfter=Buffer.from('candidate-worker');
      fs.writeFileSync(core,coreBefore,{mode:0o644});
      const assetPlan=[
        {path:core,afterSha:sha(coreAfter),expectedBeforeSha:sha(coreBefore),
          expectedPostMode:0o644,candidate:coreAfter.toString('base64')},
        {path:worker,afterSha:sha(workerAfter),expectedBeforeSha:null,
          expectedPostMode:0o700,candidate:workerAfter.toString('base64')}
      ];
      const manifest=path.join(root,'test-data.json');
      fs.writeFileSync(manifest,JSON.stringify({
        workRoot,plan:{schema:'prhm.registrar.native-transaction.v1',
          sourceCommit:'a'.repeat(40),manifestSha256:'b'.repeat(64),
          steps,assets:assetPlan}
      }),{mode:0o600});
      const child=cp.spawnSync(process.execPath,[__filename,'--simulate-crash',manifest],
        {encoding:'utf8',timeout:18000});
      assert.equal(child.signal,'SIGKILL',child.stderr);
      assert.equal(fs.existsSync(worker),true);
      assert.equal(fs.statSync(worker).mode&0o777,0o700);
      const txs=fs.readdirSync(workRoot).filter(x=>x.startsWith('txn-'));
      assert.equal(txs.length,1);
      const dir=path.join(workRoot,txs[0]);
      const journal=JSON.parse(fs.readFileSync(path.join(dir,'journal.json')));
      assert.equal(journal.status,'INSTALLING');
      const r=await native.recoverAfterCrash({workRoot,transaction:dir,
        expectedTargets:steps.map(x=>x.path),
        expectedAssets:assetPlan.map(x=>x.path),
        postRollback:async()=>true});
      assert.equal(r.status,'ROLLED_BACK');
      for(const step of steps){
        assert.equal(sha(fs.readFileSync(step.path)),step.beforeSha);
        assert.equal(fs.statSync(step.path).mode&0o777,0o600);
      }
      assert.equal(sha(fs.readFileSync(core)),sha(coreBefore));
      assert.equal(fs.statSync(core).mode&0o777,0o644);
      assert.equal(fs.existsSync(worker),false);
      const j=JSON.parse(fs.readFileSync(path.join(dir,'journal.json')));
      assert.equal(j.status,'ROLLED_BACK');
      const again=await native.recoverAfterCrash({workRoot,transaction:dir,
        expectedTargets:steps.map(x=>x.path),
        expectedAssets:assetPlan.map(x=>x.path),
        postRollback:async()=>true});
      assert.equal(again.changed,false);
    }finally{fs.rmSync(root,{recursive:true,force:true})}
  });
}
