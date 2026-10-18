'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=require('node:fs/promises');
const crypto=require('node:crypto'),os=require('node:os'),path=require('node:path');
const cp=require('node:child_process');
const m=require('../ops/agent3-universal-backup/four-owner-readonly-preflight.cjs');

test('bounded owner digest reads real bytes with no content disclosure',async()=>{
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'agent3-owner-hashes-'));
 try{
  const name=path.join(dir,'owner.js');
  const secret=Buffer.from('SENSITIVE-NOT-IN-PREFLIGHT-RESPONSE');
  await fsp.writeFile(name,secret,{mode:0o600});
  const got=m.readHashStrict(name);
  assert.equal(got.sha256,crypto.createHash('sha256').update(secret).digest('hex'));
  assert.equal(got.size,secret.length);
  assert.equal(got.path,name);
  assert.ok(!JSON.stringify(got).includes(secret.toString()));
  const link=path.join(dir,'symlink.js');
  await fsp.symlink(name,link);
  assert.throws(()=>m.readHashStrict(link),/unsafe_owner_file/);
  await fsp.chmod(name,0o666);
  assert.throws(()=>m.readHashStrict(name),/unsafe_owner_file/);
 }finally{await fsp.rm(dir,{recursive:true,force:true});}
});
test('collector requires four exactly keyed healthy service and owner attestations',()=>{
 let counter=0;
 const reader=file=>({path:file,sha256:crypto.createHash('sha256').update(file).digest('hex'),size:100,uid:0,gid:0,mode:'0600'});
 const probe=unit=>({unit,loaded:true,active:true,running:true});
 const out=m.collect({reader,serviceReader:probe});
 assert.equal(out.owner_count,4);assert.equal(out.service_count,4);
 assert.equal(out.mode,'READ_ONLY_PREFLIGHT');
 assert.equal(out.cryptographically_signed,false);
 assert.equal(out.enrollment_authorized,false);
 assert.equal(out.production_mutation,false);
 assert.equal(out.installation_complete,false);
 assert.deepEqual(Object.keys(out.owners),['base','executor','policy','mcp']);
 assert.throws(()=>m.collect({reader,serviceReader:unit=>({...probe(unit),running:false})}),/unhealthy/);
 assert.throws(()=>m.collect({reader:file=>({...reader(file),sha256:'X'}),serviceReader:probe}),/incomplete_owner_evidence/);
});
test('only four exact systemctl show units can be probed without arbitrary commands',()=>{
 const args=[];
 const execute=(bin,argv)=>{
  args.push({bin,argv});
  return 'LoadState=loaded\nActiveState=active\nSubState=running\n';
 };
 for(const unit of m.SERVICES)assert.equal(m.readService(unit,execute).active,true);
 assert.equal(args.length,4);
 assert.ok(args.every(x=>x.bin==='/usr/bin/systemctl'&&x.argv[0]==='show'&&x.argv[2]==='--property=LoadState,ActiveState,SubState'));
 assert.throws(()=>m.readService('ssh.service',execute),/service_not_allowlisted/);
 assert.throws(()=>m.readService(m.SERVICES[0],()=> 'LoadState=loaded\nActiveState=inactive\nSubState=dead\n'),/service_not_healthy/);
});
test('CLI never has an apply mode and does not need privileged production state for contract check',()=>{
 const runner=cp.spawnSync(process.execPath,[require.resolve('../ops/agent3-universal-backup/four-owner-readonly-preflight.cjs'),'--apply'],
   {encoding:'utf8',timeout:10000});
 assert.equal(runner.status,64);
 assert.match(runner.stderr,/read-only --check only/);
});
