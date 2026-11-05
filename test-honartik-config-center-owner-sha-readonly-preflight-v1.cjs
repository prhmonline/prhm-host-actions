'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const reg=require('./honartik-config-center-registration-candidate-v1.cjs');
const pre=require('./honartik-config-center-owner-sha-readonly-preflight-v1.cjs');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
test('success verifies four real calculated postimage SHA values without publishing or applying',()=>{
 const original={},sources={},input_sha256={},output_sha256={};
 for(const kind of pre.KEYS){
   input_sha256[kind]=reg.LIVE[kind].sha256;
   sources[kind]=('reviewed generated '+kind+' candidate output source\n').repeat(5);
   output_sha256[kind]=digest(Buffer.from(sources[kind]));
   original[kind]=pre.PATHS[kind];
 }
 const report=pre.verifyCandidates({action:reg.ACTION,input_sha256,output_sha256,sources});
 assert.equal(report.schema,'prhm.honartik.owner-sha-preflight.v1');
 assert.equal(report.read_only,true);
 assert.equal(report.production_mutation,false);
 assert.equal(report.published_manifest,false);
 assert.equal(report.level4_requested,false);
 assert.deepEqual(Object.keys(report.owners),pre.KEYS);
 for(const key of pre.KEYS){
   assert.deepEqual(report.owners[key],{
     before_sha256:input_sha256[key],after_sha256:output_sha256[key]
   });
   assert.equal(original[key],reg.LIVE[key].path);
 }
});
test('forged outputs, missing SHA, fake owner or unknown action fail closed',()=>{
 const sources={},input_sha256={},output_sha256={};
 for(const key of pre.KEYS){
   sources[key]=('generated reviewed code '+key+'\n').repeat(7);
   input_sha256[key]=reg.LIVE[key].sha256;
   output_sha256[key]=digest(Buffer.from(sources[key]));
 }
 const good={action:reg.ACTION,sources,input_sha256,output_sha256};
 for(const corrupt of [
  {...good,action:'foreign'},
  {...good,output_sha256:{...output_sha256,mcp:'0'.repeat(64)}},
  {...good,input_sha256:{...input_sha256,policy:'0'.repeat(64)}},
  {...good,sources:{...sources,base:'tampered'}},
  {...good,output_sha256:{base:output_sha256.base}}
 ])assert.throws(()=>pre.verifyCandidates(corrupt),
    /action_changed|generated_after_sha_mismatch|generated_input_mismatch|unexpected_owners/);
});
test('preflight cannot invent valid original bytes; pinned SHA is enforced',()=>{
 for(const k of pre.KEYS){
  assert.throws(()=>pre.checkOwnerBytes(Buffer.alloc(200,42),k),
    new RegExp('owner_original_sha_'+k));
 }
 assert.deepEqual(pre.KEYS,['base','executor','policy','mcp']);
});
test('fixed reader refuses symlink and weak path permissions before source read',()=>{
 let opens=0;
 const fsIo={
  realpathSync:p=>p,
  lstatSync:p=>{
   const isParent=!Object.values(pre.PATHS).includes(p);
   return {
    isDirectory:()=>isParent,
    isSymbolicLink:()=>!isParent,
    isFile:()=>!isParent,
    mode:0o100644,size:200,ino:1,dev:1,uid:0,gid:0
   };
  },
  openSync:()=>{opens++;throw Error('should_not_open')}
 };
 assert.throws(()=>pre.readPinnedOwner(fsIo,'base'),/owner_unsafe_base/);
 assert.equal(opens,0);
 const io2={...fsIo,lstatSync:p=>{
  const target=Object.values(pre.PATHS).includes(p);
  return {
    isDirectory:()=>!target,isSymbolicLink:()=>false,
    isFile:()=>target,
    mode:target?0o100666:0o40755,size:200,
    ino:1,dev:1,uid:0,gid:0
  };
 }};
 assert.throws(()=>pre.readPinnedOwner(io2,'base'),/owner_unsafe_base/);
 assert.equal(opens,0);
});
test('reader detects stat/fstat race without consuming swapped bytes',()=>{
 let reads=0;
 const io={
  realpathSync:p=>p,
  lstatSync:p=>({
    isDirectory:()=>!Object.values(pre.PATHS).includes(p),
    isSymbolicLink:()=>false,
    isFile:()=>Object.values(pre.PATHS).includes(p),
    mode:0o100644,size:200,ino:1,dev:1,uid:0,gid:0
  }),
  openSync:()=>23,
  fstatSync:()=>({
    isFile:()=>true,size:200,ino:2,dev:1,uid:0,gid:0
  }),
  readFileSync:()=>{reads++;return Buffer.alloc(200,42)},
  closeSync:()=>{}
 };
 assert.throws(()=>pre.readPinnedOwner(io,'base'),/owner_replaced_during_read_base/);
 assert.equal(reads,0);
});
test('all externally supplied paths rejected and no side-effect interface exported',()=>{
 assert.throws(()=>pre.readPinnedOwner({},'foreign'),/unknown_owner_key/);
 for(const name of ['install','deploy','apply','spawn','write','approve','consume'])
   assert.equal(Object.prototype.hasOwnProperty.call(pre,name),false);
});
