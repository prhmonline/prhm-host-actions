'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createReadBroker}=require('../lib/agent3-read-broker.prototype');
test('approved file read and deny unknown actor, project, traversal, symlink, oversize',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'agent3-broker-'));
 try {
  await fs.mkdir(path.join(root,'approved'));
  await fs.writeFile(path.join(root,'approved','ok.txt'),'safe');
  await fs.writeFile(path.join(root,'approved','large.txt'),'x'.repeat(65537));
  await fs.symlink('/etc/passwd',path.join(root,'approved','link.txt'));
  const broker=createReadBroker({demo:{root:path.join(root,'approved'),allowedActors:['tester']}});
  const req={project_id:'demo',actor_id:'tester',operation:'file.read',relative_path:'ok.txt'};
  assert.equal((await broker(req)).content,'safe');
  for(const override of [{actor_id:'other'},{project_id:'missing'},{relative_path:'../ok.txt'},{relative_path:'/etc/passwd'},{relative_path:'link.txt'},{relative_path:'large.txt'},{operation:'file.write'},{command:'cat /etc/passwd'}]) {
   await assert.rejects(()=>broker({...req,...override}));
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
