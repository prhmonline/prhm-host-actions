'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const Entry=require('./honartik-u06-isolated-root-native-path-v1.cjs');
const Scope=require('./honartik-u06-native-l4-consumed-receipt-v1.cjs');
const H=b=>crypto.createHash('sha256').update(b).digest('hex');
const write=(p,data)=>fs.writeFileSync(p,data,{mode:0o600});
function fixture(){
 const sharedRoot='/tmp/u06-owner-shared-test-'+crypto.randomBytes(6).toString('hex');
 const authRoot='/tmp/u06-root-signed-gate-test-'+crypto.randomBytes(6).toString('hex');
 const nativeRoot=fs.mkdtempSync('/tmp/u06-root-lease-test-');
 const l4Root=fs.mkdtempSync('/tmp/u06-root-l4-test-');
 for(const d of [sharedRoot,authRoot])fs.mkdirSync(d,{mode:0o700});
 fs.chmodSync(nativeRoot,0o700);fs.chmodSync(l4Root,0o700);
 const authConsumed=path.join(authRoot,'consumed'),consumed=path.join(l4Root,'consumed'),
  fence=path.join(l4Root,'fence');
 for(const d of [authConsumed,consumed,fence])fs.mkdirSync(d,{mode:0o700});
 const profile=path.join(nativeRoot,'profile.json'),adapter=path.join(nativeRoot,'adapter.py'),
   credential=path.join(nativeRoot,'credential.cnf');
 write(profile,JSON.stringify({backup:{offsite_required:false}})+'\n');
 write(adapter,'# fixture adapter, never executed\n');
 const version='2026-11-15-isolated-real-native-journal';
 const p={schema_version:'prhm.approval-policy.v1',issuer:'prhm-company-approval',
  version,default_deny:true,one_time_use:true,scope_freeze:true,
  levels:{'4':{human_approval:true,second_confirmation_required:true,max_ttl_seconds:180}},
  operations:{[Scope.OPERATION]:{
   level:4,risk:'critical',requires_second_confirmation:true,one_time_use:true,
   expires_seconds:180,policy_version:version,requested_approver:'mohammad',
   rollback_reference:Scope.EXPECTED.rollback
  }},
  typed_scopes:[{tool:'host_action_v2_apply',project:'control_plane',
   environment:'production',action:Scope.ACTION,operation:Scope.OPERATION,
   risk:'critical',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]};
 const raw=Buffer.from(JSON.stringify(p,null,2)+'\n'),reviewedPolicySha256=H(raw);
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
 const pub=publicKey.export({format:'pem',type:'spki'});
 const nativePolicy={
  policy:path.join(l4Root,'policy.json'),issuer:path.join(l4Root,'issuer.pem'),
  consumed,fence,policy_sha256:reviewedPolicySha256
 };
 write(nativePolicy.policy,raw);write(nativePolicy.issuer,pub);
 write(path.join(authRoot,'policy.json'),raw);
 write(path.join(authRoot,'issuer.pem'),pub);
 const now=Math.floor(Date.now()/1000),requestId=crypto.randomUUID(),approvalId=crypto.randomUUID();
 const args=Scope.argDigest();
 const claims={approval_id:approvalId,request_id:requestId,jti:approvalId,
  iss:'prhm-company-approval',action:Scope.ACTION,operation:Scope.OPERATION,
  project:'control_plane',environment:'production',tool:'host_action_v2_apply',
  principal_id:'mohammad',role:'mcp-operator',level:4,risk:'critical',
  decision:'accept',one_time_use:true,policy_version:version,
  policy_hash:H(Buffer.from(JSON.stringify(p))),
  arguments_sha256:args,request_hash:args,iat:now-15,nbf:now-15,exp:now+120};
 const header={alg:'EdDSA',typ:'PRHM-COMPANY-APPROVAL',
  kid:H(publicKey.export({format:'der',type:'spki'})).slice(0,16)};
 const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const body=b64(header)+'.'+b64(claims);
 const token=body+'.'+crypto.sign(null,Buffer.from(body),privateKey).toString('base64url');
 const ledger={schema_version:'prhm.approval-consumption.v1',
  approval_id:approvalId,request_id:requestId,work_order_id:null,
  project_id:'control_plane',operation:Scope.OPERATION,request_hash:args,
  consumed_at:new Date((now-10)*1000).toISOString(),
  consumer:'prhm-agent-selfmaint-exec-host-actions-v2',consumption_hash:null};
 ledger.consumption_hash=H(Buffer.from(JSON.stringify({...ledger,consumption_hash:null})));
 for(const root of [authConsumed,consumed])
  write(path.join(root,approvalId+'.json'),JSON.stringify(ledger));
 const cfg={sharedRoot,authRoot,nativeRoot,nativePolicy,
  profile,adapter,credential,requestId,token,reviewedPolicySha256};
 return {cfg,approvalId,cleanup:()=>[sharedRoot,authRoot,nativeRoot,l4Root].forEach(d=>
  fs.rmSync(d,{recursive:true,force:true}))};
}
const nativeFile=f=>path.join(f.cfg.nativeRoot,'u06-exclusive.lease');
const journalFile=f=>path.join(f.cfg.nativeRoot,'u06-rollback.json');
const sharedFile=f=>path.join(f.cfg.sharedRoot,'u06-owner-shared-exclusive.lock');
const officialFence=f=>path.join(f.cfg.nativePolicy.fence,f.approvalId+'.json');
const sharedFence=f=>path.join(f.cfg.sharedRoot,'u06-owner-shared-signed-fences',f.approvalId+'.used');
function crashChild(f,stage){
 const js=[
  "const E=require('./honartik-u06-isolated-root-native-path-v1.cjs');",
  "const cfg="+JSON.stringify(f.cfg)+";",
  "E.createIsolatedNativeRootPath({...cfg,checkpoint:s=>{",
  "if(s==="+JSON.stringify(stage)+")process.kill(process.pid,'SIGKILL')",
  "}}).executeVerifiedRollback()"
 ].join('\n');
 return spawnSync(process.execPath,['-e',js],
  {cwd:__dirname,encoding:'utf8',timeout:12000});
}
test('real native lease and durable signed L4 fence integrate with shared gate on exact rollback',()=>{
 const f=fixture();try{
  const marks=[];
  const entry=Entry.createIsolatedNativeRootPath({...f.cfg,checkpoint:s=>marks.push(s)});
  const result=entry.executeVerifiedRollback();
  assert.deepEqual(marks,[
   'shared_admitted','native_locked','prepared_journal',
   'native_l4_consumed','rolled_back_journal','native_unlocked','shared_released']);
  assert.equal(result.verified_rollback,true);
  assert.equal(result.native_backup_executed,false);
  assert.equal(result.production_mutated,false);
  assert.equal(result.official_l4_consumption_count,1);
  assert.equal(result.official_l4_replay_denied,true);
  assert.equal(fs.existsSync(sharedFile(f)),false);
  assert.equal(fs.existsSync(nativeFile(f)),false);
  assert.equal(fs.existsSync(officialFence(f)),true);
  const nativeJournal=JSON.parse(fs.readFileSync(journalFile(f),'utf8'));
  assert.equal(nativeJournal.state,'ROLLED_BACK');
  assert.equal(fs.statSync(journalFile(f)).mode&0o777,0o600);
  assert.equal(fs.statSync(officialFence(f)).mode&0o777,0o600);
  assert.equal(fs.statSync(sharedFence(f)).mode&0o777,0o600);
  assert.equal(entry.inspect().official_fence_files,1);
  assert.throws(()=>Entry.createIsolatedNativeRootPath(f.cfg).executeVerifiedRollback(),
   /existing_native_transaction|busy_or_unrecovered/);
 }finally{f.cleanup()}
});
for(const step of ['shared_admitted','native_locked','prepared_journal',
 'native_l4_consumed','rolled_back_journal','native_unlocked']){
 test('SIGKILL at '+step+' retains fail-closed shared lock and exact journal stage',()=>{
  const f=fixture();try{
   const crash=crashChild(f,step);
   assert.equal(crash.signal,'SIGKILL',crash.stderr);
   assert.equal(fs.existsSync(sharedFile(f)),true);
   assert.equal(fs.existsSync(sharedFence(f)),true);
   assert.equal(fs.existsSync(officialFence(f)),
    ['native_l4_consumed','rolled_back_journal','native_unlocked'].includes(step));
   if(['prepared_journal','native_l4_consumed','rolled_back_journal','native_unlocked'].includes(step)){
    const j=JSON.parse(fs.readFileSync(journalFile(f),'utf8'));
    assert.equal(j.state,
     ['rolled_back_journal','native_unlocked'].includes(step)?'ROLLED_BACK':'PREPARED');
   }else assert.equal(fs.existsSync(journalFile(f)),false);
   const fresh=Entry.createIsolatedNativeRootPath(f.cfg);
   assert.equal(fresh.inspect().shared_locked,true);
   assert.throws(()=>fresh.executeVerifiedRollback(),/busy_or_unrecovered/);
  }finally{f.cleanup()}
 });
}
test('unsigned or tampered L4 evidence never opens Native lease or DB mutation',()=>{
 const f=fixture();try{
  const cfg={...f.cfg,token:f.cfg.token.slice(0,-4)+'AAAA'};
  const e=Entry.createIsolatedNativeRootPath(cfg);
  assert.throws(()=>e.executeVerifiedRollback(),/signature_invalid|signature|jws/i);
  assert.equal(fs.existsSync(sharedFile(f)),true);
  assert.equal(fs.existsSync(nativeFile(f)),false);
  assert.equal(fs.existsSync(journalFile(f)),false);
  assert.equal(fs.existsSync(officialFence(f)),false);
 }finally{f.cleanup()}
});
test('tampered durable terminal journal cannot be used to release shared lock',()=>{
 const f=fixture();try{
  const e=Entry.createIsolatedNativeRootPath({...f.cfg,
   checkpoint:mark=>{
    if(mark==='rolled_back_journal'){
     const file=journalFile(f),j=JSON.parse(fs.readFileSync(file,'utf8'));
     j.state='PREPARED';
     fs.writeFileSync(file,JSON.stringify(j)+'\n');
    }
   }
  });
  assert.throws(()=>e.executeVerifiedRollback(),/native_terminal_journal_untrusted/);
  assert.equal(fs.existsSync(sharedFile(f)),true);
  assert.equal(fs.existsSync(nativeFile(f)),true);
 }finally{f.cleanup()}
});
test('no Root action, DB backup, network or production CLI is exported',()=>{
 assert.equal(Entry.ROOT_ACTION_REGISTERED,false);
 assert.equal(Entry.PRODUCTION_APPLY,false);
 assert.equal(Entry.NATIVE_BACKUP_EXECUTABLE,false);
 assert.equal(Entry.LEVEL4_ISSUER,false);
 assert.equal(Entry.runNativeBackup,undefined);
 const modulePath=path.join(__dirname,'honartik-u06-isolated-root-native-path-v1.cjs');
 const r=spawnSync(process.execPath,[modulePath],{encoding:'utf8'});
 assert.equal(r.status,64);
 assert.match(r.stderr,/no CLI or Production apply/);
});
