'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createReadBroker}=require('../lib/agent3-read-broker.prototype');
test('rejects symlinked intermediate path and unsupported operation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'broker-gate-'));
 try {
  await fs.mkdir(path.join(root,'allowed'));
  await fs.mkdir(path.join(root,'outside'));
  await fs.writeFile(path.join(root,'outside','secret.txt'),'secret');
  await fs.symlink(path.join(root,'outside'),path.join(root,'allowed','linked'));
  const broker=createReadBroker({demo:{root:path.join(root,'allowed'),allowedActors:['tester']}});
  const req={project_id:'demo',actor_id:'tester',operation:'file.read',relative_path:'linked/secret.txt'};
  await assert.rejects(()=>broker(req));
  await assert.rejects(()=>broker({...req,operation:'file.write',relative_path:'ok.txt'}));
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
test('does not permit prototype to be mistaken for registered production capability',()=>{
 const source=require('node:fs').readFileSync(path.join(__dirname,'../lib/agent3-read-broker.prototype.js'),'utf8');
 assert.match(source,/Development-only/);
 assert.doesNotMatch(source,/child_process|execSync|spawnSync/);
});
