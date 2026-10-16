'use strict';
/** Independent verification of a prototype backup using isolated extraction.
 * This never restores files into a live source tree.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
function sha(b){return crypto.createHash('sha256').update(b).digest('hex');}
function tar(args){
 return new Promise((resolve,reject)=>{
  const p=spawn('/usr/bin/tar',args,{shell:false,stdio:['ignore','ignore','pipe']});
  let stderr='';
  p.stderr.on('data',b=>{stderr+=b;if(stderr.length>8192)p.kill();});
  p.on('error',reject);p.on('close',code=>code===0?resolve():reject(new Error('archive_invalid')));
 });
}
async function verifyIsolatedRestore(archivePath,manifestPath){
 const manifestBytes=await fs.readFile(manifestPath);
 const markerPath=manifestPath.replace(/\\.manifest\\.json$/,'.complete');
 if(markerPath===manifestPath)throw Error('invalid_manifest_path');
 const marker=(await fs.readFile(markerPath,'utf8')).trim();
 if(!/^[a-f0-9]{64}$/.test(marker)||marker!==sha(manifestBytes))throw Error('completion_marker_mismatch');
 const manifest=JSON.parse(manifestBytes.toString('utf8'));
 if(!manifest || !Array.isArray(manifest.files) || manifest.files.length<1)throw Error('invalid_manifest');
 if(sha(await fs.readFile(archivePath))!==manifest.archive_sha256)throw Error('archive_hash_mismatch');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'backup-verify-'));
 try {
  // No trusted extraction from unvalidated archive: tar member names/types must be checked first.
  const {spawnSync}=require('node:child_process');
  const list=spawnSync('/usr/bin/tar',['-tvzf',archivePath],{encoding:'utf8',maxBuffer:1024*1024});
  if(list.status!==0)throw Error('invalid_archive');
  const names=new Set(manifest.files.map(f=>f.path));
  for(const line of list.stdout.split('\n').filter(Boolean)){
   const match=line.match(/^([\-d])[rwxstST-]{9}\s+\S+\s+\d+\s+\S+\s+\S+\s+(.+)$/);
   if(!match)throw Error('unrecognized_tar_listing');
   const type=match[1], member=match[2].replace(/^\.\//,'').replace(/\/$/,'');
   if(!member && type==='d')continue;
   if(type==='d'){if(![...names].some(n=>n.startsWith(member+'/')))throw Error('unexpected_directory');}
   else if(type!=='-' || !names.has(member))throw Error('unexpected_member');
  }
  await tar(['-xzf',archivePath,'-C',root,'--no-same-owner','--no-same-permissions']);
  const seen=new Set();
  async function walk(dir,prefix=''){
   for(const e of await fs.readdir(dir,{withFileTypes:true})){
    const rel=prefix?prefix+'/'+e.name:e.name;
    if(e.isSymbolicLink() || (!e.isFile()&&!e.isDirectory()))throw Error('unsafe_member');
    if(e.isDirectory())await walk(path.join(dir,e.name),rel);
    else {
     if(!names.has(rel)||seen.has(rel))throw Error('unexpected_member');
     seen.add(rel);
    }
   }
  }
  await walk(root);
  if(seen.size!==manifest.files.length)throw Error('file_count_mismatch');
  for(const entry of manifest.files){
   if(typeof entry.path!=='string'||entry.path.startsWith('/')||entry.path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('unsafe_manifest');
   const data=await fs.readFile(path.join(root,entry.path));
   if(data.length!==entry.bytes||sha(data)!==entry.sha256)throw Error('file_hash_mismatch');
  }
  return {verified:true,file_count:seen.size,archive_sha256:manifest.archive_sha256};
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
module.exports={verifyIsolatedRestore};
