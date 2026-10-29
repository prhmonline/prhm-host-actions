'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const store=require('./shared-registrar-pending-store-v1.cjs');
const bridge=require('./prhm-action-registry-host-actions-v2-bridge-v1.cjs');
const g=require('./prhm-action-registry-gateway-v1.cjs');

const UUID='66666666-6666-4666-8666-666666666666';
const input=()=>({action:g.ACTION,project:'pbcinema',
 source_commit:'a'.repeat(40),manifest_commit:'b'.repeat(40),
 manifest_sha256:'c'.repeat(64)});
function pending(now=Date.now(),id=UUID){
 const args=input();
 return bridge.bindPendingRequest(args,{
  schema_version:'prhm.approval-request.v2',request_id:id,
  status:'pending',action:g.ACTION,operation:g.OPERATION,
  tool:'host_action_v2_apply',project:'control_plane',
  environment:'production',principal_id:'mohammad',role:'mcp-operator',
  level:4,risk:'critical',one_time_use:true,
  policy_version:g.POLICY_VERSION,policy_hash:'f'.repeat(64),
  arguments_sha256:g.approvalBindingSha(args),
  request_hash:g.approvalBindingSha(args),
  expires_at:new Date(now+90000).toISOString(),
  rollback_reference:bridge.typedApprovalRequest(args).rollback_reference
 },now);
}
function sandbox(t){
 const dir=fs.mkdtempSync('/tmp/registrar-ci-');
 fs.chmodSync(dir,0o700);
 for(const sub of ['pending','claimed'])fs.mkdirSync(path.join(dir,sub),{mode:0o700});
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return {dir,instance:store.openDisposableTestStore(dir)};
}
test('root store has one fixed production path, no public server/CLI',()=>{
 assert.equal(store.DIR,'/var/lib/prhm-agent-selfmaint-exec/registrar-pending-v1');
 assert.equal(Object.isFrozen(store),true);
 assert.deepEqual(Object.keys(store).sort(),
  ['DIR','openDisposableTestStore','openProductionStore']);
 assert.throws(()=>store.openDisposableTestStore('/etc'),/sandbox_path_restricted/);
 const run=cp.spawnSync(process.execPath,[path.join(__dirname,
  'shared-registrar-pending-store-v1.cjs')],{encoding:'utf8'});
 assert.equal(run.status,64);
 assert.match(run.stderr,/No standalone registry store/);
});
test('pending request is durable, root-equivalent owner mode 0600, and read back by exact UUID',t=>{
 const {dir,instance}=sandbox(t),p=pending();
 assert.equal(instance.writePendingExclusive(p),true);
 const filename=path.join(dir,'pending',UUID+'.json');
 const st=fs.statSync(filename);
 assert.equal(st.mode&0o777,0o600);
 assert.equal(st.uid,process.getuid());
 assert.deepEqual(instance.readPending(UUID),p);
 const data=fs.readFileSync(filename,'utf8');
 assert.equal(data.includes('approval_token'),false);
 assert.equal(data.includes('privateKey'),false);
 assert.throws(()=>instance.writePendingExclusive(p),e=>e.code==='EEXIST');
});
test('first exclusive claim permanently prevents replay, including new store instance',t=>{
 const {dir,instance}=sandbox(t),p=pending();
 instance.writePendingExclusive(p);
 assert.equal(instance.claimPendingAtomically(p),true);
 const filename=path.join(dir,'claimed',UUID+'.json');
 const st=fs.statSync(filename);
 assert.equal(st.mode&0o777,0o600);
 const claim=JSON.parse(fs.readFileSync(filename));
 assert.deepEqual(claim.request_id,UUID);
 assert.deepEqual(claim.arguments_sha256,p.arguments_sha256);
 assert.equal(claim.state,'CLAIMED_FAIL_CLOSED');
 assert.throws(()=>instance.readPending(UUID),/already_claimed/);
 assert.throws(()=>instance.claimPendingAtomically(p),/already_claimed/);
 const reopened=store.openDisposableTestStore(dir);
 assert.throws(()=>reopened.readPending(UUID),/already_claimed/);
});
test('different tuple and tampered pending bytes never reach claim',t=>{
 const {dir,instance}=sandbox(t),p=pending();
 instance.writePendingExclusive(p);
 assert.throws(()=>instance.claimPendingAtomically({...p,project:'honartik'}),
  /pending_execution_binding_invalid|record_changed_since_read/);
 assert.equal(fs.existsSync(path.join(dir,'claimed',UUID+'.json')),false);
 const file=path.join(dir,'pending',UUID+'.json');
 fs.writeFileSync(file,JSON.stringify({...p,project:'honartik'})+'\n');
 assert.throws(()=>instance.readPending(UUID),
  /pending_execution_binding_invalid/);
 assert.throws(()=>instance.claimPendingAtomically(p),
  /record_changed_since_read/);
});
test('symlinked pending record and corrupted record fail closed',t=>{
 const {dir,instance}=sandbox(t),p=pending();
 const other=path.join(dir,'decoy'),f=path.join(dir,'pending',UUID+'.json');
 fs.writeFileSync(other,'{}',{mode:0o600});
 fs.symlinkSync(other,f);
 assert.throws(()=>instance.readPending(UUID),/file_untrusted/);
 fs.unlinkSync(f);
 fs.writeFileSync(f,'not-json',{mode:0o600});
 assert.throws(()=>instance.readPending(UUID),/record_json_invalid/);
});
test('unsafe store or subdirectory metadata stops processing',t=>{
 const {dir}=sandbox(t),d=path.join(dir,'pending');
 fs.chmodSync(d,0o755);
 assert.throws(()=>store.openDisposableTestStore(dir),/directory_untrusted/);
 fs.chmodSync(d,0o700);
 const i=store.openDisposableTestStore(dir);
 fs.chmodSync(dir,0o777);
 assert.throws(()=>i.writePendingExclusive(pending()),/directory_untrusted|directory_path_unsafe/);
 fs.chmodSync(dir,0o700);
});
test('SIGKILL after durable claim never returns a reusable pending state',t=>{
 const {dir,instance}=sandbox(t),p=pending();
 instance.writePendingExclusive(p);
 const runner=[
  'const m=require(process.argv[1]);',
  'const s=m.openDisposableTestStore(process.argv[2]);',
  'const p=JSON.parse(process.argv[3]);',
  'if(s.claimPendingAtomically(p)!==true)process.exit(2);',
  'process.kill(process.pid,"SIGKILL");'
 ].join('');
 const child=cp.spawnSync(process.execPath,['-e',runner,
  path.join(__dirname,'shared-registrar-pending-store-v1.cjs'),
  dir,JSON.stringify(p)],{encoding:'utf8',timeout:3000});
 assert.equal(child.signal,'SIGKILL');
 assert.throws(()=>store.openDisposableTestStore(dir).readPending(UUID),
  /already_claimed/);
 assert.throws(()=>instance.claimPendingAtomically(p),/already_claimed/);
});
