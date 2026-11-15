'use strict';
/**
 * GitHub-hosted ephemeral Root sandbox. THIS FILE IS A TEST ONLY.
 *
 * Positive: actual UID0, root:root 0700/0600, Ed25519/consumed L4,
 * durable O_EXCL journal & one-time fence. No production hostname, service,
 * network, MySQL, global policy, Native worker, or installed Root action.
 * This does not export any privileged constructor or Root handler.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Scope=require('./honartik-u06-native-l4-consumed-receipt-v1.cjs');
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
function checkHarness(){
 assert.equal(process.platform,'linux');
 assert.equal(process.getuid(),0);
 assert.equal(process.env.GITHUB_ACTIONS,'true');
 assert.equal(process.env.GITHUB_REPOSITORY,'prhmonline/prhm-host-actions');
 assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
}
function syncDir(d){
 const fd=fs.openSync(d,fs.constants.O_DIRECTORY|fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function rootDir(d){
 const x=fs.lstatSync(d);
 assert.ok(x.isDirectory()&&!x.isSymbolicLink());
 assert.equal(x.uid,0);assert.equal(x.gid,0);assert.equal(x.mode&0o777,0o700);
}
function durableCreate(file,raw){
 const parent=path.dirname(file);rootDir(parent);
 const fd=fs.openSync(file,
  fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{
  const s=fs.fstatSync(fd);
  assert.equal(s.uid,0);assert.equal(s.gid,0);assert.equal(s.mode&0o777,0o600);
  assert.equal(s.nlink,1);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);
 }finally{fs.closeSync(fd)}
 syncDir(parent);
}
function rootRead(file){
 const first=fs.lstatSync(file);
 assert.ok(first.isFile()&&!first.isSymbolicLink());
 assert.equal(first.uid,0);assert.equal(first.gid,0);
 assert.equal(first.mode&0o777,0o600);assert.equal(first.nlink,1);
 assert.ok(first.size>0&&first.size<200000);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const after=fs.fstatSync(fd);
  assert.equal(after.dev,first.dev);assert.equal(after.ino,first.ino);
  assert.equal(after.size,first.size);
  return fs.readFileSync(fd);
 }finally{fs.closeSync(fd)}
}
function fixture(){
 checkHarness();
 const root=fs.mkdtempSync('/tmp/u06-root-ci-sandbox-');
 fs.chmodSync(root,0o700);rootDir(root);
 const consumed=path.join(root,'consumed'),locks=path.join(root,'locks');
 for(const d of [consumed,locks]){fs.mkdirSync(d,{mode:0o700});rootDir(d)}
 const policy={schema_version:'prhm.approval-policy.v1',
  issuer:'prhm-company-approval',version:'2026-11-15-root-ci-sandbox',
  default_deny:true,one_time_use:true,scope_freeze:true,
  levels:{'4':{human_approval:true,second_confirmation_required:true,max_ttl_seconds:180}},
  operations:{[Scope.OPERATION]:{
   level:4,risk:'critical',requires_second_confirmation:true,
   one_time_use:true,expires_seconds:180,
   policy_version:'2026-11-15-root-ci-sandbox',requested_approver:'mohammad',
   rollback_reference:Scope.EXPECTED.rollback
  }},
  typed_scopes:[{
   tool:'host_action_v2_apply',project:'control_plane',environment:'production',
   action:Scope.ACTION,operation:Scope.OPERATION,risk:'critical',
   principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
  }]
 };
 const bytes=Buffer.from(JSON.stringify(policy,null,2)+'\n');
 const policyHash=H(bytes);
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
 const publicPem=publicKey.export({type:'spki',format:'pem'});
 durableCreate(path.join(root,'policy.json'),bytes);
 durableCreate(path.join(root,'issuer.pem'),publicPem);
 const requestId=crypto.randomUUID(),approvalId=crypto.randomUUID();
 const nowSec=Math.floor(Date.now()/1000);
 const argumentsSha=Scope.argDigest();
 const claims={
  approval_id:approvalId,request_id:requestId,jti:approvalId,
  iss:'prhm-company-approval',action:Scope.ACTION,operation:Scope.OPERATION,
  project:'control_plane',environment:'production',tool:'host_action_v2_apply',
  principal_id:'mohammad',role:'mcp-operator',level:4,risk:'critical',
  decision:'accept',one_time_use:true,policy_version:policy.version,
  policy_hash:H(Buffer.from(JSON.stringify(policy))),
  arguments_sha256:argumentsSha,request_hash:argumentsSha,
  iat:nowSec-15,nbf:nowSec-15,exp:nowSec+120
 };
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const kid=H(publicKey.export({type:'spki',format:'der'})).slice(0,16);
 const signing=enc({alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid})+'.'+enc(claims);
 const token=signing+'.'+crypto.sign(null,Buffer.from(signing),privateKey).toString('base64url');
 const ledger={
  schema_version:'prhm.approval-consumption.v1',approval_id:approvalId,request_id:requestId,
  work_order_id:null,project_id:'control_plane',operation:Scope.OPERATION,
  request_hash:argumentsSha,consumed_at:new Date((nowSec-5)*1000).toISOString(),
  consumer:'prhm-agent-selfmaint-exec-host-actions-v2',consumption_hash:null
 };
 ledger.consumption_hash=H(Buffer.from(JSON.stringify({...ledger,consumption_hash:null})));
 durableCreate(path.join(consumed,approvalId+'.json'),Buffer.from(JSON.stringify(ledger)+'\n'));
 const values={root,consumed,locks,policyHash,requestId,approvalId,token,nowSec};
 return {...values,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function verifyRootOwned(f,token=f.token){
 rootDir(f.root);
 const policyBytes=rootRead(path.join(f.root,'policy.json'));
 const publicKey=rootRead(path.join(f.root,'issuer.pem'));
 const consumedLedger=JSON.parse(rootRead(path.join(f.consumed,f.approvalId+'.json')).toString('utf8'));
 return Scope.verifySignedConsumedL4({
  token,issuerPublicKey:publicKey,consumedLedger,policyBytes,
  reviewedPolicySha256:f.policyHash,nowSec:f.nowSec
 });
}
test('ephemeral UID0: actual root-owned signed and consumed L4, exclusive disk journal and anti-replay fence',()=>{
 const f=fixture();try{
  const proof=verifyRootOwned(f);
  assert.equal(proof.signature_verified,true);
  assert.equal(proof.consumed_ledger_verified,true);
  assert.equal(proof.operation,Scope.OPERATION);
  const lock=path.join(f.locks,'u06-owner-shared-exclusive.lock');
  const journal=path.join(f.locks,'u06-rollback.json');
  const fence=path.join(f.locks,f.approvalId+'.used');
  durableCreate(lock,Buffer.from(JSON.stringify({kind:'native_backup_transaction',
   approval_id:f.approvalId,state:'HELD'})+'\n'));
  durableCreate(journal,Buffer.from(JSON.stringify({
   state:'PREPARED',id:crypto.randomBytes(20).toString('hex')
  })+'\n'));
  assert.equal(JSON.parse(rootRead(journal)).state,'PREPARED');
  durableCreate(fence,Buffer.from(JSON.stringify({
   approval_id:proof.approval_id,operation:proof.operation,
   scope_exact:true,consumed:true
  })+'\n'));
  assert.throws(()=>durableCreate(fence,Buffer.from('replay')),{code:'EEXIST'});
  assert.equal(JSON.parse(rootRead(fence)).consumed,true);
  assert.equal(JSON.parse(rootRead(lock)).state,'HELD');
  // Terminal is deliberately NOT cleared in this sandbox: no backup,
  // offsite or full isolated Root handler has been executed.
  console.log('EPHEMERAL_ROOT_SIGNED_L4_AND_EXCLUSIVE_FS=PASS');
  console.log('LIVE_ROOT_DISPATCHER_CONNECTED=FALSE');
 }finally{f.cleanup()}
});
test('ephemeral UID0: invalid signature and file-mode tampering fail before any new fence',()=>{
 const f=fixture();try{
  const broken=f.token.slice(0,-6)+'aaaaaa';
  assert.throws(()=>verifyRootOwned(f,broken),/signature_invalid|prhm_u06_l4_|honartik_l4_receipt_/);
  fs.chmodSync(path.join(f.root,'issuer.pem'),0o644);
  assert.throws(()=>verifyRootOwned(f),/AssertionError/);
  assert.deepEqual(fs.readdirSync(f.locks),[]);
 }finally{f.cleanup()}
});
