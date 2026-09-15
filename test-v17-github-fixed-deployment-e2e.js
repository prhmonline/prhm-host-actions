const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');

const dispatcher=require('./prhm-host-actions-github-fixed-dispatcher-v1.js');
const generator=require('./generate-github-fixed-deployment-channel-v1.js');
const dispatcherSource=fs.readFileSync(path.join(__dirname,'prhm-host-actions-github-fixed-dispatcher-v1.js'),'utf8');
const generatorSource=fs.readFileSync(path.join(__dirname,'generate-github-fixed-deployment-channel-v1.js'),'utf8');
const deployKey='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZm deploy-fixture';
const hostKey='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGdnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dn host-fixture';

function sha(b){return crypto.createHash('sha256').update(b).digest('hex');}

function realFixture({failPostHealth=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-gh-fixed-e2e-'));
  const files={source:path.join(root,'source.js'),target:path.join(root,'target.js'),backup:path.join(root,'backup.js'),temp:path.join(root,'temp.js'),rollback_temp:path.join(root,'rollback-temp.js')};
  const candidate=Buffer.from("'use strict';\nmodule.exports='candidate';\n");
  const preimage=Buffer.from("'use strict';\nmodule.exports='preimage';\n");
  fs.writeFileSync(files.source,candidate,{mode:0o700});
  fs.writeFileSync(files.target,preimage,{mode:0o700});
  function contractHash(file){
    const b=fs.readFileSync(file);
    if(b.equals(candidate)) return dispatcher.CONTRACT.source_sha256;
    if(b.equals(preimage)) return dispatcher.CONTRACT.target_preimage_sha256;
    return sha(b);
  }
  const ops={
    stat(which){return fs.lstatSync(files[which]);},
    sha256File(which){return contractHash(which==='source'?files.source:files.target);},
    nodeCheck(which){const p=which==='source'?files.source:files.target;require('node:child_process').execFileSync(process.execPath,['--check',p],{stdio:'pipe'});return true;},
    executorHealth(){const targetIsCandidate=fs.readFileSync(files.target).equals(candidate);return failPostHealth&&targetIsCandidate?{ok:false,host_actions_v2:[]}:{ok:true,host_actions_v2:['root_scripts_fixed_stage_v1']};},
    readFile(which){return fs.readFileSync(files[which]);},
    writeExclusive(which,bytes){const p=files[which];const fd=fs.openSync(p,'wx',0o700);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return p;},
    fsyncFile(which){const fd=fs.openSync(files[which],'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}},
    rename(from,to){const dst=to==='target'||to==='rollback_target'?files.target:files[to];fs.renameSync(files[from],dst);},
    fsyncDir(){const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}},
    now(){return '20260824T000000Z';}
  };
  return {root,files,candidate,preimage,ops,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('dispatcher exposes a zero-input fixed runtime ops factory for forced-command execution',()=>{
  assert.equal(typeof dispatcher.createFixedRuntimeOps,'function','createFixedRuntimeOps must exist');
  assert.throws(()=>dispatcher.createFixedRuntimeOps({}),/unexpected_arguments/);
  assert.doesNotThrow(()=>dispatcher.createFixedRuntimeOps());
  assert.doesNotMatch(dispatcherSource,/unsealed_runtime_not_executable/);
  assert.match(dispatcherSource,/\/home\/agent\/ssh-agent-api\/root-stage-fixed-v1\.candidate\.txt/);
  assert.match(dispatcherSource,/\/var\/backups\/prhm-host-actions-github-fixed-deployment-v1/);
  assert.match(dispatcherSource,/\/run\/prhm-agent-selfmaint-exec\/exec\.sock/);
});

test('local fixture proves exact promotion, idempotency and rollback without production mutation',()=>{
  let fx=realFixture();
  try{
    const result=dispatcher.createDispatcher(fx.ops).apply();
    assert.equal(result.ok,true);
    assert.deepEqual(fs.readFileSync(fx.files.target),fx.candidate);
    assert.deepEqual(fs.readFileSync(fx.files.backup),fx.preimage);
    const again=dispatcher.createDispatcher(fx.ops).apply();
    assert.equal(again.already_applied,true);
    assert.equal(again.mutation,false);
  }finally{fx.cleanup();}

  fx=realFixture({failPostHealth:true});
  try{
    const result=dispatcher.createDispatcher(fx.ops).apply();
    assert.equal(result.status,'FAILED_ROLLED_BACK');
    assert.deepEqual(fs.readFileSync(fx.files.target),fx.preimage);
  }finally{fx.cleanup();}
});

test('sealed channel remains zero-input and contains no production application/database capability',()=>{
  const sealed=generator.generate({deployPublicKey:deployKey,sshHost:'agent.prhm.ir',sshPort:40222,hostPublicKey:hostKey});
  assert.match(sealed.workflowYaml,/workflow_dispatch:/);
  assert.doesNotMatch(sealed.workflowYaml,/inputs:/);
  assert.doesNotMatch(dispatcherSource+generatorSource,/\/home\/drtarjomeh|drtarjomeh_prod|mysql|mariadb|psql|INSERT\s|UPDATE\s|DELETE\s/i);
  assert.doesNotMatch(dispatcherSource+generatorSource,/StrictHostKeyChecking=no|sshpass|\bscp\s|\bsftp\s|\brsync\s/);
});
