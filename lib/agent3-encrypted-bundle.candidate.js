'use strict';
/**
 * Agent3 encrypted file backup candidate. FILES ONLY. Not a live Agent tool.
 * No raw shell, SQL, network, delete, production restore or broad path inputs.
 * Caller must pass an already registered plan and a 32-byte key from a protected
 * service credential (never an API argument), under a confined service account.
 * Complete backups are single nonempty directories, published by rename().
 */
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {openConfinedRegularFile}=require('./agent3-confined-open');

const ID=/^[a-f0-9]{64}$/;
const HASH=/^[a-f0-9]{64}$/;
const NAME=/^[a-z][a-z0-9_-]{0,63}$/;
const MAX_FILES=1000, MAX_FILE=512*1024*1024, MAX_TOTAL=2*1024*1024*1024;
function deny(why){throw new Error('encrypted_backup_denied:'+why);}
function digest(b){return crypto.createHash('sha256').update(b).digest('hex');}
function validKey(k){if(!Buffer.isBuffer(k)||k.length!==32)deny('key_required');return k;}
function idFile(name){
 if(typeof name!=='string'||name.length>1024||name.startsWith('/')||
    name.includes('\\')||/[\x00-\x1f\x7f]/.test(name)||
    name.split('/').some(x=>!x||x==='.'||x==='..'))deny('unsafe_filename');
 return name;
}
function validatePlan(plan){
 if(!plan||plan.type!=='files'||plan.status!=='planned_not_executed'||
    !ID.test(plan.job_id||'')||!NAME.test(plan.project_id||'')||
    !NAME.test(plan.profile_id||'')||!Array.isArray(plan.files)||
    plan.files.length===0||plan.files.length>MAX_FILES)deny('invalid_plan');
 const names=plan.files.map(idFile);
 if(new Set(names).size!==names.length)deny('duplicate');
 if(typeof plan.source_root!=='string'||typeof plan.destination_root!=='string'||
    !path.isAbsolute(plan.source_root)||!path.isAbsolute(plan.destination_root))deny('roots');
 return names;
}
function derive(master,salt,label){
 return Buffer.from(crypto.hkdfSync('sha256',master,salt,Buffer.from('agent3-backup-v1:'+label),32));
}
function aad(plan,label){return Buffer.from(['agent3-v1',plan.job_id,plan.project_id,plan.profile_id,label].join('\0'));}
async function syncDir(dir){
 const h=await fsp.open(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{await h.sync();}finally{await h.close();}
}
async function putJson(dir,name,data){
 const h=await fsp.open(path.join(dir,name),'wx',0o600);
 try{await h.writeFile(JSON.stringify(data)+'\n');await h.sync();}finally{await h.close();}
}
function safeHeader(h,job){
 if(!h||h.version!==1||h.algorithm!=='aes-256-gcm-hkdf-sha256'||
    h.job_id!==job||!NAME.test(h.project_id||'')||!NAME.test(h.profile_id||'')||
    !/^[a-f0-9]{32}$/.test(h.salt||'')||
    !Number.isInteger(h.file_count)||h.file_count<1||h.file_count>MAX_FILES||
    !Array.isArray(h.items)||h.items.length!==h.file_count)deny('invalid_header');
 const labels=new Set();
 for(const i of [...h.items,h.manifest]){
   if(!i||typeof i.label!=='string'||!/^(file:[0-9]{4}|manifest)$/.test(i.label)||
      labels.has(i.label)||!/^[a-f0-9]{24}$/.test(i.iv||'')||
      !/^[a-f0-9]{32}$/.test(i.tag||'')||!HASH.test(i.cipher_sha256||'')||
      !Number.isSafeInteger(i.cipher_bytes)||i.cipher_bytes<0||
      i.cipher_bytes>MAX_TOTAL+65536)deny('invalid_header_item');
   labels.add(i.label);
 }
 if(!labels.has('manifest')||h.items.some((x,i)=>x.label!=='file:'+String(i).padStart(4,'0')))deny('invalid_item_order');
}
async function encryptBuffer(buffer,out,master,salt,plan,label){
 const iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv('aes-256-gcm',derive(master,salt,label),iv);
 cipher.setAAD(aad(plan,label));
 const ciphertext=Buffer.concat([cipher.update(buffer),cipher.final()]);
 const h=await fsp.open(out,'wx',0o600);
 try{await h.writeFile(ciphertext);await h.sync();}finally{await h.close();}
 return {label,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),
         cipher_sha256:digest(ciphertext),cipher_bytes:ciphertext.length};
}
/** Caller must supply key obtained from the root-managed systemd credential directory. */
async function createEncryptedBundle(plan,key){
 const files=validatePlan(plan);validKey(key);
 const root=await fsp.realpath(plan.source_root),destination=await fsp.realpath(plan.destination_root);
 if(root===destination||root.startsWith(destination+path.sep)||destination.startsWith(root+path.sep))deny('overlap');
 const dstStat=await fsp.lstat(destination);
 if(dstStat.isSymbolicLink()||!dstStat.isDirectory())deny('destination');
 const bundle=path.join(destination,plan.job_id),lock=path.join(destination,'.'+plan.job_id+'.lock');
 // Per-destination cross-process concurrency = 1; stale crash locks fail closed.
 const globalLock=path.join(destination,'.agent3-destination.lock');
 const globalHandle=await fsp.open(globalLock,'wx',0o600);
 let lh,stage;
 try{
   lh=await fsp.open(lock,'wx',0o600);
   const completed=(await fsp.readdir(destination)).filter(n=>ID.test(n)).length;
   if(completed>=30)deny('retention_capacity_reached');
   let estimated=0;
   for(const file of files){
     const h=await openConfinedRegularFile(root,file);
     try{const st=await h.stat();
       if(!st.isFile()||st.size<0||st.size>MAX_FILE)deny('file_size');
       estimated+=st.size;
       if(estimated>MAX_TOTAL)deny('job_size');
     }finally{await h.close();}
   }
   const disk=await fsp.statfs(destination);
   const available=BigInt(disk.bavail)*BigInt(disk.bsize);
   if(available<BigInt(estimated)+512n*1024n*1024n)deny('insufficient_disk_space');
   try{await fsp.lstat(bundle);deny('already_published');}
   catch(e){if(e.code!=='ENOENT')throw e;}
   stage=await fsp.mkdtemp(path.join(destination,'.agent3-stage-'));
   await fsp.chmod(stage,0o700);
   const salt=crypto.randomBytes(16),items=[],manifestFiles=[];
   let total=0;
   for(let i=0;i<files.length;i++){
     const name=files[i],label='file:'+String(i).padStart(4,'0');
     const handle=await openConfinedRegularFile(root,name);
     try{
       const st=await handle.stat();
       if(!st.isFile()||st.size<0||st.size>MAX_FILE)deny('file_size');
       total+=st.size;
       if(total>MAX_TOTAL)deny('job_size');
       const iv=crypto.randomBytes(12);
       const cipher=crypto.createCipheriv('aes-256-gcm',derive(key,salt,label),iv);
       cipher.setAAD(aad(plan,label));
       let n=0,m=0;
       const plainHash=crypto.createHash('sha256'),cipherHash=crypto.createHash('sha256');
       const meter=new Transform({transform(chunk,encoding,done){
         n+=chunk.length;if(n>st.size)return done(Error('source_changed'));
         plainHash.update(chunk);done(null,chunk);
       }});
       const cipherMeter=new Transform({transform(chunk,encoding,done){
         m+=chunk.length;cipherHash.update(chunk);done(null,chunk);
       }});
       const target=path.join(stage,label+'.enc');
       await pipeline(handle.createReadStream({autoClose:false}),meter,cipher,cipherMeter,
         fs.createWriteStream(target,{flags:'wx',mode:0o600}));
       const after=await handle.stat();
       if(n!==st.size||after.size!==st.size||after.ino!==st.ino||after.dev!==st.dev||
          after.ctimeMs!==st.ctimeMs||after.mtimeMs!==st.mtimeMs)deny('source_changed');
       const fp=await fsp.open(target,'r');try{await fp.sync();}finally{await fp.close();}
       items.push({label,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),
         cipher_sha256:cipherHash.digest('hex'),cipher_bytes:m});
       manifestFiles.push({path:name,label,bytes:n,sha256:plainHash.digest('hex')});
     }finally{await handle.close();}
   }
   // Re-read all registered source files before publishing the sealed bundle.
   // This detects drift across sequential copies, though filesystem snapshots
   // are still required for a strictly point-in-time multi-file guarantee.
   for(const recorded of manifestFiles){
     const h=await openConfinedRegularFile(root,recorded.path);
     try{
       const st=await h.stat();
       if(!st.isFile()||st.size!==recorded.bytes)deny('source_drift');
       const hash=crypto.createHash('sha256');
       let count=0;
       for await(const chunk of h.createReadStream({autoClose:false})){
         count+=chunk.length;if(count>recorded.bytes)deny('source_drift');
         hash.update(chunk);
       }
       if(count!==recorded.bytes||hash.digest('hex')!==recorded.sha256)deny('source_drift');
     }finally{await h.close();}
   }
   const manifest=Buffer.from(JSON.stringify({schema:'agent3.encrypted-backup.v1',job_id:plan.job_id,
     project_id:plan.project_id,profile_id:plan.profile_id,file_count:files.length,files:manifestFiles,
     created_at:new Date().toISOString()})+'\n');
   const meta=await encryptBuffer(manifest,path.join(stage,'manifest.enc'),key,salt,plan,'manifest');
   const header={version:1,algorithm:'aes-256-gcm-hkdf-sha256',job_id:plan.job_id,
     project_id:plan.project_id,profile_id:plan.profile_id,file_count:files.length,
     salt:salt.toString('hex'),items,manifest:meta};
   safeHeader(header,plan.job_id);
   await putJson(stage,'header.json',header);
   await syncDir(stage);
   // An *entire non-empty directory* becomes visible at once; no per-file marker.
   await fsp.rename(stage,bundle);
   stage=undefined;
   await syncDir(destination);
   return {job_id:plan.job_id,bundle_path:bundle,encrypted_at_rest:true,atomic_namespace_commit:true,
      file_count:files.length,verified_restore:false};
 }finally{
   try{if(stage)await fsp.rm(stage,{recursive:true,force:true});}
   finally{
     try{if(lh){await lh.close();await fsp.unlink(lock);}}
     finally{await globalHandle.close();await fsp.unlink(globalLock);}
   }
 }
}
async function readBounded(file,max){
 const h=await fsp.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
   const st=await h.stat();
   if(!st.isFile()||st.size>max||st.size<0)deny('metadata_bounds');
   const b=await h.readFile();
   if(b.length!==st.size)deny('metadata_changed');
   return b;
 }finally{await h.close();}
}
async function decryptItem(bundle,meta,master,salt,plan,callback){
 const filename=meta.label+'.enc',file=path.join(bundle,filename);
 const h=await fsp.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const st=await h.stat();
  if(!st.isFile()||st.size!==meta.cipher_bytes)deny('cipher_size');
  const digestCipher=crypto.createHash('sha256');
  const decipher=crypto.createDecipheriv('aes-256-gcm',derive(master,salt,meta.label),Buffer.from(meta.iv,'hex'));
  decipher.setAAD(aad(plan,meta.label));decipher.setAuthTag(Buffer.from(meta.tag,'hex'));
  const checkCipher=new Transform({transform(b,encoding,done){digestCipher.update(b);done(null,b);}});
  const sink=new Transform({transform(b,encoding,done){callback(b);done();}});
  await pipeline(h.createReadStream({autoClose:false}),checkCipher,decipher,sink);
  if(digestCipher.digest('hex')!==meta.cipher_sha256)deny('cipher_hash');
 }catch(e){deny('decrypt_failed');}finally{await h.close();}
}
async function verifyEncryptedBundle(bundle,key,{restoreRoot}={}){
 validKey(key);
 const full=await fsp.realpath(bundle);
 const id=path.basename(full);
 if(!ID.test(id))deny('bundle_id');
 const headerBytes=await readBounded(path.join(full,'header.json'),256*1024);
 let header;try{header=JSON.parse(headerBytes.toString('utf8'));}catch{deny('header_json');}
 safeHeader(header,id);
 const plan={job_id:id,project_id:header.project_id,profile_id:header.profile_id},
       salt=Buffer.from(header.salt,'hex');
 const expected=new Map(header.items.map(x=>[x.label,x]));
 const names=(await fsp.readdir(full)).sort(),wanted=['header.json','manifest.enc',...header.items.map(x=>x.label+'.enc')].sort();
 if(JSON.stringify(names)!==JSON.stringify(wanted))deny('unexpected_artifacts');
 let raw=[];
 await decryptItem(full,header.manifest,key,salt,plan,b=>raw.push(b));
 if(raw.reduce((n,b)=>n+b.length,0)>1024*1024)deny('manifest_size');
 let manifest;try{manifest=JSON.parse(Buffer.concat(raw).toString('utf8'));}catch{deny('manifest_json');}
 raw=[];
 if(manifest?.schema!=='agent3.encrypted-backup.v1'||manifest.job_id!==id||
    manifest.project_id!==plan.project_id||manifest.profile_id!==plan.profile_id||
    manifest.file_count!==header.file_count||!Array.isArray(manifest.files)||
    manifest.files.length!==header.file_count)deny('manifest_mismatch');
 let total=0;
 const seen=new Set(),records=[];
 if(restoreRoot!==undefined){
   const st=await fsp.lstat(restoreRoot);
   if(!st.isDirectory()||st.isSymbolicLink()||(await fsp.readdir(restoreRoot)).length!==0)deny('restore_root_not_empty');
 }
 for(let i=0;i<manifest.files.length;i++){
   const f=manifest.files[i],meta=header.items[i];
   idFile(f.path);
   if(seen.has(f.path)||f.label!==meta.label||!Number.isSafeInteger(f.bytes)||f.bytes<0||
      f.bytes>MAX_FILE||!HASH.test(f.sha256||''))deny('manifest_file');
   seen.add(f.path);total+=f.bytes;
   if(total>MAX_TOTAL)deny('total_size');
   const hash=crypto.createHash('sha256');
   let bytes=0, fd=null;
   if(restoreRoot!==undefined){
     const target=path.join(restoreRoot,f.path);
     await fsp.mkdir(path.dirname(target),{recursive:true,mode:0o700});
     fd=await fsp.open(target,'wx',0o600);
   }
   try{
     await decryptItem(full,meta,key,salt,plan,b=>{
       bytes+=b.length;if(bytes>f.bytes)deny('oversized_plaintext');
       hash.update(b);
       if(fd)fs.writeSync(fd.fd,b);
     });
     if(fd)await fd.sync();
   }finally{if(fd)await fd.close();}
   if(bytes!==f.bytes||hash.digest('hex')!==f.sha256)deny('file_mismatch');
   records.push({path:f.path,sha256:f.sha256,bytes:f.bytes});
 }
 return {verified:true,encrypted:true,atomic_namespace_commit:true,
   restored_to_isolated_directory:restoreRoot!==undefined,file_count:records.length,files:records};
}
function readSystemdCredential(){
 const dir=process.env.CREDENTIALS_DIRECTORY;
 if(!dir||!path.isAbsolute(dir))deny('systemd_credential_required');
 const keyPath=path.join(dir,'prhm-backup.key');
 const st=fs.lstatSync(keyPath);
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||st.size!==32)deny('credential_permissions');
 const fd=fs.openSync(keyPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{return validKey(fs.readFileSync(fd));}finally{fs.closeSync(fd);}
}
module.exports={createEncryptedBundle,verifyEncryptedBundle,readSystemdCredential};
