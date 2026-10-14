'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const F=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const V=require('./prhm-action-registry-v2-root-sealed-token-vault-v1.cjs');
const ID='11111111-1111-4111-8111-111111111111';
function fixture(overrides={}){
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
 const key=publicKey.export({type:'spki',format:'pem'});
 const kid=G.sha(publicKey.export({type:'spki',format:'der'})).slice(0,16);
 const now=Math.floor(Date.now()/1000);
 const claims={
  approval_id:'22222222-2222-4222-8222-222222222222',
  request_id:ID,jti:'22222222-2222-4222-8222-222222222222',
  iss:'prhm-company-approval',action:G.ACTION,operation:G.OPERATION,
  project:'control_plane',environment:'production',
  tool:'host_action_v2_apply',principal_id:'mohammad',
  role:'mcp-operator',level:4,risk:'critical',decision:'accept',
  one_time_use:true,policy_version:G.POLICY_VERSION,policy_hash:'b'.repeat(64),
  arguments_sha256:F.ARGUMENTS_SHA,request_hash:F.ARGUMENTS_SHA,
  iat:now-5,nbf:now-5,exp:now+120,...overrides
 };
 const head={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid};
 const prefix=[head,claims].map(o=>Buffer.from(JSON.stringify(o)).toString('base64url')).join('.');
 const token=prefix+'.'+crypto.sign(null,Buffer.from(prefix),privateKey).toString('base64url');
 return {token,key,now};
}
function io(key){
 const files=new Map(),fd=new Map(),dir=V.DIR;
 let next=5;
 const dirEntry={type:'dir',uid:0,gid:0,mode:0o40700,dev:1,ino:2,data:null};
 const pubEntry={type:'file',uid:0,gid:0,mode:0o100644,dev:1,ino:3,data:Buffer.from(key)};
 files.set(dir,dirEntry);
 files.set(V.PUBLIC,pubEntry);
 function st(item){
  return {uid:item.uid,gid:item.gid,mode:item.mode,dev:item.dev,
   ino:item.ino,size:item.data?.length??0,isFile:()=>item.type==='file',
   isDirectory:()=>item.type==='dir',isSymbolicLink:()=>false};
 }
 const impl={
  lstatSync:path=>{const x=files.get(path);if(!x){const e=Error('ENOENT');e.code='ENOENT';throw e}return st(x)},
  realpathSync:path=>path,
  openSync:(path,flags,mode)=>{
   let x=files.get(path);
   if(flags&fs.constants.O_CREAT){
    if(x){const e=Error('EEXIST');e.code='EEXIST';throw e}
    x={type:'file',uid:0,gid:0,mode:0o100000|mode,
     dev:1,ino:next+50,data:Buffer.alloc(0)};
    files.set(path,x);
   }
   if(!x)throw Error('missing file');
   const n=next++;fd.set(n,x);return n;
  },
  fstatSync:n=>st(fd.get(n)),
  readFileSync:n=>Buffer.from(fd.get(n).data),
  writeSync:(n,data)=>{fd.get(n).data=Buffer.from(data);return data.length},
  fsyncSync:n=>{if(!fd.has(n))throw Error('bad fd')},
  closeSync:n=>{fd.delete(n)}
 };
 return {impl,files};
}
test('real synthetic Ed25519 signed five-field token passes the bound pre-storage signature gate',()=>{
 const f=fixture();
 assert.equal(V.validateSigned(f.token,ID,f.key,f.now),true);
});
test('forged Ed25519 signature, wrong request, changed SHA or expired token cannot be sealed',()=>{
 const f=fixture();
 assert.throws(()=>V.validateSigned(f.token,'33333333-3333-4333-8333-333333333333',f.key,f.now),
  /signed_request_identity_or_expiry/);
 for(const changes of [
  {arguments_sha256:'f'.repeat(64)}, {project:'other'},
  {level:3}, {one_time_use:false},{exp:f.now-1},
  {policy_version:'old-policy'},{action:'wrong'}
 ]){
  const v=fixture(changes);
  assert.throws(()=>V.validateSigned(v.token,ID,v.key,v.now),
   /signed_request_identity_or_expiry/);
 }
 const t=f.token.slice(0,-2)+'aa';
 assert.throws(()=>V.validateSigned(t,ID,f.key,f.now),
  /signed_token_invalid_signature/);
});
test('root-only vault persists 0600 once with durable file and dir fsync and can reload',()=>{
 const f=fixture(),m=io(f.key);
 const v=V.createVault({io:m.impl,getuid:()=>0,now:()=>f.now});
 assert.equal(v.sealApprovedToken(ID,f.token),true);
 const saved=m.files.get(V.DIR+'/'+ID+'.json');
 assert.equal(saved.mode&0o777,0o600);
 assert.deepEqual(JSON.parse(saved.data.toString()),{
  schema:'prhm.registry-v2.sealed-approval.v1',request_id:ID,
  approval_token:f.token
 });
 assert.equal(v.loadSealedApprovedToken(ID),f.token);
 assert.throws(()=>v.sealApprovedToken(ID,f.token),
  /already_sealed_no_reissue/);
 assert.equal(m.files.get(V.DIR+'/'+ID+'.json'),saved);
});
test('untrusted root-mode/dir/key and attempted tamper fail closed',()=>{
 const f=fixture(),m=io(f.key);
 assert.throws(()=>V.createVault({io:m.impl,getuid:()=>1000}),/root_only/);
 const v=V.createVault({io:m.impl,getuid:()=>0,now:()=>f.now});
 m.files.get(V.DIR).mode=0o40755;
 assert.throws(()=>v.sealApprovedToken(ID,f.token),/private_dir_not_ready/);
 m.files.get(V.DIR).mode=0o40700;
 assert.equal(v.sealApprovedToken(ID,f.token),true);
 m.files.get(V.DIR+'/'+ID+'.json').mode=0o100644;
 assert.throws(()=>v.loadSealedApprovedToken(ID),/file_unsafe/);
 m.files.get(V.DIR+'/'+ID+'.json').mode=0o100600;
 m.files.get(V.DIR+'/'+ID+'.json').data=Buffer.from('{"approval_token":"forged"}');
 assert.throws(()=>v.loadSealedApprovedToken(ID),
  /file_unsafe|sealed_schema_invalid/);
});
test('secret vault has no delete/retry/token creation interface',()=>{
 const f=fixture(),v=V.createVault({io:io(f.key).impl,getuid:()=>0,now:()=>f.now});
 assert.deepEqual(Object.keys(v),['sealApprovedToken','loadSealedApprovedToken']);
 for(const method of ['delete','reissue','consume','request','confirm','sign','execute']){
  assert.equal(Object.hasOwn(v,method),false);
 }
});
