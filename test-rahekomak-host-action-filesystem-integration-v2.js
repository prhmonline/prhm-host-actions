'use strict';
/*
 * Disk-backed integration: every write is confined to mkdtemp under os.tmpdir().
 * NOTHING in this file can open actual control-plane or /home/prhm targets.
 * Authentication is a fake in the test adapter, NOT production authorization.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const mod=require('./rahekomak-host-action-typed-registration-bootstrap-v2.js');
const registry=require('./rahekomak-host-action-registration-v2.js');
const script=fs.readFileSync(path.join(__dirname,'rahekomak-host-action-typed-registration-bootstrap-v2.js'),'utf8');
const sandbox={require,module:{exports:{}},Buffer,process:{argv:['node','test-only'],stderr:{write(){}}}};
vm.runInNewContext(script+String.fromCharCode(10)+';__fixtureTransaction=runApprovedTransaction;',sandbox,{timeout:1000});
const invoke=sandbox.__fixtureTransaction;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

function environment(options={}){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-rahekomak-sandbox-'));
 const files=path.join(home,'fs');
 const backups=path.join(home,'backup');
 const reports=path.join(home,'receipts');
 for(const p of [files,backups,reports])fs.mkdirSync(p,{mode:0o700});
 const canonical=mod.paths();
 const rel=new Map(canonical.map((target,i)=>[target,path.join(files,'file-'+String(i).padStart(2,'0'))]));
 const initial=new Map(),events=[],receipts=[];
 let writeCount=0,failed=false,locked=false,receiptCount=0;
 const steps=canonical.map((target,i)=>{
   const prior=i<4?Buffer.from('baseline-content-'+i):null;
   const backing=rel.get(target);
   if(prior)fs.writeFileSync(backing,prior,{mode:0o640,flag:'wx'});
   initial.set(target,prior);
   const bytes=Buffer.from('candidate-payload-'+i);
   const stat=prior?fs.lstatSync(backing):{mode:0o640,uid:process.getuid(),gid:process.getgid()};
   return {key:i<4?mod.KEYS[i]:mod.NAMES[i-4],target,
     previous:prior,previous_sha:prior?sha(prior):null,
     bytes,next_sha:sha(bytes),mode:stat.mode&0o777,uid:stat.uid,gid:stat.gid,was_present:i<4};
 });
 const fileFor=target=>{
   const p=rel.get(target);
   if(!p)throw Error('outside_allowlist');
   return p;
 };
 const io={
  async acquireExclusive(){if(locked)throw Error('lock_held');locked=true;events.push('lock');return async()=>{locked=false;events.push('unlock')}},
  async consumeSignedLevel4(){events.push('approval:mock');return {
   trusted_dispatcher:true,signature_verified:true,one_time_consumed:true,
   action:mod.ACTION,operation:mod.OPERATION,source_commit:mod.SOURCE_COMMIT,request_id:'sandbox-fake'}},
  async hasReceipt(){return false},
  statExact(target){
    const p=fileFor(target);
    try{const st=fs.lstatSync(p);
     return {exists:true,regular:st.isFile(),symlink:st.isSymbolicLink(),
       realpath:st.isSymbolicLink()?fs.realpathSync(p):target,
       mode:st.mode&0o777,uid:st.uid,gid:st.gid};
    }catch(e){if(e.code==='ENOENT')return {exists:false};throw e}
  },
  readBytes(target){return fs.readFileSync(fileFor(target))},
  async backupExact(target,bytes,digest,request){
    assert.equal(sha(bytes),digest);
    assert.equal(request,'sandbox-fake');
    const backup=path.join(backups,String(canonical.indexOf(target)));
    fs.writeFileSync(backup,bytes,{flag:'wx',mode:0o600});
    assert.equal(sha(fs.readFileSync(backup)),digest);
    events.push('backup');
  },
  async replaceAtomic(target,bytes,meta){
    const p=fileFor(target),tmp=p+'.atomic-'+String(writeCount);
    fs.writeFileSync(tmp,bytes,{flag:'wx',mode:meta.mode});
    fs.chmodSync(tmp,meta.mode);
    fs.renameSync(tmp,p);
    events.push('rename');
    ++writeCount;
    if(!failed&&options.failAfterRename===writeCount){
      failed=true;throw Error('injected_after_rename');
    }
  },
  async removeExact(target){fs.unlinkSync(fileFor(target));events.push('unlink')},
  async reloadAndHealth(phase){
    events.push('health:'+phase);
    if(phase==='candidate'){
      if(options.failHealth)return {ok:false,protect_home:'yes',actions:[]};
      for(const step of steps)assert.equal(sha(fs.readFileSync(fileFor(step.target))),step.next_sha);
    }else{
      for(const step of steps){
        const p=fileFor(step.target);
        if(step.was_present)assert.deepEqual(fs.readFileSync(p),initial.get(step.target));
        else assert.equal(fs.existsSync(p),false);
      }
    }
    return {ok:true,protect_home:'yes',
      actions:[registry.ACTION_STAGE,registry.ACTION_ACTIVATE]};
  },
  async persistReceipt(record){
    if(options.failSuccessReceipt&&record.status==='registration_installed')
       throw Error('injected_receipt_failure');
    const filename=path.join(reports,String(++receiptCount).padStart(2,'0')+'.json');
    fs.writeFileSync(filename,JSON.stringify(record)+'\n',{flag:'wx',mode:0o600});
    receipts.push(record);
    assert.equal(JSON.parse(fs.readFileSync(filename,'utf8')).status,record.status);
    events.push('receipt:'+record.status);
  },
 };
 function verifyRestored(){
   for(const step of steps){
     const p=fileFor(step.target);
     if(step.was_present){
       assert.deepEqual(fs.readFileSync(p),initial.get(step.target));
       assert.equal(fs.statSync(p).mode&0o777,step.mode);
     }else assert.equal(fs.existsSync(p),false);
   }
 }
 function cleanup(){fs.rmSync(home,{recursive:true,force:true})}
 return {home,io,steps,events,receipts,fileFor,verifyRestored,cleanup};
}
const plan=steps=>({action:mod.ACTION,operation:mod.OPERATION,
 source_commit:mod.SOURCE_COMMIT,steps});
test('actual on-disk atomic rename: 9 isolated paths, 4 exact backups, 9 persisted hashes',async()=>{
 const env=environment();
 try{
   const result=await invoke(env.io,plan(env.steps));
   assert.equal(result.status,'registration_installed');
   assert.equal(env.events.filter(x=>x==='backup').length,4);
   assert.equal(env.events.filter(x=>x==='rename').length,9);
   assert.ok(env.events.indexOf('rename')>env.events.lastIndexOf('backup'));
   assert.equal(env.receipts.at(-1).changed.length,9);
   assert.ok(env.events.includes('health:candidate'));
 }finally{env.cleanup()}
});
test('real disk rollback from every post-rename fault 1..9',async()=>{
 for(let point=1;point<=9;point++){
   const env=environment({failAfterRename:point});
   try{
     await assert.rejects(invoke(env.io,plan(env.steps)),/registration_failed_rollback_complete/);
     env.verifyRestored();
     assert.equal(env.receipts.at(-1).rollback_performed,true);
     assert.ok(env.events.includes('health:baseline'));
   }finally{env.cleanup()}
 }
});
test('on-disk rollback on failing health and final receipt',async()=>{
 for(const options of [{failHealth:true},{failSuccessReceipt:true}]){
   const env=environment(options);
   try{
     await assert.rejects(invoke(env.io,plan(env.steps)),/registration_failed_rollback_complete/);
     env.verifyRestored();
     assert.ok(env.events.includes('health:baseline'));
   }finally{env.cleanup()}
 }
});
test('on-disk symlink replacement of one pinned owner fails before any write',async()=>{
 const env=environment();
 try{
   const target=env.steps[0].target,p=env.fileFor(target),trap=p+'.trap';
   fs.renameSync(p,trap);
   fs.symlinkSync(trap,p);
   await assert.rejects(invoke(env.io,plan(env.steps)),/unsafe_owner_state/);
   assert.equal(env.events.includes('rename'),false);
   assert.equal(env.events.includes('backup'),false);
 }finally{env.cleanup()}
});
test('filesystem adapter rejects unknown paths and does not access production',()=>{
 const env=environment();
 try{
   assert.throws(()=>env.fileFor('/opt/prhm-agent-selfmaint-exec/server.js/../unexpected'),/outside_allowlist/);
   assert.throws(()=>env.fileFor('/home/prhm/projects/generated/rahekomak'),/outside_allowlist/);
   assert.ok(env.home.startsWith(os.tmpdir()));
 }finally{env.cleanup()}
});
