'use strict';
// Development-only typed read broker. No shell, write, network or production registration.
const fs = require('node:fs/promises');
const path = require('node:path');
const {openConfinedRegularFile} = require('./agent3-confined-open');
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const PART = /^[A-Za-z0-9._-]{1,128}$/;
function denied() { const e=new Error('access_denied');e.code='ACCESS_DENIED';throw e; }
function validateRelative(relative) {
 if(typeof relative!=='string'||relative.length>512||relative.startsWith('/')||relative.includes('\\')||relative.includes('\0')) denied();
 const parts=relative.split('/');
 if(parts.some(p=>!PART.test(p)||p==='.'||p==='..')) denied();
 return parts;
}
function createReadBroker(registry) {
 if(!registry||typeof registry!=='object'||Array.isArray(registry)) denied();
 return async function read(request) {
  if(!request||!ID.test(request.project_id||'')||request.operation!=='file.read'||!ID.test(request.actor_id||'')) denied();
  if(Object.keys(request).some(k=>!['project_id','actor_id','operation','relative_path'].includes(k))) denied();
  const cfg=Object.getOwnPropertyDescriptor(registry,request.project_id);
  if(!cfg||!('value'in cfg)||!cfg.value||!Array.isArray(cfg.value.allowedActors)||!cfg.value.allowedActors.includes(request.actor_id)) denied();
  const parts=validateRelative(request.relative_path);
  const handle=await openConfinedRegularFile(cfg.value.root,request.relative_path);
  try {
   const st=await handle.stat();
   if(!st.isFile()||st.size>65536||st.size<0) denied();
   const data=Buffer.alloc(st.size);
   const {bytesRead}=await handle.read(data,0,st.size,0);
   if(bytesRead!==st.size) denied();
   return {project_id:request.project_id,operation:'file.read',relative_path:request.relative_path,content:data.toString('utf8'),bytes:st.size};
  } finally {await handle.close();}
 };
}
module.exports={createReadBroker};
