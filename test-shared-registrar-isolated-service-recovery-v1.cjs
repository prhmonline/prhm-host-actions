'use strict';
// Real Linux child-process startup/restart/Unix socket health with actual
// durable four-file rename/rollback in disposable temp directories.
// Not an actual PRHM systemd service/Provider VM or Production deployment.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const net=require('node:net'),cp=require('node:child_process');
const tx=require('./shared-registrar-native-filesystem-v1.cjs');
const SVC=String.raw`
 const net=require('node:net'),fs=require('node:fs');
 const [owner,sock]=process.argv.slice(1);
 if(!fs.readFileSync(owner,'utf8').startsWith('HEALTHY_OWNER:'))
  process.exit(73);
 const server=net.createServer(s=>{s.end('OK:'+fs.readFileSync(owner,'utf8'))});
 server.listen(sock);
 process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`;
function fixture(){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-isolated-service-'));
 fs.chmodSync(home,0o700);
 const work=path.join(home,'journal');fs.mkdirSync(work,{mode:0o700});
 const owners=tx.KEYS.map(k=>{
  const p=path.join(home,k+'.js'),old=Buffer.from('HEALTHY_OWNER:'+k+'\n');
  const next=Buffer.from(k==='base'?'BROKEN_OWNER:base\n':'NEW_OWNER:'+k+'\n');
  fs.writeFileSync(p,old,{mode:0o600});
  return {key:k,path:p,original:old,nextBytes:next,beforeSha:tx.HASH(old),afterSha:tx.HASH(next)};
 });
 return {home,work,socket:path.join(home,'health.sock'),owners,
  plan:{schema:'prhm.registrar.native-transaction.v1',
   steps:owners.map(x=>({key:x.key,path:x.path,beforeSha:x.beforeSha,
     afterSha:x.afterSha,nextBytes:x.nextBytes})),
   sourceCommit:'a'.repeat(40),manifestSha256:'b'.repeat(64)},
  dispose:()=>fs.rmSync(home,{recursive:true,force:true})};
}
function ping(sock){
 return new Promise((resolve,reject)=>{
  const s=net.createConnection(sock);
  s.setTimeout(250,()=>s.destroy(Error('HEALTH_TIMEOUT')));
  let bytes='';s.on('data',c=>bytes+=c);
  s.on('end',()=>resolve(bytes));
  s.on('error',reject);
 });
}
const sleep=n=>new Promise(r=>setTimeout(r,n));
async function start(x){
 try{fs.unlinkSync(x.socket)}catch(e){if(e.code!=='ENOENT')throw e}
 const child=cp.spawn(process.execPath,['-e',SVC,x.owners[0].path,x.socket],
  {stdio:'ignore'});
 let last;
 for(let i=0;i<30;i++){
  if(child.exitCode!==null)break;
  try{
   const p=await ping(x.socket);
   if(p.startsWith('OK:HEALTHY_OWNER:base'))return {child,healthy:true};
   last=Error('UNEXPECTED_HEALTH_RESPONSE');
  }catch(e){last=e}
  await sleep(35);
 }
 try{child.kill('SIGTERM')}catch{}
 return {child,healthy:false,error:String(last?.message||'BOOT_FAILED')};
}
async function stop(child){
 if(!child||child.exitCode!==null)return;
 child.kill('SIGTERM');
 await new Promise(resolve=>{
  const timer=setTimeout(resolve,500);
  child.once('exit',()=>{clearTimeout(timer);resolve()});
 });
}
test('real isolated child process restart fails on bad candidate, four-owner rollback restores live Unix-socket health',async t=>{
 if(process.platform!=='linux')return t.skip('Linux-only real process recovery');
 const x=fixture();let service=null;
 try{
  service=(await start(x)).child;
  assert.match(await ping(x.socket),/^OK:HEALTHY_OWNER:base/);
  let postInstallRestart=0,postRollbackRestart=0;
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.work,
   postInstall:async()=>{
    postInstallRestart++;
    await stop(service);
    const result=await start(x);
    service=result.child;return result.healthy;
   },
   postRollback:async()=>{
    postRollbackRestart++;
    await stop(service);
    const result=await start(x);
    service=result.child;return result.healthy;
   }
  }),/postinstall_health/);
  assert.equal(postInstallRestart,1);
  assert.equal(postRollbackRestart,1);
  for(const xfile of x.owners){
   assert.deepEqual(fs.readFileSync(xfile.path),xfile.original);
   assert.equal(fs.statSync(xfile.path).mode&0o777,0o600);
  }
  assert.match(await ping(x.socket),/^OK:HEALTHY_OWNER:base/);
  assert.equal(fs.existsSync(path.join(x.work,'active.lock')),false);
  const dir=fs.readdirSync(x.work).find(v=>v.startsWith('txn-'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(x.work,dir,'journal.json'))).status,'ROLLED_BACK');
 }finally{await stop(service);x.dispose()}
});
test('missing rollback service health produces hard-stop journal and prevents another installer transaction',async t=>{
 if(process.platform!=='linux')return t.skip('Linux-only real process recovery');
 const x=fixture();
 try{
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.work,
    postInstall:async()=>false,
    postRollback:async()=>false}),/rollback_health_unverified/);
  const dir=fs.readdirSync(x.work).find(v=>v.startsWith('txn-'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(x.work,dir,'journal.json'))).status,'ROLLBACK_FAILED');
  await assert.rejects(tx.executeCore(x.plan,{workRoot:x.work,
    postInstall:async()=>true,postRollback:async()=>true}),/pending_transaction_requires_recovery/);
 }finally{x.dispose()}
});
