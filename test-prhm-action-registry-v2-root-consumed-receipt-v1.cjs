'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const R=require('./prhm-action-registry-v2-root-consumed-receipt-v1.cjs');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const F=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const REQUEST_ID='22222222-2222-4222-8222-222222222222';
const APPROVAL_ID='11111111-1111-4111-8111-111111111111';
function signedFixture(){
 const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
 const key=publicKey.export({type:'spki',format:'pem'});
 const nowSec=Math.floor(Date.now()/1000),hash=F.ARGUMENTS_SHA;
 const header={
  alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',
  kid:G.sha(publicKey.export({type:'spki',format:'der'})).slice(0,16)
 };
 const claims={
  approval_id:APPROVAL_ID,request_id:REQUEST_ID,jti:APPROVAL_ID,
  iss:'prhm-company-approval',action:G.ACTION,operation:G.OPERATION,
  project:'control_plane',environment:'production',tool:'host_action_v2_apply',
  principal_id:'mohammad',role:'mcp-operator',level:4,risk:'critical',
  decision:'accept',one_time_use:true,policy_version:G.POLICY_VERSION,
  policy_hash:'c'.repeat(64),arguments_sha256:hash,request_hash:hash,
  nbf:nowSec-10,iat:nowSec-10,exp:nowSec+100
 };
 const body=[header,claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 const token=body+'.'+crypto.sign(null,Buffer.from(body),privateKey).toString('base64url');
 const ledger={
  schema_version:'prhm.approval-consumption.v1',
  approval_id:APPROVAL_ID,request_id:REQUEST_ID,
  work_order_id:null,project_id:'control_plane',
  operation:G.OPERATION,request_hash:hash,
  consumed_at:new Date((nowSec-1)*1000).toISOString(),
  consumer:'prhm-agent-selfmaint-exec-host-actions-v2',
  consumption_hash:null
 };
 ledger.consumption_hash=G.sha(Buffer.from(JSON.stringify(ledger)));
 return {token,key,ledger,nowSec};
}
function fakeFS(f){
 const p='/var/lib/prhm-company-approval',sub=R.DIR,leaf=sub+'/'+APPROVAL_ID+'.json';
 let handle=3;
 const handles=new Map();
 const data=new Map([
  [p,{type:'dir',uid:991,gid:991,mode:0o40700,ino:1,dev:4}],
  [sub,{type:'dir',uid:991,gid:991,mode:0o40700,ino:2,dev:4}],
  [R.PUBLIC,{type:'file',uid:991,gid:991,mode:0o100644,ino:3,dev:4,bytes:Buffer.from(f.key)}],
  [leaf,{type:'file',uid:991,gid:991,mode:0o100600,ino:4,dev:4,
   bytes:Buffer.from(JSON.stringify(f.ledger)+'\n')}]
 ]);
 const stat=s=>({uid:s.uid,gid:s.gid,dev:s.dev,ino:s.ino,mode:s.mode,
  size:s.bytes?.length??0,
  isDirectory:()=>s.type==='dir',isFile:()=>s.type==='file',
  isSymbolicLink:()=>s.type==='symlink'});
 const io={
  lstatSync:location=>{
   const s=data.get(location);
   if(!s)throw Object.assign(Error('ENOENT'),{code:'ENOENT'});
   return stat(s)
  },
  realpathSync:location=>location,
  openSync:(location,flags)=>{
   assert.ok(flags&fs.constants.O_NOFOLLOW,'O_NOFOLLOW missing');
   assert.equal(flags&fs.constants.O_CREAT,0,'never create receipts');
   const s=data.get(location);
   if(!s)throw Object.assign(Error('ENOENT'),{code:'ENOENT'});
   const fd=handle++;handles.set(fd,location);return fd
  },
  fstatSync:fd=>stat(data.get(handles.get(fd))),
  readFileSync:fd=>Buffer.from(data.get(handles.get(fd)).bytes),
  closeSync:fd=>{assert.ok(handles.delete(fd))}
 };
 return {io,data,leaf,handles};
}
function reader(f,io){
 return R.createReader({io,getuid:()=>0,clock:()=>f.nowSec,
  loadSealedApprovedToken:id=>{
   assert.equal(id,REQUEST_ID);
   return f.token
  }});
}
test('real Ed25519 L4 token selects approval_id ledger, not the request_id file',()=>{
 const f=signedFixture(),disk=fakeFS(f),r=reader(f,disk.io);
 const v=r.readConsumedEvidence(REQUEST_ID);
 assert.equal(v.ledger.approval_id,APPROVAL_ID);
 assert.equal(v.ledger.request_id,REQUEST_ID);
 assert.equal(v.nowSec,f.nowSec);
 assert.equal(disk.handles.size,0);
 assert.ok(Buffer.isBuffer(v.publicKey));
 assert.ok(!Object.hasOwn(v,'token'));
 assert.equal(F.verifyConsumedCryptographically({
  token:f.token,publicKey:v.publicKey,ledger:v.ledger,nowSec:v.nowSec
 }).request_id,REQUEST_ID);
});
test('fake approval, wrong ledger hash, consumer and expired L4 fail before evidence',()=>{
 const f=signedFixture(),disk=fakeFS(f);
 const cases=[
  {...f.ledger,consumption_hash:'0'.repeat(64)},
  {...f.ledger,consumer:'attacker'},
  {...f.ledger,request_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}
 ];
 for(const ledger of cases){
  disk.data.get(disk.leaf).bytes=Buffer.from(JSON.stringify(ledger)+'\n');
  assert.throws(()=>reader(f,disk.io).readConsumedEvidence(REQUEST_ID),
   /consumption_ledger_invalid_or_replayed/);
 }
 disk.data.get(disk.leaf).bytes=Buffer.from(JSON.stringify(f.ledger)+'\n');
 const outdated={...f,nowSec:f.nowSec+105};
 assert.throws(()=>reader(outdated,disk.io).readConsumedEvidence(REQUEST_ID),
  /signed_l4_binding_expiry_or_policy_mismatch/);
});
test('never read request-id location, foreign owner, symlink, or mutable parent',()=>{
 const f=signedFixture(),disk=fakeFS(f);
 disk.data.delete(disk.leaf);
 assert.throws(()=>reader(f,disk.io).readConsumedEvidence(REQUEST_ID),/ENOENT/);
 disk.data.set(disk.leaf,{type:'file',uid:7000,gid:7000,mode:0o100600,
  ino:4,dev:4,bytes:Buffer.from(JSON.stringify(f.ledger))});
 assert.throws(()=>reader(f,disk.io).readConsumedEvidence(REQUEST_ID),
  /receipt_file_untrusted/);
 disk.data.get(disk.leaf).uid=991;
 disk.data.get(R.DIR).mode=0o40777;
 assert.throws(()=>reader(f,disk.io).readConsumedEvidence(REQUEST_ID),
  /private_state_dir_unsafe/);
 disk.data.get(R.DIR).mode=0o40700;
 disk.data.get(disk.leaf).type='symlink';
 assert.throws(()=>reader(f,disk.io).readConsumedEvidence(REQUEST_ID),
  /receipt_file_untrusted/);
});
test('root required, ID must be typed, and reader has no write/consume API',()=>{
 const f=signedFixture(),disk=fakeFS(f);
 const r=R.createReader({io:disk.io,getuid:()=>1,
  clock:()=>f.nowSec,loadSealedApprovedToken:()=>f.token});
 assert.throws(()=>r.readConsumedEvidence(REQUEST_ID),/root_process_required/);
 assert.throws(()=>reader(f,disk.io).readConsumedEvidence('../etc/passwd'),/request_id_invalid/);
 assert.deepEqual(Object.keys(R).sort(),['PUBLIC','DIR','createReader'].sort());
 assert.deepEqual(Object.keys(reader(f,disk.io)),['readConsumedEvidence']);
});
