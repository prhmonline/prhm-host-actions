'use strict';
// Entirely in-memory synthetic transaction tests: no machine or DB access.
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const i=require('./honartik-config-center-atomic-registration-installer-v1.cjs');
const manifest=require('./honartik-config-center-install-manifest-v1.json');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const request='a9c046a5-7b34-4e6d-ae64-049b2a4dca10';
const sourceCommit='25a79bb466bc885d5435c603e71203bd16d1888a';
const manifestBytes=fs.readFileSync('honartik-config-center-install-manifest-v1.json');
const proof=()=>({
 action:i.ACTION,risk:'critical',level:4,verified_by_trusted_mediator:true,
 one_time_token_consumed:true,second_confirmation_valid:true,
 request_id:request,manifest_sha256:digest(manifestBytes),source_commit_sha:sourceCommit
});
function fakeIO(){
 const map=new Map();let serial=20;
 let renamed=0,renameFaultAt=Infinity,writeFaultAt=Infinity,writes=0;
 const norm=p=>path.posix.normalize(p);
 function ensureDir(p){
  p=norm(p);
  if(map.has(p))return;
  if(p!=='/')ensureDir(path.posix.dirname(p));
  map.set(p,{kind:'directory',buf:null,uid:0,gid:0,mode:0o40700,dev:2,ino:++serial});
 }
 ensureDir('/');
 function setFile(p,bytes,{uid=0,gid=0,mode=0o644}={}){
  p=norm(p);ensureDir(path.posix.dirname(p));
  map.set(p,{kind:'file',buf:Buffer.from(bytes),uid,gid,mode:0o100000|mode,dev:2,ino:++serial});
 }
 function stat(p){
  const x=map.get(norm(p));if(!x){const e=new Error('ENOENT');e.code='ENOENT';throw e}
  return {mode:x.mode,uid:x.uid,gid:x.gid,size:x.buf?.length??0,
    ino:x.ino,dev:x.dev,isFile:()=>x.kind==='file',isDirectory:()=>x.kind==='directory',
    isSymbolicLink:()=>x.kind==='symlink'};
 }
 const io={
  lstatSync:stat,
  realpathSync(p){stat(p);return norm(p)},
  openSync(p){const x=map.get(norm(p));if(!x||x.kind!=='file')throw Error('open_invalid');return {p:norm(p)}},
  fstatSync(fd){return stat(fd.p)},
  readFileSync(p){const x=map.get(norm(typeof p==='string'?p:p.p));if(!x||!x.buf)throw Error('read_invalid');return Buffer.from(x.buf)},
  closeSync(){},
  writeFileSync(p,buf,opt={}){
   const name=norm(p);if(opt.flag==='wx'&&map.has(name))throw Error('EEXIST');
   const parent=map.get(path.posix.dirname(name));if(!parent||parent.kind!=='directory')throw Error('ENOTDIR');
   if(++writes===writeFaultAt)throw Error('synthetic_write_fault');
   setFile(name,Buffer.isBuffer(buf)?buf:Buffer.from(String(buf)),{mode:opt.mode??0o600});
  },
  chownSync(p,uid,gid){const x=map.get(norm(p));if(!x)throw Error('ENOENT');x.uid=uid;x.gid=gid},
  chmodSync(p,mode){const x=map.get(norm(p));if(!x)throw Error('ENOENT');x.mode=(x.mode&0o170000)|mode},
  renameSync(a,b){
   if(!map.has(norm(a)))throw Error('ENOENT');
   const x=map.get(norm(a));map.delete(norm(a));map.set(norm(b),x);
   if(++renamed===renameFaultAt)throw Error('synthetic_after_rename_fault');
  },
  unlinkSync(p){if(!map.delete(norm(p)))throw Error('ENOENT')},
  mkdirSync(p,opt={}){
   const pp=norm(p);if(map.has(pp)){if(!opt.recursive)throw Error('EEXIST');return}
   if(!map.has(path.posix.dirname(pp)))throw Error('ENOENT');
   ensureDir(pp);
  }
 };
 return {io,map,setFile,ensureDir,get renamed(){return renamed},
  failRenameAt(n){renameFaultAt=n},
  failWriteAt(n){writeFaultAt=n}};
}
function fixture(){
 const v=fakeIO();v.ensureDir(i.BACKUP_ROOT);
 const previous=new Map();const changes=[];
 for(const asset of manifest.assets){
  const bytes=Buffer.from('installed asset '+asset.source+' reviewed candidate');
  v.ensureDir(path.posix.dirname(asset.target));
  changes.push({target:asset.target,bytes,expected:digest(bytes),uid:0,gid:0,mode:0o644,before:null});
 }
 for(const [key,pin] of Object.entries(manifest.control_plane_preimages)){
  const beforeBytes=Buffer.from('owner '+key+' exact bytes for synthetic transaction fixture');
  const before={path:pin.path,bytes:beforeBytes,sha256:digest(beforeBytes),uid:key==='mcp'?1000:0,
   gid:key==='mcp'?1000:0,mode:0o640};
  const next=Buffer.from('updated '+key+' output from exact registration builder');
  v.setFile(before.path,before.bytes,{uid:before.uid,gid:before.gid,mode:before.mode});
  changes.push({target:pin.path,bytes:next,expected:digest(next),uid:before.uid,
   gid:before.gid,mode:before.mode,before});
  previous.set(before.path,{before,expected:digest(next)});
 }
 const plan={action:i.ACTION,proofOnly:true,productionMutation:false,changes};
 const restarts=[],healths=[];
 const services={
  restart(service){restarts.push(service)},
  health(service){healths.push(service)}
 };
 return {v,plan,previous,services,restarts,healths};
}
function execute(f,more={}){
 return i.executeAfterTrustedApproval(f.plan,{
  approval:proof(),manifestBytes,sourceSha:sourceCommit,
  io:f.v.io,...f.services,...more
 });
}
function assertRestored(f){
 for(const entry of f.plan.changes){
  const item=f.v.map.get(entry.target);
  if(entry.before){
   assert.ok(item,'existing owner must be restored');
   assert.equal(digest(item.buf),entry.before.sha256,entry.target);
   assert.equal(item.mode&0o777,entry.before.mode,entry.target);
   assert.equal(item.uid,entry.before.uid);
  }else assert.equal(item,undefined,'new asset must be removed after rollback');
 }
}
test('installer has no standalone apply and requires exact Level-4 mediator metadata',()=>{
 const summary=i.selftest();assert.equal(summary.applyAvailable,false);
 for(const bad of [
  {...proof(),level:3},{...proof(),one_time_token_consumed:false},
  {...proof(),second_confirmation_valid:false},
  {...proof(),verified_by_trusted_mediator:false},
  {...proof(),source_commit_sha:'bad'},
  {...proof(),manifest_sha256:'0'.repeat(64)},
  {...proof(),arbitraryPath:'/etc/passwd'},null
 ])assert.throws(()=>i.validateApproval(bad,digest(manifestBytes)));
 assert.equal(i.validateApproval(proof(),digest(manifestBytes)).request_id,request);
});
test('success installs exact 5 assets and 4 owners, preserves ownership and checks services',()=>{
 const f=fixture();
 const result=execute(f);
 assert.equal(result.ok,true);assert.equal(result.installedAssets,5);
 assert.equal(result.updatedOwners,4);assert.equal(result.credentialIssued,false);
 assert.equal(f.restarts.length,4);assert.equal(f.healths.length,4);
 for(const entry of f.plan.changes){
  const x=f.v.map.get(entry.target);
  assert.ok(x);assert.equal(digest(x.buf),entry.expected);
  assert.equal(x.uid,entry.uid);assert.equal(x.mode&0o777,entry.mode);
 }
 for(const key of i.KEYS){
  const file=path.join(i.BACKUP_ROOT,request,key+'.bak');
  assert.ok(f.v.map.has(file));assert.equal(f.v.map.get(file).mode&0o777,0o600);
 }
});
test('already-existing target fails closed before backup and before mutation',()=>{
 const f=fixture();
 f.v.setFile(f.plan.changes[0].target,'foreign pre-existing artifact');
 assert.throws(()=>execute(f),/asset_appeared_before_write/);
 assert.equal(f.v.renamed,0);
 assert.equal(f.v.map.has(path.join(i.BACKUP_ROOT,request)),false);
});
test('renaming first asset then throwing removes it and verifies rollback',()=>{
 const f=fixture();f.v.failRenameAt(1);
 assert.throws(()=>execute(f),/installation_failed_rolled_back/);
 assertRestored(f);
});
test('failure mid-controller update restores all nine file states and restarts services',()=>{
 const f=fixture();f.v.failRenameAt(7);
 assert.throws(()=>execute(f),/installation_failed_rolled_back/);
 assertRestored(f);
 assert.ok(f.restarts.length>=4);
});
test('failing service health after full installation rolls back and rechecks services',()=>{
 const f=fixture();let once=true;
 assert.throws(()=>execute(f,{health(s){if(once){once=false;throw Error('simulated_down')}f.healths.push(s)}}),
  /installation_failed_rolled_back/);
 assertRestored(f);assert.ok(f.restarts.length>=5);
});
test('pre-approval validation failures cause zero filesystem writes',()=>{
 const f=fixture();
 assert.throws(()=>i.executeAfterTrustedApproval(f.plan,{
  approval:{...proof(),second_confirmation_valid:false},
  manifestBytes,sourceSha:sourceCommit,io:f.v.io,...f.services
 }),/trusted_l4_proof_invalid/);
 assert.equal(f.v.renamed,0);
});
test('refuses a forged source root and invalid manifest plan',()=>{
 const f=fixture();
 assert.throws(()=>i.planInstallation({io:f.v.io,sourceRoot:'/tmp'}),/untrusted_stage_root/);
 assert.throws(()=>i.executeAfterTrustedApproval({...f.plan,changes:[f.plan.changes[0]]},{
  approval:proof(),manifestBytes,sourceSha:sourceCommit,io:f.v.io,...f.services
 }),/plan_invalid/);
});
