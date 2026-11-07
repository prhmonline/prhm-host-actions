'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {openConfinedRegularFile}=require('../lib/agent3-confined-open');

test('descriptor anchored opener allows regular file but rejects all symlink components',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'fd-confined-'));
 try{
  const base=path.join(tmp,'base');
  await fs.mkdir(base);await fs.mkdir(path.join(base,'inner'));
  await fs.writeFile(path.join(base,'inner','ok.txt'),'safe');
  const fd=await openConfinedRegularFile(base,'inner/ok.txt');
  try{assert.equal(await fd.readFile({encoding:'utf8'}),'safe');}finally{await fd.close();}
  await fs.symlink('inner',path.join(base,'shortcut'));
  await assert.rejects(()=>openConfinedRegularFile(base,'shortcut/ok.txt'));
  await fs.symlink('inner/ok.txt',path.join(base,'link.txt'));
  await assert.rejects(()=>openConfinedRegularFile(base,'link.txt'));
  await fs.symlink(base,path.join(tmp,'base-link'));
  await assert.rejects(()=>openConfinedRegularFile(path.join(tmp,'base-link'),'inner/ok.txt'));
  await assert.rejects(()=>openConfinedRegularFile(base,'../inner/ok.txt'));
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
