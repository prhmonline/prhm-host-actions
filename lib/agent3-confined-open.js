'use strict';
/**
 * Linux-only, read-only descriptor-anchored path traversal for Agent 3 prototypes.
 * Each component is opened beneath the already-open parent directory descriptor.
 * This closes the lstat(path) -> open(path) symlink swap gap.
 * Not a substitute for kernel openat2(RESOLVE_BENEATH/NO_SYMLINKS), mount isolation,
 * authenticated actor identity or a production security review.
 */
const fsp=require('node:fs/promises');
const fs=require('node:fs');
const path=require('node:path');
const D=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC;
const F=fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK|fs.constants.O_CLOEXEC;
function parts(input,absolute){
 if(typeof input!=='string'||input.length>4096||
    (absolute?!path.isAbsolute(input):path.isAbsolute(input)))throw Error('unsafe_path');
 const value=absolute?input.slice(1):input;
 const items=value.split('/');
 if(absolute && input==='/')return [];
 if(items.some(x=>!x||x==='.'||x==='..'||x.length>255||
    x.includes('\\')||/[\x00-\x1f\x7f]/.test(x)))throw Error('unsafe_path');
 return items;
}
async function enter(dir,component){
 const child=await fsp.open('/proc/self/fd/'+dir.fd+'/'+component,D);
 await dir.close();
 return child;
}
async function openConfinedRegularFile(root,relative){
 if(process.platform!=='linux')throw Error('unsupported_platform');
 const base=parts(root,true),segments=parts(relative,false);
 if(!segments.length)throw Error('unsafe_path');
 let dir=await fsp.open('/',D);
 try{
  for(const component of [...base,...segments.slice(0,-1)]){
   dir=await enter(dir,component);
  }
  const handle=await fsp.open('/proc/self/fd/'+dir.fd+'/'+segments.at(-1),F);
  try{
   if(!(await handle.stat()).isFile())throw Error('not_regular_file');
   return handle;
  }catch(e){await handle.close();throw e;}
 }finally{await dir.close();}
}
module.exports={openConfinedRegularFile};
