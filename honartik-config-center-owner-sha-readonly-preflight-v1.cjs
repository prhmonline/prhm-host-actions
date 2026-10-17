'use strict';
/**
 * Fixed, read-only PRHM/Honartik owner candidate SHA preflight.
 *
 * Explicitly NOT a registrar, installer, approval request or deploy. The
 * reviewed caller must pin this script and its registration builder to one
 * immutable Git source commit, and must use an isolated read-only process
 * with access only to the four exact Production owner paths.
 *
 * No dynamic path, shell, network, credentials, writes, or input payload.
 * Success reports only before/after SHA256 and fixed action identifiers.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const registry=require('./honartik-config-center-registration-candidate-v1.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const KEYS=Object.freeze(['base','executor','policy','mcp']);
const PATHS=Object.freeze(Object.fromEntries(KEYS.map(k=>[k,registry.LIVE[k].path])));
function fail(code){throw Error('honartik_owner_sha_preflight_'+code)}
function check(ok,code){if(!ok)fail(code)}
function checkOwnerBytes(bytes,kind){
 const rec=registry.LIVE[kind];
 check(rec&&Buffer.isBuffer(bytes)&&bytes.length>=50&&bytes.length<=3000000&&
   sha(bytes)===rec.sha256,'owner_original_sha_'+kind);
 return bytes;
}
function readPinnedOwner(io,kind){
 check(KEYS.includes(kind),'unknown_owner_key');
 const file=PATHS[kind],parent=path.posix.dirname(file);
 check(io.realpathSync(parent)===parent,'unsafe_parent_'+kind);
 const ps=io.lstatSync(parent);
 check(ps.isDirectory()&&!ps.isSymbolicLink()&&(ps.mode&0o022)===0,
   'unsafe_parent_permissions_'+kind);
 const before=io.lstatSync(file);
 check(before.isFile()&&!before.isSymbolicLink()&&
   io.realpathSync(file)===file&&
   before.size>=50&&before.size<=3000000&&
   (before.mode&0o022)===0,'owner_unsafe_'+kind);
 const fd=io.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let bytes;
 try {
   const observed=io.fstatSync(fd);
   check(observed.isFile()&&observed.ino===before.ino&&
     observed.dev===before.dev&&observed.size===before.size&&
     observed.uid===before.uid&&observed.gid===before.gid,
     'owner_replaced_during_read_'+kind);
   bytes=io.readFileSync(fd);
 } finally {io.closeSync(fd)}
 checkOwnerBytes(bytes,kind);
 check(bytes.length===before.size,'owner_size_changed_'+kind);
 return bytes;
}
function verifyCandidates(candidates){
 check(candidates&&candidates.action===registry.ACTION,'action_changed');
 check(candidates.input_sha256&&candidates.output_sha256&&candidates.sources,
   'candidate_fields_missing');
 const owners={};
 for(const key of KEYS){
   const before=registry.LIVE[key].sha256;
   const output=candidates.sources[key],next=candidates.output_sha256[key];
   check(candidates.input_sha256[key]===before,'generated_input_mismatch_'+key);
   check(typeof output==='string'&&Buffer.byteLength(output)>100&&
     Buffer.byteLength(output)<=3000000&&
     /^[a-f0-9]{64}$/.test(next||'')&&
     sha(Buffer.from(output,'utf8'))===next&&next!==before,
     'generated_after_sha_mismatch_'+key);
   owners[key]=Object.freeze({before_sha256:before,after_sha256:next});
 }
 check(Object.keys(candidates.input_sha256).sort().join('|')===KEYS.slice().sort().join('|')&&
   Object.keys(candidates.output_sha256).sort().join('|')===KEYS.slice().sort().join('|')&&
   Object.keys(candidates.sources).sort().join('|')===KEYS.slice().sort().join('|'),
   'unexpected_owners');
 return Object.freeze({
  schema:'prhm.honartik.owner-sha-preflight.v1',
  action:registry.ACTION,
  production_mutation:false,
  read_only:true,
  live_sha_verified:true,
  published_manifest:false,
  level4_requested:false,
  owners:Object.freeze(owners)
 });
}
function inspect({io=fs}={}){
 // Only four immutable file paths; never accepts a path, command, SHA override
 // or callback from an external request. This is an in-process library, not
 // a network handler or a Host Actions tool.
 const original={};
 for(const key of KEYS)original[PATHS[key]]=readPinnedOwner(io,key);
 const candidates=registry.buildCandidates(file=>{
   check(Object.prototype.hasOwnProperty.call(original,file),
     'builder_unexpected_file');
   return original[file];
 });
 return verifyCandidates(candidates);
}
if(require.main===module){
 // A specially reviewed read-only runner may invoke this with no arguments.
 // No apply, stage, install or write mode exists.
 if(process.argv.length!==2){
   process.stderr.write('HONARTIK_OWNER_SHA_PREFLIGHT_NO_ARGUMENTS_ALLOWED\n');
   process.exitCode=78;
 }else{
   try{process.stdout.write(JSON.stringify(inspect())+'\n');}
   catch(e){
     // Only an error class, never source bytes or any approval material.
     process.stderr.write(String(e?.message||'preflight_failed').slice(0,160)+'\n');
     process.exitCode=1;
   }
 }
}
module.exports=Object.freeze({KEYS,PATHS,checkOwnerBytes,readPinnedOwner,verifyCandidates,inspect});
