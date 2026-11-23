'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createReadBroker}=require('../lib/agent3-read-broker.prototype');
test('enforces actor, traversal, symlink and 64KiB boundaries',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'agent3-boundary-'));
 try{
  await fs.writeFile(path.join(dir,'ok.txt'),'hello');
  await fs.writeFile(path.join(dir,'large.txt'),Buffer.alloc(65537));
  await fs.symlink(path.join(dir,'ok.txt'),path.join(dir,'link.txt'));
  const read=createReadBroker({demo:{root:dir,allowedActors:['tester']}});
  const base={project_id:'demo',actor_id:'tester',operation:'file.read',relative_path:'ok.txt'};
  assert.equal((await read(base)).content,'hello');
  for(const change of [
   {actor_id:'stranger'}, {relative_path:'../ok.txt'},
   {relative_path:'link.txt'}, {relative_path:'large.txt'},
   {relative_path:'/etc/passwd'}, {relative_path:'a\\b'},
   {operation:'file.write'}, {unexpected:true}
  ]) await assert.rejects(()=>read({...base,...change}));
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
