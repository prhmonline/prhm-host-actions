'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),cp=require('node:child_process');
const journal=require('../ops/agent3-universal-backup/durable-execution-claim.cjs');
const contract=require('../ops/agent3-universal-backup/registration-contract.cjs');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const sha=buf=>crypto.createHash('sha256').update(buf).digest('hex');
function input(request_id='11111111-1111-4111-8111-111111111111'){
 const args={action:contract.REGISTRY_ACTION,project:contract.PROJECT,
  source_commit:contract.SOURCE_COMMIT,manifest_commit:'b'.repeat(40),
  manifest_sha256:'c'.repeat(64)};
 return {request_id,arguments_sha256:gateway.approvalBindingSha(args),
  ...args,target_action:contract.INSTALL_ACTION};
}
function withDir(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prhm-claim-'));
 fs.chmodSync(dir,0o700);
 try{return fn(dir,process.getuid())}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('a root-journal claim is durable, exact-five-field-bound, O_EXCL and non-replayable',()=>{
 withDir((dir,uid)=>{
  const x=input();
  const first=journal.claimInVerifiedDirectory(x,dir,uid);
  assert.deepEqual(first,{claimed:true,durable:true,exclusive:true,
   request_id:x.request_id,arguments_sha256:x.arguments_sha256});
  const filename=path.join(dir,x.request_id+'.claim');
  const st=fs.lstatSync(filename);
  assert.ok(st.isFile());
  assert.equal(st.mode&0o077,0);
  const body=JSON.parse(fs.readFileSync(filename,'utf8'));
  assert.equal(body.schema,'prhm.agent3.execution-claim.v1');
  assert.equal(body.arguments_sha256,x.arguments_sha256);
  assert.equal(Object.hasOwn(body,'token'),false);
  assert.deepEqual(journal.claimInVerifiedDirectory(x,dir,uid),
   {...first,claimed:false});
 });
});
test('same request identifier cannot be replayed even if new valid manifest digest is supplied',()=>{
 withDir((dir,uid)=>{
  const a=input(),b=input();
  b.manifest_commit='d'.repeat(40);
  b.arguments_sha256=gateway.approvalBindingSha({
   action:b.action,project:b.project,source_commit:b.source_commit,
   manifest_commit:b.manifest_commit,manifest_sha256:b.manifest_sha256});
  assert.equal(journal.claimInVerifiedDirectory(a,dir,uid).claimed,true);
  assert.equal(journal.claimInVerifiedDirectory(b,dir,uid).claimed,false);
 });
});
test('two simultaneous claims using filesystem O_EXCL accept exactly one',async()=>{
 await withDir(async(dir,uid)=>{
  const x=input();
  const out=await Promise.all([
    Promise.resolve().then(()=>journal.claimInVerifiedDirectory(x,dir,uid)),
    Promise.resolve().then(()=>journal.claimInVerifiedDirectory(x,dir,uid))
  ]);
  assert.equal(out.filter(r=>r.claimed===true).length,1);
  assert.equal(out.filter(r=>r.claimed===false).length,1);
 });
});
test('existing empty crash marker is never automatically erased or retried',()=>{
 withDir((dir,uid)=>{
  const x=input(),file=path.join(dir,x.request_id+'.claim');
  fs.writeFileSync(file,'',{flag:'wx',mode:0o600});
  assert.equal(journal.claimInVerifiedDirectory(x,dir,uid).claimed,false);
  assert.equal(fs.readFileSync(file,'utf8'),'');
 });
});
test('symlinked or insecure claim directory is denied before any file write',()=>{
 withDir((dir,uid)=>{
  const insecure=path.join(dir,'insecure');
  fs.mkdirSync(insecure,{mode:0o777});
  fs.chmodSync(insecure,0o777);
  assert.throws(()=>journal.claimInVerifiedDirectory(input(),insecure,uid),
   /untrusted_claim_directory/);
  const link=path.join(dir,'symlink');
  fs.symlinkSync(insecure,link);
  assert.throws(()=>journal.claimInVerifiedDirectory(input(),link,uid),
   /untrusted_directory_path/);
  assert.equal(fs.readdirSync(insecure).length,0);
 });
});
test('malformed request, wrong target or forged five-field digest are denied',()=>{
 withDir((dir,uid)=>{
  for(const mutate of [
   x=>{x.request_id='../escape'},
   x=>{x.action='host_action_v2_installer_v1'},
   x=>{x.target_action='drtarjomeh_security_containment_v1'},
   x=>{x.arguments_sha256='0'.repeat(64)},
   x=>{x.manifest_commit='not-a-commit'},
   x=>{x.project='honartik'},
   x=>{x.extra='rm -rf /'}
  ]){
   const x=input();mutate(x);
   assert.throws(()=>journal.claimInVerifiedDirectory(x,dir,uid));
  }
  assert.equal(fs.readdirSync(dir).length,0);
 });
});
test('module has no arbitrary standalone execution path and requires fixed root for live calls',()=>{
 const file=path.join(__dirname,'../ops/agent3-universal-backup/durable-execution-claim.cjs');
 const result=cp.spawnSync(process.execPath,[file,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,78);
 assert.match(result.stderr,/No CLI execution-claim write/);
 assert.equal(journal.ROOT,'/var/lib/prhm-agent-selfmaint-exec/agent3-backup-execution-claims');
 if(process.getuid?.()!==0){
  assert.throws(()=>journal.claimExecutionOnce(input()),/root_required/);
 }
});
