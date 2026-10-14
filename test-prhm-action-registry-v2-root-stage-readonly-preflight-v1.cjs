'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const P=require('./prhm-action-registry-v2-root-stage-readonly-preflight-v1.cjs');
const stage=require('./manifests/honartik-shared-registry-v2-independent-root-launcher-stage-v2.json');
function fixture(){
 let n=100;const files=new Map(),open=new Map();
 const state=()=>({uid:0,gid:0,dev:3,ino:++n,mode:0o100644,
  isFile:()=>true,isSymbolicLink:()=>false});
 for(const item of stage.reviewed_code){
  const bytes=fs.readFileSync(path.join(__dirname,item.source_path));
  files.set(item.destination,{bytes,s:{...state(),size:bytes.length}});
 }
 const dirs=new Set([P.ROOT,P.ROOT+'/manifests']);
 const io={
  lstatSync:p=>{
   if(p===P.NODE)return {...state(),mode:0o100755,size:100};
   if(dirs.has(p))return {...state(),mode:0o40700,
    isFile:()=>false,isDirectory:()=>true};
   const f=files.get(p);
   if(!f)throw Object.assign(Error('ENOENT'),{code:'ENOENT'});
   return f.s;
  },
  realpathSync:p=>p,
  openSync:(p,flags)=>{
   assert.ok(flags&fs.constants.O_NOFOLLOW,'missing O_NOFOLLOW');
   assert.ok(files.has(p),'open unknown source');
   const fd=++n;open.set(fd,p);return fd;
  },
  fstatSync:fd=>files.get(open.get(fd)).s,
  readFileSync:fd=>Buffer.from(files.get(open.get(fd)).bytes),
  closeSync:fd=>{assert.equal(open.delete(fd),true)}
 };
 const get=()=>P.inspect({io,getuid:()=>0,
  readUnit:()=>({loaded:true,active:false,fragment_present:true})});
 return {get,files,io};
}
test('preflight validates v2 28-object source pins; never grants L4/Production authorization',()=>{
 assert.equal(P.validate(),true);
 const f=fixture(),r=f.get();
 assert.equal(r.assessed,28);
 assert.equal(r.matching,28);
 assert.equal(r.missing,0);
 assert.equal(r.unsafe,0);
 assert.equal(r.read_only,true);
 assert.equal(r.ready_for_activation,false);
 assert.equal(r.production_authorized,false);
 assert.equal(r.signed_stage_authorized,false);
 assert.ok(r.blockers.includes('SIGNED_L4_AND_SEALED_CREDENTIAL_PRECHECK_REQUIRED'));
 assert.ok(r.blockers.includes('DUAL_MCP_AUTHENTICATED_DISCOVERY_NOT_VERIFIED'));
 assert.ok(r.blockers.includes('COLD_HOST_ROLLBACK_DRILL_NOT_VERIFIED'));
});
test('non-root preflight short-circuits without touching privileged host paths',()=>{
 const report=P.inspect({
  io:{lstatSync:()=>{throw Error('should not read host')}},
  getuid:()=>1001,readUnit:()=>{throw Error('must not inspect service')}
 });
 assert.deepEqual(report.blockers,['ROOT_REQUIRED']);
 assert.equal(report.assessed,0);
});
test('missing runtime file is an explicit NO-GO, never silently ignored',()=>{
 const f=fixture();
 f.files.delete(P.ROOT+'/prhm-action-registry-v2-root-complete-capabilities-v1.cjs');
 const r=f.get();
 assert.equal(r.matching,27);
 assert.equal(r.missing,1);
 assert.ok(r.blockers.includes(
  'STAGE_MISSING:prhm-action-registry-v2-root-complete-capabilities-v1.cjs'));
});
test('tampered SHA, symlink, non-root owner and world-write are blocked',()=>{
 for(const variation of ['sha','symlink','uid','mode']){
  const f=fixture();
  const file=f.files.get(P.ROOT+'/prhm-action-registry-v2-independent-root-launcher-v1.cjs');
  if(variation==='sha'){file.bytes=Buffer.from(file.bytes);file.bytes[0]^=1}
  if(variation==='symlink')file.s.isSymbolicLink=()=>true;
  if(variation==='uid')file.s.uid=1001;
  if(variation==='mode')file.s.mode=0o100666;
  const result=f.get();
  assert.equal(result.matching,27,variation);
  assert.equal(result.unsafe,1,variation);
  assert.ok(result.blockers.includes(
   'STAGE_UNSAFE_OR_DRIFT:prhm-action-registry-v2-independent-root-launcher-v1.cjs'),
   variation);
 }
});
test('inactive/missing systemd unit is NO-GO even when all 28 bytes match',()=>{
 const f=fixture();
 const report=P.inspect({io:f.io,getuid:()=>0,
  readUnit:()=>({loaded:false,active:false,fragment_present:false})});
 assert.equal(report.matching,28);
 assert.ok(report.blockers.includes('APPROVAL_V2_UNIT_NOT_LOADED_OR_UNVERIFIED'));
 assert.equal(report.production_authorized,false);
});
test('unexpected active sidecar remains a hard blocker pending signed review',()=>{
 const f=fixture(),report=P.inspect({io:f.io,getuid:()=>0,
  readUnit:()=>({loaded:true,active:true,fragment_present:true})});
 assert.ok(report.blockers.includes('UNEXPECTED_ACTIVE_APPROVAL_V2_UNIT'));
});
