'use strict';
/**
 * Issue #217: actual ephemeral GitHub-hosted Linux systemd VM regression.
 *
 * REHEARSAL ONLY. Test-scoped synthetic owners and units; never connects to
 * Provider, Approval Center, private VM, or Production. No L4 issuer/apply.
 * This is not evidence of a signed real root bootstrap.
 */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const TX=require('./honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs');
const PREFIX='prhm-honartik217-vm-';
const unitDir='/run/systemd/system';
const fail=x=>{throw Error('honartik217_vm_'+x)};

function guard(){
 if(process.platform!=='linux'||process.getuid?.()!==0||
   process.env.GITHUB_ACTIONS!=='true'||
   process.env.RUNNER_ENVIRONMENT!=='github-hosted'||
   !process.env.GITHUB_WORKSPACE||
   !__dirname.startsWith(path.resolve(process.env.GITHUB_WORKSPACE))||
   !fs.existsSync('/run/systemd/system')||
   !fs.existsSync('/run/systemd/private'))
  fail('disposable_github_systemd_vm_only');
}
function systemctl(args,{allowFailure=false}={}){
 const p=cp.spawnSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:30000});
 if(p.error||p.status!==0){
  if(allowFailure)return false;
  fail('systemctl_'+args.join('_')+'_'+String(p.stderr||p.error).slice(0,160));
 }
 return true;
}
function createFixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),PREFIX));
 fs.chmodSync(root,0o700);
 const workRoot=path.join(root,'journal');
 const assetRoot=path.join(root,'assets');
 fs.mkdirSync(workRoot,{mode:0o700});
 fs.mkdirSync(assetRoot,{mode:0o700});
 const fault=path.join(root,'force-candidate-failure');
 const health=path.join(root,'unit-health.js');
 fs.writeFileSync(health,`const fs=require('node:fs');
const b=fs.readFileSync(process.argv[2],'utf8').trim();
if(!b.startsWith('original-fixture-owner-')&&!b.startsWith('candidate-fixture-owner-'))process.exit(21);
if(b.startsWith('candidate-fixture-owner-')&&fs.existsSync(process.argv[3]))process.exit(22);
`,{mode:0o600});
 const suffix=crypto.randomUUID().slice(0,8);
 const units=[];
 for(const key of ['base','executor']){
  const name='prhm-honartik217-fixture-'+suffix+'-'+key+'.service';
  const owner=path.join(root,key+'.js');
  const unitFile=path.join(unitDir,name);
  const unit=`[Unit]
Description=Honartik 217 disposable GitHub VM ${key} service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${process.execPath} ${health} ${owner} ${fault}
TimeoutStartSec=15s
[Install]
WantedBy=multi-user.target
`;
  fs.writeFileSync(unitFile,unit,{mode:0o644,flag:'wx'});
  units.push({name,unitFile});
 }
 systemctl(['daemon-reload']);
 return {root,workRoot,assetRoot,fault,units};
}
function planFor(f){
 const steps=TX.KEYS.map(key=>{
  const filename=path.join(f.root,key+'.js');
  const prior=Buffer.from('original-fixture-owner-'+key+'\n');
  const nextBytes=Buffer.from('candidate-fixture-owner-'+key+'\n');
  if(!fs.existsSync(filename))fs.writeFileSync(filename,prior,{mode:0o600});
  const st=fs.lstatSync(filename);
  return {key,path:filename,beforeSha:TX.HASH(prior),
   afterSha:TX.HASH(nextBytes),nextBytes,
   expectedUid:st.uid,expectedGid:st.gid,
   expectedMode:st.mode&0o777};
 });
 const assetPath=path.join(f.assetRoot,'fixed-native-shim.cjs');
 const assetBytes=Buffer.from('synthetic-root-shim-immutable-git-asset\n');
 return {schema:'prhm.registrar.native-transaction.v1',
  steps,assets:[{path:assetPath,nextBytes:assetBytes,afterSha:TX.HASH(assetBytes)}],
  sourceCommit:'a'.repeat(40),manifestSha256:'b'.repeat(64)};
}
function startServices(f){
 for(const u of f.units)systemctl(['start',u.name]);
 for(const u of f.units)assert.equal(systemctl(['is-active','--quiet',u.name]),true);
}
function restartServices(f){
 let ok=true;
 for(const u of f.units){
  systemctl(['reset-failed',u.name],{allowFailure:true});
  ok=systemctl(['restart',u.name],{allowFailure:true})&&ok;
 }
 for(const u of f.units)ok=systemctl(['is-active','--quiet',u.name],{allowFailure:true})&&ok;
 return ok;
}
function expectState(f,plan,state,assetExists){
 for(const s of plan.steps){
  const before=Buffer.from('original-fixture-owner-'+s.key+'\n');
  assert.equal(TX.HASH(fs.readFileSync(s.path)),state==='original'?TX.HASH(before):s.afterSha);
  const st=fs.statSync(s.path);
  assert.equal(st.uid,s.expectedUid);
  assert.equal(st.gid,s.expectedGid);
  assert.equal(st.mode&0o777,s.expectedMode);
 }
 const a=plan.assets[0];
 assert.equal(fs.existsSync(a.path),assetExists);
 if(assetExists)assert.equal(TX.HASH(fs.readFileSync(a.path)),a.afterSha);
 for(const u of f.units)assert.equal(systemctl(['is-active','--quiet',u.name]),true);
}
function status(f,expected){
 const txn=fs.readdirSync(f.workRoot).filter(x=>x.startsWith('txn-'));
 assert.equal(txn.length,1,'exactly one durable journal');
 const dir=path.join(f.workRoot,txn[0]);
 const j=JSON.parse(fs.readFileSync(path.join(dir,'journal.json')));
 assert.equal(j.status,expected);
 return dir;
}
function dispose(f){
 if(!f)return;
 for(const u of f.units||[])systemctl(['stop',u.name],{allowFailure:true});
 for(const u of f.units||[])try{fs.unlinkSync(u.unitFile)}catch{}
 systemctl(['daemon-reload'],{allowFailure:true});
 fs.rmSync(f.root,{recursive:true,force:true});
}
function child(root,at){
 const f={root,workRoot:path.join(root,'journal'),assetRoot:path.join(root,'assets')};
 const plan=planFor(f);
 TX.executeCore(plan,{
  workRoot:f.workRoot,
  postInstall:async()=>true,
  postRollback:async()=>true,
  onRenamed:(key,i)=>{
   if((at==='owners'&&i===1)||(at==='asset'&&key==='asset-0'))
    process.kill(process.pid,'SIGKILL');
  }
 }).then(()=>process.exit(69),()=>process.exit(70));
}
async function run(){
 let scenarios=0;
 let f;
 try{
  f=createFixture();
  let plan=planFor(f);
  startServices(f);
  const committed=await TX.executeCore(plan,{
   workRoot:f.workRoot,postInstall:async()=>restartServices(f),
   postRollback:async()=>restartServices(f)
  });
  assert.equal(committed.status,'COMMITTED');
  status(f,'COMMITTED');
  expectState(f,plan,'candidate',true);
  console.log('HONARTIK217_VM_REAL_SYSTEMD_COMMIT=PASS');
  scenarios++;
 }finally{dispose(f);f=null}
 try{
  f=createFixture();
  let plan=planFor(f);
  startServices(f);
  fs.writeFileSync(f.fault,'1',{mode:0o600});
  await assert.rejects(TX.executeCore(plan,{
   workRoot:f.workRoot,
   postInstall:async()=>restartServices(f),
   postRollback:async()=>{
    fs.unlinkSync(f.fault);
    return restartServices(f);
   }
  }),/postinstall_health/);
  status(f,'ROLLED_BACK');
  expectState(f,plan,'original',false);
  console.log('HONARTIK217_VM_REAL_SYSTEMD_FAILED_RESTART_ROLLBACK=PASS');
  scenarios++;
 }finally{dispose(f);f=null}
 for(const mode of ['owners','asset']){
  try{
   f=createFixture();
   const plan=planFor(f);
   startServices(f);
   const killed=cp.spawnSync(process.execPath,[__filename,'child',f.root,mode],{
    encoding:'utf8',timeout:20000,
    env:process.env
   });
   assert.equal(killed.signal,'SIGKILL',JSON.stringify(killed).slice(0,200));
   const txn=fs.readdirSync(f.workRoot).find(x=>x.startsWith('txn-'));
   assert.ok(txn,'durable recovery transaction');
   const recovered=await TX.recoverAfterCrash({
    workRoot:f.workRoot,transaction:path.join(f.workRoot,txn),
    expectedTargets:plan.steps.map(s=>s.path),
    expectedAssets:plan.assets.map(a=>a.path),
    postRollback:async()=>restartServices(f)
   });
   assert.equal(recovered.status,'ROLLED_BACK');
   status(f,'ROLLED_BACK');
   expectState(f,plan,'original',false);
   console.log('HONARTIK217_VM_REAL_SYSTEMD_SIGKILL_'+mode.toUpperCase()+'_RECOVERY=PASS');
   scenarios++;
  }finally{dispose(f);f=null}
 }
 assert.equal(scenarios,4);
 console.log('HONARTIK217_VM_SYSTEMD_4_SCENARIOS=PASS');
 console.log('FIXTURE_ONLY=YES REAL_PROVIDER_ROOT=NOT_TESTED');
}
if(require.main===module){
 guard();
 if(process.argv.length===5&&process.argv[2]==='child'&&
    path.dirname(process.argv[3])===os.tmpdir()&&
    path.basename(process.argv[3]).startsWith(PREFIX)&&
    ['owners','asset'].includes(process.argv[4]))
  child(process.argv[3],process.argv[4]);
 else if(process.argv.length===2)
  run().catch(e=>{console.error(e.stack||e);process.exitCode=1});
 else fail('arguments_forbidden');
}
