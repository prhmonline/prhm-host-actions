'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const tx=require('./drtarjomeh-incident47-signed-registration-transaction-v1.js');
const reg=require('./drtarjomeh-incident47-runtime-registration-v1.js');
const pins=require('./drtarjomeh-incident47-l4-registration-candidate-v1.js');
const moduleFile=path.join(__dirname,'drtarjomeh-incident47-production-registration-adapter-v1.js');
function testHarness(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'i47-io-review-'));
  const tracked=new Set(Object.values(tx.TARGETS));
  const dirs=new Set(['/var/backups','/var/lib/prhm-agent-selfmaint-exec']);
  const map=p=>{
    if(typeof p!=='string')return p;
    if(p.startsWith('/opt/')||p.startsWith('/var/')||p.startsWith('/home/agent/'))return root+p;
    return p;
  };
  for(const dir of dirs)fs.mkdirSync(map(dir),{recursive:true,mode:0o755});
  for(const target of tracked)fs.mkdirSync(path.dirname(map(target)),{recursive:true});
  const old={
    base:Buffer.from("'use strict';const base=true;\n"),
    executor:Buffer.from("'use strict';const executor=true;\n"),
    policy:Buffer.from(JSON.stringify({version:'test',operations:{},typed_scopes:[]})+'\n'),
    mcp:Buffer.from("'use strict';const mcp=true;\n"),
  };
  const newbytes={
    base:Buffer.from("'use strict';const base='hardened';\n"),
    executor:Buffer.from("'use strict';const executor='hardened';\n"),
    policy:Buffer.from(JSON.stringify({operations:{
      [pins.OPERATION]:{level:4}},typed_scopes:[
        {action:reg.ACTION,operation:pins.OPERATION}]})+'\n'),
    mcp:Buffer.from("'use strict';const mcp='hardened';\n"),
    runner:fs.readFileSync(path.join(__dirname,'drtarjomeh-incident47-reviewed-host-runner-v1.js'))
  };
  for(const kind of ['base','executor','policy','mcp'])
    fs.writeFileSync(map(tx.TARGETS[kind]),old[kind],{mode:0o644});
  const methods=new Set(['lstatSync','statSync','readFileSync','openSync','chmodSync',
    'renameSync','unlinkSync','mkdirSync','realpathSync','copyFileSync','accessSync']);
  const fsMock=new Proxy(fs,{get(target,key){
    if(key==='chownSync')return ()=>{};
    if(!methods.has(key))return Reflect.get(target,key);
    const fn=target[key];
    return (...args)=>{
      if(key==='renameSync'||key==='copyFileSync')return fn.call(target,map(args[0]),map(args[1]),...args.slice(2));
      args[0]=map(args[0]);return fn.apply(target,args);
    };
  }});
  const commands=[];
  const cpMock={spawnSync:(bin,args)=>{
    commands.push([bin,...args]);
    return {status:0,stdout:args[0]==='is-active'?'active\n':'',stderr:''};
  }};
  const src=fs.readFileSync(moduleFile,'utf8');
  const mod={exports:{}};
  const requireMock=p=>{
    if(p==='node:fs')return fsMock;
    if(p==='node:child_process')return cpMock;
    if(p==='node:path')return path;
    if(p==='node:crypto')return crypto;
    if(p==='./drtarjomeh-incident47-runtime-registration-v1.js')return reg;
    if(p==='./drtarjomeh-incident47-signed-registration-transaction-v1.js')return tx;
    if(p==='./drtarjomeh-incident47-l4-registration-candidate-v1.js')return pins;
    throw Error('unapproved_fixture_import:'+p);
  };
  vm.runInNewContext(src,{require:requireMock,module:mod,__dirname,Buffer,process:{
    pid:process.pid,getuid:()=>0,exitCode:0,stderr:{write:()=>{}}
  }},{timeout:5000});
  const adapter=mod.exports.createProductionAdapter();
  const steps=Object.entries(newbytes).map(([kind,bytes])=>{
    const stat=adapter.targetState(tx.TARGETS[kind]);
    const sha=crypto.createHash('sha256').update(bytes).digest('hex');
    return {kind,path:tx.TARGETS[kind],bytes,before_sha256:stat.exists?stat.sha256:null,
      after_sha256:sha,mode:kind==='runner'?0o700:0o644,
      uid:stat.exists?stat.uid:process.getuid(),gid:stat.exists?stat.gid:process.getgid()};
  });
  return {root,map,old,steps,commands,adapter,api:mod.exports,
    dispose:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('production adapter exports fixed paths but NO root apply CLI',()=>{
  const s=fs.readFileSync(moduleFile,'utf8');
  assert.match(s,/signed Level-4 bootstrap only/);
  const c=spawnSync(process.execPath,[moduleFile,'--install'],{encoding:'utf8'});
  assert.equal(c.status,64,c.stderr);
  assert.deepEqual(Object.keys(tx.TARGETS).sort(),['base','executor','mcp','policy','runner'].sort());
});
test('full local synthetic IO: snapshot, backup-before-write, 5 exact targets, verify and health',async()=>{
  const t=testHarness();
  try{
    const release=await t.adapter.lock(reg.ACTION);
    const copies=await t.adapter.snapshot(t.steps);
    assert.equal(copies.length,5);
    await t.adapter.backup(copies);
    for(const step of t.steps){
      await t.adapter.writeExact(step);
      await t.adapter.verify(step);
    }
    await t.adapter.reloadAndHealth('candidate');
    const receipt=await t.adapter.record({action:reg.ACTION,ok:true,rollback_performed:false});
    assert.equal(receipt.authorization_attested_by_transaction,false);
    assert.equal(receipt.app_sha,pins.SOURCE_COMMIT);
    assert.ok(t.commands.some(x=>x.includes('prhm-company-approval.service')));
    const backup=fs.readdirSync(t.map(t.api.BACKUPS));
    assert.equal(backup.length,1);
    assert.ok(fs.existsSync(path.join(t.map(t.api.BACKUPS),backup[0],'manifest.json')));
    await release();
    assert.equal(fs.existsSync(t.map(t.api.LOCK)),false);
  }finally{t.dispose();}
});
test('partial install can recover all modified owner preimages and remove reviewed runner',async()=>{
  const t=testHarness();
  try{
    const unlock=await t.adapter.lock(reg.ACTION);
    await t.adapter.backup(await t.adapter.snapshot(t.steps));
    for(const step of t.steps.slice(0,2))await t.adapter.writeExact(step);
    for(const step of t.steps.slice(0,2).reverse())
      await t.adapter.restore(step.path,step.kind);
    await t.adapter.reloadAndHealth('baseline');
    await unlock();
    for(const kind of ['base','executor'])
      assert.deepEqual(fs.readFileSync(t.map(tx.TARGETS[kind])),t.old[kind]);
    assert.equal(fs.existsSync(t.map(tx.TARGETS.runner)),false);
  }finally{t.dispose()}
});
test('rollback never overwrites an unknown concurrent target mutation',async()=>{
  const t=testHarness();
  try{
    const unlock=await t.adapter.lock(reg.ACTION);
    await t.adapter.backup(await t.adapter.snapshot(t.steps));
    await t.adapter.writeExact(t.steps[0]);
    fs.writeFileSync(t.map(tx.TARGETS.base),'third-party-change');
    await assert.rejects(t.adapter.restore(tx.TARGETS.base,'base'),
      /rollback_refused_unreviewed_mutation/);
    await unlock();
  }finally{t.dispose()}
});
test('unregistered paths and arbitrary shell are rejected',()=>{
  const t=testHarness();
  try{
    assert.throws(()=>t.api._reviewTest.checkPath('/etc/shadow'),/not_in_fixed_allowlist/);
    assert.throws(()=>t.api._reviewTest.commands('/bin/bash',['-c','id']),/unreviewed_command/);
    assert.throws(()=>t.api._reviewTest.commands('/usr/bin/systemctl',
      ['restart','ssh.service']),/unreviewed_command/);
    assert.deepEqual(t.commands,[]);
  }finally{t.dispose()}
});
