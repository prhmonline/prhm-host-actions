'use strict';
/**
 * Actual systemd restart + AF_UNIX health + native four-file rollback on a
 * disposable GitHub-hosted Linux VM. Four isolated mock PRHM service slots
 * are not the real Production application/service configurations.
 * Explicit fail-closed environment guard prevents running this on a server.
 */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cp=require('node:child_process'),net=require('node:net');
const tx=require('./shared-registrar-native-filesystem-v1.cjs');
const ORDER=Object.freeze(['base','executor','mcp-blue','mcp-green']);
const SYSTEMCTL='/usr/bin/systemctl';
const FIXTURE=path.join(__dirname,'test-shared-registrar-systemd-fixture-v1.cjs');
function guard(){
 if(process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()!==0||
  process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||
  process.env.RUNNER_OS!=='Linux'||process.env.REGISTRAR_SYSTEMD_VM!=='1'||
  !/^\/home\/runner\/work\//.test(process.env.GITHUB_WORKSPACE||'')||
  !fs.existsSync('/run/systemd/system')||
  fs.existsSync('/opt/prhm-agent-selfmaint/server.js'))
   throw Error('REGISTRAR_CI_SYSTEMD_VM_ONLY');
}
function ctl(args,timeout=15000){
 return cp.execFileSync(SYSTEMCTL,args,{encoding:'utf8',timeout,
    maxBuffer:50000,stdio:['ignore','pipe','pipe']}).trim();
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ping(sock){
 return new Promise((resolve,reject)=>{
  const s=net.createConnection({path:sock});
  s.setTimeout(250,()=>s.destroy(Error('health_timeout')));
  let output='';
  s.on('data',data=>output+=data);
  s.on('error',reject);
  s.on('end',()=>resolve(output));
 });
}
async function ready(unit,sock,expected){
 let last;
 for(let i=0;i<30;i++){
  try{
   if(ctl(['is-active',unit])==='active'&&
      (await ping(sock))===expected&&
      Number(ctl(['show',unit,'--property=MainPID','--value']))>0)return true;
  }catch(e){last=e}
  await sleep(80);
 }
 throw Error('systemd_health_failed:'+unit+':'+String(last?.message||'unknown'));
}
function setup(){
 guard();
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'registrar-ci-systemd-'));
 fs.chmodSync(home,0o700);
 const journal=path.join(home,'journal');fs.mkdirSync(journal,{mode:0o700});
 const unitPrefix='prhm-reg-ci-'+process.env.GITHUB_RUN_ID+'-';
 const slots=ORDER.map((name,i)=>{
  const owner=path.join(home,'owner'+i+'.js');
  const socket=path.join(home,'health'+i+'.sock');
  const before=Buffer.from('HEALTHY_'+name+'_OLD\n');
  const nextBytes=Buffer.from((i===1?'BROKEN_':'HEALTHY_')+name+'_NEXT\n');
  fs.writeFileSync(owner,before,{mode:0o600});
  const unit=unitPrefix+name+'.service';
  const dest=path.join('/run/systemd/system',unit);
  const text='[Unit]\nDescription=Disposable registrar CI service '+name+'\n'+
   '[Service]\nType=simple\nRestart=no\n'+
   'ExecStart='+process.execPath+' '+FIXTURE+' '+owner+' '+socket+'\n';
  fs.writeFileSync(dest,text,{mode:0o644,flag:'wx'});
  return {name,unit,dest,owner,socket,before,nextBytes};
 });
 ctl(['daemon-reload']);
 return {home,journal,slots,
   plan:{schema:'prhm.registrar.native-transaction.v1',
    steps:slots.map((s,i)=>({key:tx.KEYS[i],path:s.owner,
      beforeSha:tx.HASH(s.before),afterSha:tx.HASH(s.nextBytes),
      nextBytes:s.nextBytes})),
    assets:[],sourceCommit:'a'.repeat(40),manifestSha256:'b'.repeat(64)}
 };
}
async function restartAndVerify(slots,phase){
 // Each service is a genuine transient SYSTEMD unit on hosted Ubuntu,
 // with independent PID and Unix socket, not just an in-process mock.
 for(const s of slots){
  ctl(['restart',s.unit]);
  await ready(s.unit,s.socket,
   'OK:'+(phase==='rollback'?s.before:s.nextBytes).toString('utf8'));
 }
 return true;
}
function teardown(x){
 if(!x)return;
 for(const s of x.slots){
  try{ctl(['stop',s.unit],5000)}catch{}
  try{ctl(['reset-failed',s.unit],5000)}catch{}
  try{fs.unlinkSync(s.dest)}catch{}
 }
 try{ctl(['daemon-reload'],10000)}catch{}
 try{fs.rmSync(x.home,{force:true,recursive:true})}catch{}
}
test('four real systemd CI units restart; bad candidate causes exact four-owner rollback and healthy services',async()=>{
 guard();
 let x;
 try{
  x=setup();
  await restartAndVerify(x.slots,'rollback');
  const beforePids=x.slots.map(s=>Number(ctl(['show',s.unit,'--property=MainPID','--value'])));
  assert.equal(beforePids.filter(n=>n>0).length,4);
  let installChecked=0,rollbackChecked=0;
  await assert.rejects(tx.executeCore(x.plan,{
   workRoot:x.journal,
   postInstall:async()=>{
    installChecked++;
    try{return await restartAndVerify(x.slots,'install')}catch{return false}
   },
   postRollback:async()=>{
    rollbackChecked++;
    return restartAndVerify(x.slots,'rollback');
   }
  }),/postinstall_health/);
  assert.equal(installChecked,1);
  assert.equal(rollbackChecked,1);
  const afterPids=x.slots.map(s=>Number(ctl(['show',s.unit,'--property=MainPID','--value'])));
  assert.equal(afterPids.filter(n=>n>0).length,4);
  assert.ok(afterPids.some((pid,i)=>pid!==beforePids[i]),'systemd_did_not_restart');
  for(const s of x.slots){
   assert.deepEqual(fs.readFileSync(s.owner),s.before);
   assert.equal(fs.statSync(s.owner).mode&0o777,0o600);
   assert.equal(ctl(['is-active',s.unit]),'active');
   assert.equal(await ping(s.socket),'OK:'+s.before.toString('utf8'));
  }
  const txn=fs.readdirSync(x.journal).find(n=>n.startsWith('txn-'));
  assert.ok(txn);
  assert.equal(JSON.parse(fs.readFileSync(path.join(x.journal,txn,'journal.json'))).status,'ROLLED_BACK');
  assert.equal(fs.existsSync(path.join(x.journal,'active.lock')),false);
 }finally{teardown(x)}
});
