'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const gate=require('./honartik-u06-native-root-l4-admission-v1.cjs');
const action=require('./honartik-u06-native-l4-consumed-receipt-v1.cjs');
const H=x=>crypto.createHash('sha256').update(x).digest('hex');
const RID='22222222-2222-4222-8222-222222222222',AID='11111111-1111-4111-8111-111111111111';
function fixture(){
 const root=fs.mkdtempSync('/tmp/u06-root-l4-test-');fs.chmodSync(root,0o700);
 const consumed=path.join(root,'consumed'),fence=path.join(root,'fence');
 for(const d of [consumed,fence])fs.mkdirSync(d,{mode:0o700});
 const policy=path.join(root,'policy.json'),issuer=path.join(root,'issuer.pem');
 const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
 const kid=H(publicKey.export({format:'der',type:'spki'})).slice(0,16);
 const version='2026-11-11-actual-fixture',now=Math.floor(Date.now()/1000);
 const p={schema_version:'prhm.approval-policy.v1',default_deny:true,scope_freeze:true,
  one_time_use:true,issuer:'prhm-company-approval',version,
  levels:{'4':{human_approval:true,second_confirmation_required:true,max_ttl_seconds:180}},
  operations:{[action.OPERATION]:{level:4,risk:'critical',requires_second_confirmation:true,
   one_time_use:true,expires_seconds:180,policy_version:version,
   requested_approver:'mohammad',rollback_reference:action.EXPECTED.rollback}},
  typed_scopes:[{tool:'host_action_v2_apply',project:'control_plane',
   environment:'production',action:action.ACTION,operation:action.OPERATION,
   risk:'critical',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]};
 const policyBytes=Buffer.from(JSON.stringify(p));const policy_sha256=H(policyBytes);
 fs.writeFileSync(policy,policyBytes,{mode:0o600});
 fs.writeFileSync(issuer,publicKey.export({format:'pem',type:'spki'}),{mode:0o600});
 const claims={approval_id:AID,request_id:RID,jti:AID,iss:'prhm-company-approval',
  action:action.ACTION,operation:action.OPERATION,project:'control_plane',
  environment:'production',tool:'host_action_v2_apply',principal_id:'mohammad',
  role:'mcp-operator',level:4,risk:'critical',decision:'accept',one_time_use:true,
  policy_version:version,policy_hash:policy_sha256,
  arguments_sha256:action.argDigest(),request_hash:action.argDigest(),
  iat:now-25,nbf:now-25,exp:now+80};
 const sign=c=>{
  const head={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',kid};
  const body=[head,c].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  return body+'.'+crypto.sign(null,Buffer.from(body),privateKey).toString('base64url');
 };
 const ledger={schema_version:'prhm.approval-consumption.v1',approval_id:AID,
  request_id:RID,work_order_id:null,project_id:'control_plane',
  operation:action.OPERATION,request_hash:action.argDigest(),
  consumed_at:new Date((now-5)*1000).toISOString(),
  consumer:'prhm-agent-selfmaint-exec-host-actions-v2',consumption_hash:null};
 ledger.consumption_hash=H(Buffer.from(JSON.stringify({...ledger,consumption_hash:null})));
 const ledgerFile=path.join(consumed,AID+'.json');
 fs.writeFileSync(ledgerFile,JSON.stringify(ledger),{mode:0o600});
 const paths={policy,issuer,consumed,fence,policy_sha256};
 const F={operation:'honartik_back.production.native_backup',reviewed_l4_policy_sha256:policy_sha256};
 const journal={id:'u06_real_native_fixture_journal_20261111'};
 return {root,paths,F,journal,claims,sign,ledgerFile};
}
const open=(f,token=f.sign(f.claims))=>gate.createDisposableRootL4Fixture(RID,()=>token,f.paths);
const clean=f=>fs.rmSync(f.root,{recursive:true,force:true});
test('real Ed25519 + consumed ledger + O_EXCL fsync, replay denied',()=>{
 const f=fixture();try{
  const bridge=open(f),receipt=bridge.verifyNativeConsumedSignedLevel4(f.F,f.journal);
  assert.equal(receipt.operation,action.OPERATION);
  assert.equal(receipt.level,4);
  assert.equal(bridge.reserveNativeLevel4ReplayFence(f.F,f.journal,receipt),true);
  const file=path.join(f.paths.fence,AID+'.json');
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  assert.equal(JSON.parse(fs.readFileSync(file)).state,'CONSUMED_NO_REPLAY');
  const another=open(f),proof=another.verifyNativeConsumedSignedLevel4(f.F,f.journal);
  assert.throws(()=>another.reserveNativeLevel4ReplayFence(f.F,f.journal,proof),/EEXIST/);
 }finally{clean(f)}
});
test('tamper signed action, Level3, expiry or policy and consumed ledger fails closed',()=>{
 const f=fixture();try{
  for(const changes of [{action:'different'},{level:3},
   {decision:'deny'},{policy_hash:'0'.repeat(64)},
   {exp:Math.floor(Date.now()/1000)-1}]){
    assert.throws(()=>open(f,f.sign({...f.claims,...changes}))
      .verifyNativeConsumedSignedLevel4(f.F,f.journal),/u06_l4_|u06_native_root_l4_/);
  }
  assert.throws(()=>open(f).verifyNativeConsumedSignedLevel4(
    {...f.F,reviewed_l4_policy_sha256:'0'.repeat(64)},f.journal),/owner_scope_not_bound/);
  const ledger=JSON.parse(fs.readFileSync(f.ledgerFile));
  ledger.consumption_hash='0'.repeat(64);fs.writeFileSync(f.ledgerFile,JSON.stringify(ledger));
  assert.throws(()=>open(f).verifyNativeConsumedSignedLevel4(f.F,f.journal),
    /signed_receipt_not_authoritatively_consumed/);
  assert.equal(fs.readdirSync(f.paths.fence).length,0);
 }finally{clean(f)}
});
test('untrusted true boolean receipt and symlink ledger cannot create replay fence',()=>{
 const f=fixture();try{
  const bridge=open(f);
  assert.throws(()=>bridge.reserveNativeLevel4ReplayFence(f.F,f.journal,{
   operation:action.OPERATION,level:4,signature_verified:true,consumed_ledger_verified:true,
   request_id:RID,approval_id:AID,policy_sha256:f.paths.policy_sha256
  }),/not_verifier_owned_receipt/);
  fs.unlinkSync(f.ledgerFile);fs.symlinkSync(f.paths.policy,f.ledgerFile);
  assert.throws(()=>bridge.verifyNativeConsumedSignedLevel4(f.F,f.journal),/untrusted_file/);
  assert.equal(fs.readdirSync(f.paths.fence).length,0);
 }finally{clean(f)}
});
test('actual SIGKILL immediately after fsync retains anti-replay across process death',()=>{
 const f=fixture();try{
  const fixturePath=path.join(f.root,'secret-test-input.json');
  fs.writeFileSync(fixturePath,JSON.stringify({
    paths:f.paths,F:f.F,journal:f.journal,token:f.sign(f.claims)
  }),{mode:0o600});
  const child=[
    "const fs=require('node:fs');",
    "const gate=require('./honartik-u06-native-root-l4-admission-v1.cjs');",
    "const data=JSON.parse(fs.readFileSync(process.argv[1]));",
    "const bridge=gate.createDisposableRootL4Fixture('"+RID+"',()=>data.token,data.paths);",
    "const r=bridge.verifyNativeConsumedSignedLevel4(data.F,data.journal);",
    "bridge.reserveNativeLevel4ReplayFence(data.F,data.journal,r);",
    "process.kill(process.pid,'SIGKILL');"
  ].join('\n');
  const p=cp.spawnSync(process.execPath,['-e',child,fixturePath],{cwd:__dirname,timeout:10000});
  assert.equal(p.signal,'SIGKILL');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.paths.fence,AID+'.json'))).state,
    'CONSUMED_NO_REPLAY');
  const bridge=open(f),proof=bridge.verifyNativeConsumedSignedLevel4(f.F,f.journal);
  assert.throws(()=>bridge.reserveNativeLevel4ReplayFence(f.F,f.journal,proof),/EEXIST/);
 }finally{clean(f)}
});
test('no Production action installed, no root file edits and live requires root',()=>{
 if(process.getuid()!==0)assert.throws(
  ()=>gate.createLiveRootL4Callbacks(RID,()=>null),/executor_uid_mismatch/);
 assert.equal(gate.ROOT_ACTION_REGISTERED,false);
 assert.equal(gate.PRODUCTION_APPLY_EXPORTED,false);
 assert.equal(gate.POLICY_INSTALLER_EXPORTED,false);
 assert.equal(gate.install,undefined);
 assert.equal(gate.apply,undefined);
});

test('live Root trust uses exact systemd PrivateStateDirectory alias, not forged root ownership',()=>{
 assert.equal(gate.APPROVAL_ALIAS,'/var/lib/prhm-company-approval');
 assert.equal(gate.APPROVAL_BASE,'/var/lib/private/prhm-company-approval');
 assert.equal(gate.APPROVAL_UID,65039);
 assert.equal(gate.FIXED.issuer,
   '/var/lib/private/prhm-company-approval/ed25519-public.pem');
 assert.equal(gate.FIXED.consumed,
   '/var/lib/private/prhm-company-approval/consumed');
 assert.equal(gate.FIXED.policy_sha256,
   'aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934');
 assert.equal(typeof gate.attestFixedSystemdApprovalAlias,'function');
 const file=require('node:fs').readFileSync(
   require('node:path').join(__dirname,
   'honartik-u06-native-root-l4-admission-v1.cjs'),'utf8');
 assert.match(file,/private\/prhm-company-approval/);
 assert.match(file,/systemd_state_alias_drift/);
 assert.match(file,/ownerUid:fixture\?rootUid:APPROVAL_UID/);
 assert.equal(gate.ROOT_ACTION_REGISTERED,false);
});
