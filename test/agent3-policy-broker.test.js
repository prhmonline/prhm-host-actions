'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createPolicyBroker,appendAudit}=require('../lib/agent3-policy-broker.candidate');
test('typed broker enforces trusted identity, exact request schema and per-operation grants',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'agent3-broker-candidate-'));
 try{
  const root=path.join(tmp,'root'),destination=path.join(tmp,'dest'),audit=path.join(tmp,'audit.log');
  await fs.mkdir(root);await fs.mkdir(destination);
  await fs.writeFile(path.join(root,'a.txt'),'content');
  await fs.writeFile(path.join(root,'secret.txt'),'not authorized');
  const key=crypto.randomBytes(32);
  const seen=[];
  const broker=createPolicyBroker({
   registry:{projects:{project1:{root,destination,readPaths:['a.txt'],
    grants:{operator:['file.read','backup.create','backup.verify'],reader:['file.read']},
    profiles:{source:{type:'files',files:['a.txt']}}}}},
   authenticate:async token=>{if(token==='trusted')return 'operator';if(token==='readonly')return 'reader';throw Error('unauthenticated');},
   keyProvider:async()=>key,
   auditSink:async e=>{seen.push(e);await appendAudit(audit,e);}
  });
  const read={project_id:'project1',operation:'file.read',relative_path:'a.txt'};
  assert.equal((await broker.handle(read,'trusted')).content,'content');
  await assert.rejects(broker.handle(read,'anonymous'),/unauthenticated/);
  await assert.rejects(broker.handle({...read,relative_path:'secret.txt'},'trusted'),/broker_denied:file_not_allowlisted/);
  await assert.rejects(broker.handle({...read,command:'cat /etc/shadow'},'trusted'),/broker_denied:request_schema/);
  await assert.rejects(broker.handle({...read,operation:'shell.exec'},'trusted'),/broker_denied:operation/);
  await assert.rejects(broker.handle({...read,operation:'backup.create',profile_id:'source',idempotency_key:'read-only-scope-1234'},'readonly'));
  const made=await broker.handle({project_id:'project1',operation:'backup.create',
      profile_id:'source',idempotency_key:'valid-broker-job-1234'},'trusted');
  assert.equal(made.encrypted_at_rest,true);
  const verified=await broker.handle({project_id:'project1',operation:'backup.verify',job_id:made.job_id},'trusted');
  assert.equal(verified.verified,true);
  assert.ok(seen.some(x=>x.status==='completed'&&x.operation==='backup.create'));
  assert.equal((await fs.stat(audit)).mode&0o077,0);
  assert.ok((await fs.readFile(audit,'utf8')).includes('"status":"completed"'));
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test('production broker cannot start without authenticated identity, key and audit adapters',()=>{
 assert.throws(()=>createPolicyBroker({}),/trusted_adapters_required/);
});
