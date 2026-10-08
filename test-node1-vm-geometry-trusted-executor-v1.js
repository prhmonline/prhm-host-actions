'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const e=require('./node1-vm-geometry-trusted-executor-v1');
const api=require('./node1-vm-geometry-agent-api-route-v1');
const FIXED_NOW=Date.UTC(2026,9,8,19,0,0);
const key=crypto.generateKeyPairSync('ed25519');
const nonce='Node1ReadOnlyNonce_ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function cleanOutput(){
 const domains=['imotion-directadmin','prhm-production'].map((domain,i)=>({
   domain,ok:true,source:'/var/lib/libvirt/images/'+domain+'.qcow2',
   virtualBytes:(i+1)*1024**3,physicalBytes:(i+1)*512*1024**2,
   allocationBytes:(i+1)*512*1024**2,geometrySource:'qemu-img-info',
   guestAgentResponsive:true,mountedFilesystems:2,errors:[]
 }));
 return JSON.stringify({schema_version:api.SCHEMA,host:'server1.prhm.ir',readonly:true,
 production_mutation:false,ready_for_deployment:false,all_domains_verified:true,
 domains,totalVirtualBytes:3*1024**3});
}
function produce({stdout=cleanOutput(),completedUtc=new Date(FIXED_NOW).toISOString(),nonceId=nonce,other={}}={}){
 const request=e.fixedRequest();
 const receipt={operation:request.operation,host:request.host,runnerPath:request.runnerPath,
 runnerSourceGitBlob:request.runnerSourceGitBlob,sourceCommit:request.sourceCommit,
 argv:['--readonly'],exitCode:0,outputSha256:crypto.createHash('sha256').update(stdout).digest('hex'),
 completedUtc,nonce:nonceId,readOnly:true,...other};
 const signature=crypto.sign(null,Buffer.from(JSON.stringify(receipt)),key.privateKey).toString('base64');
 return {stdout,receipt,signature};
}
function verifier(){return ({payload,signature,publicKeyPath})=>{
 assert.equal(publicKeyPath,e.PUBKEY_PATH);
 return crypto.verify(null,payload,key.publicKey,Buffer.from(signature,'base64'))};
}
function singleUse(){const seen=new Set();return n=>{if(seen.has(n))return true;seen.add(n);return false}}
test('trusted fixed request pins exact host, source commit, Git runner blob and CLI arguments',()=>{
 const r=e.fixedRequest();
 assert.equal(r.host,'server1.prhm.ir');
 assert.equal(r.runnerPath,'/opt/prhm-node1-readonly/vm-geometry-v1/node1-vm-geometry-runner-v1.js');
 assert.equal(r.runnerSourceGitBlob,'b0e96415aa6faa571a106fe75c678cfb3008fa88');
 assert.equal(r.sourceCommit,'8b2b7077d760bc0aaccf21f8ce503903bb19ff61');
 assert.deepEqual(r.argv,['--readonly']);assert.equal(r.readOnly,true);assert.equal(r.mutation,false);
 assert(Object.isFrozen(r.argv));assert(Object.isFrozen(r));
});
test('real Ed25519 receipt verification and zero-input API transport produce sanitized result',async()=>{
 let called=0;const result=produce();
 const executor=e.makeTrustedExecutor({
  transport:{async runFixed(request){called++;assert.equal(request.operation,api.OP);return result}},
  verifyReceipt:verifier(),now:()=>FIXED_NOW,seenNonce:singleUse()
 });
 const done=await executor(api.OP,{});
 assert.equal(called,1);assert.equal(done.all_domains_verified,true);
 assert.equal(done.evidence.cryptographicReceiptVerified,true);
 assert.equal(done.domains.length,2);
 assert(!JSON.stringify(done).includes('/var/lib/libvirt/images/'));
 assert.equal(done.ready_for_deployment,false);
});
test('reject arbitrary operation and parameters before any transport call',async()=>{
 let called=false;
 const executor=e.makeTrustedExecutor({transport:{async runFixed(){called=true;return produce()}},verifyReceipt:verifier(),now:()=>FIXED_NOW,seenNonce:singleUse()});
 await assert.rejects(executor('virsh_destroy',{}),/not_fixed_node1_operation/);
 await assert.rejects(executor(api.OP,{host:'other'}),/not_fixed_node1_operation/);
 assert.equal(called,false);
});
test('deny malformed, unsigned or changed Ed25519 proof',()=>{
 for(const mutation of [
  r=>r.signature='a'.repeat(86)+'==',
  r=>r.stdout=r.stdout.replace('prhm-production','evil-production'),
  r=>r.receipt.host='attacker.example'
 ]){
  const r=produce();mutation(r);
  assert.throws(()=>e.verifyTransportEvidence(r,{verifyReceipt:verifier(),now:()=>FIXED_NOW,seenNonce:singleUse()}));
 }
});
test('expired evidence is refused even when cryptographically valid',()=>{
 const r=produce({completedUtc:new Date(FIXED_NOW-3600*1000).toISOString()});
 assert.throws(()=>e.verifyTransportEvidence(r,{verifyReceipt:verifier(),now:()=>FIXED_NOW,seenNonce:singleUse()}),/receipt_stale_or_future/);
});
test('signed receipt binds exact runner source, commit and read-only exit code',()=>{
 for(const item of [
  {sourceCommit:'0'.repeat(40)},
  {runnerSourceGitBlob:'f'.repeat(40)},
  {exitCode:1},
  {readOnly:false},
  {runnerPath:'/tmp/evil.js'}
 ]){
  const r=produce({other:item});
  assert.throws(()=>e.verifyTransportEvidence(r,{verifyReceipt:verifier(),now:()=>FIXED_NOW,seenNonce:singleUse()}));
 }
});
test('nonce reuse is refused for a second read-only receipt',()=>{
 const r=produce(),used=singleUse();
 const options={verifyReceipt:verifier(),now:()=>FIXED_NOW,seenNonce:used};
 assert.equal(e.verifyTransportEvidence(r,options).all_domains_verified,true);
 assert.throws(()=>e.verifyTransportEvidence(r,options),/receipt_replayed/);
});
test('no public-key pin verifier or nonce-store means fail-closed',()=>{
 const r=produce();
 assert.throws(()=>e.verifyTransportEvidence(r,{now:()=>FIXED_NOW}),/trusted_receipt_verifier_missing/);
 assert.throws(()=>e.makeTrustedExecutor({transport:{runFixed:()=>r},verifyReceipt:verifier()}),/trusted_agent3_components_not_registered/);
});
test('signed but red VM evidence cannot be promoted to green',()=>{
 const x=JSON.parse(cleanOutput());x.domains[1].ok=false;x.domains[1].errors=['guest_agent_error'];
 x.domains[1].guestAgentResponsive=false;x.domains[1].virtualBytes=null;
 x.all_domains_verified=false;x.totalVirtualBytes=null;
 const r=produce({stdout:JSON.stringify(x)});
 assert.throws(()=>e.verifyTransportEvidence(r,{verifyReceipt:verifier(),now:()=>FIXED_NOW,seenNonce:singleUse()}),/node1_probe_not_green/);
});
test('bounded response and unavailable transport prevent success',async()=>{
 const huge=produce({stdout:'X'.repeat(e.MAX_RESPONSE_BYTES+1)});
 assert.throws(()=>e.verifyTransportEvidence(huge,{verifyReceipt:verifier(),now:()=>FIXED_NOW,seenNonce:singleUse()}),/transport_output_invalid/);
 const x=e.makeTrustedExecutor({transport:{async runFixed(){throw Error('Agent3 Node1 transport unavailable')}},verifyReceipt:verifier(),now:()=>FIXED_NOW,seenNonce:singleUse()});
 await assert.rejects(()=>x(api.OP,{}),/Agent3 Node1 transport unavailable/);
});
