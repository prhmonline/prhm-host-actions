'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const ledger=require('./solo-universal-v2-owner-ledger-fixture-v1.cjs');
const binding=require('./solo-universal-v2-host-action-binding-candidate-v1.cjs');
const rootName=()=>path.join(os.tmpdir(),'solo-universal-v2-ledger-fixture-'+
  crypto.randomBytes(8).toString('hex'));
function fx(t){
  const root=rootName();
  ledger.init(root);
  t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  return root;
}
const now=1794449000;
const receipt=()=>({
  signature_verified:true,operation:binding.OPERATION,source_only:true,
  consumed:false,production_authorized:false,
  independent_root_executor_required:true,
  request_id:crypto.randomUUID(),jti:crypto.randomUUID(),exp:now+60
});

test('offline private ledger is durable and permanent after recovery',t=>{
  const root=fx(t);
  const grant=receipt();
  const consumed=ledger.consumeFixture(root,grant,now);
  assert.equal(consumed.status,'FIXTURE_RECEIPT_CONSUMED');
  assert.equal(consumed.production_modified,false);
  assert.equal(fs.existsSync(path.join(root,'ledger',grant.jti+'.json')),true);
  const recovered=ledger.reconcileFixture(root,grant.request_id);
  assert.equal(recovered.status,'ROLLED_BACK');
  assert.equal(recovered.receipt_still_consumed,true);
  assert.throws(()=>ledger.consumeFixture(root,grant,now),/replay_or_transaction_exists/);
});
test('tampered, expired, unverified or old-operation receipt is refused',t=>{
  const root=fx(t);
  const grant=receipt();
  for(const [key,value] of Object.entries({
    signature_verified:false,
    operation:'host_action.solo_company_runtime_registration_v1',
    production_authorized:true,source_only:false,consumed:true,
    independent_root_executor_required:false,
    jti:'not-a-uuid',request_id:'../../etc/passwd'
  })){
    assert.throws(()=>ledger.consumeFixture(root,{...grant,[key]:value},now),
      /unverified_owner_grant/,key);
  }
  assert.throws(()=>ledger.consumeFixture(root,grant,now+61),
    /expired_receipt/);
  assert.equal(fs.readdirSync(path.join(root,'ledger')).length,0);
});
test('outside /tmp or fake fixture is always denied',t=>{
  const root=fx(t);
  const grant=receipt();
  assert.throws(()=>ledger.consumeFixture('/var/lib/prhm-agent-selfmaint-exec',
    grant,now),/outside_private_fixture/);
  fs.writeFileSync(path.join(root,'.fixture'),'attacker');
  assert.throws(()=>ledger.consumeFixture(root,grant,now),
    /fixture_marker_missing/);
});
test('tampered ledger prevents recovery',t=>{
  const root=fx(t);
  const grant=receipt();
  ledger.consumeFixture(root,grant,now);
  const file=path.join(root,'ledger',grant.jti+'.json');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  data.operation='other';
  fs.writeFileSync(file,JSON.stringify(data));
  assert.throws(()=>ledger.reconcileFixture(root,grant.request_id),
    /ledger_journal_mismatch/);
});
test('receipt replay cannot switch request ids or consume a JTI twice',t=>{
  const root=fx(t);
  const grant=receipt();
  ledger.consumeFixture(root,grant,now);
  assert.throws(()=>ledger.consumeFixture(root,{
    ...grant,request_id:crypto.randomUUID()
  },now),/replay_or_transaction_exists/);
});
test('no production entrypoint or root mutation methods exported',()=>{
  const file=path.join(__dirname,'solo-universal-v2-owner-ledger-fixture-v1.cjs');
  const source=fs.readFileSync(file,'utf8');
  for(const method of ['applyProduction','restartSolo','registerAction','issueGrant'])
    assert.equal(typeof ledger[method],'undefined');
  for(const pattern of [/systemctl restart/,/execSync\(/,/spawnSync\(/,
    /\/etc\/deploy-control\/projects\/solo_company\.production\.json/,
    /\/usr\/local\/libexec\/deploy-control\/universal\/current/])
    assert.doesNotMatch(source,pattern);
  const processRun=cp.spawnSync(process.execPath,[file],{encoding:'utf8'});
  assert.equal(processRun.status,64);
  assert.match(processRun.stderr,/SOURCE_ONLY_NO_PRODUCTION_ROOT_DRIVER/);
});
