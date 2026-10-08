'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const a=require('./node1-vm-geometry-attestor-v1');
const e=require('./node1-vm-geometry-trusted-executor-v1');
const api=require('./node1-vm-geometry-agent-api-route-v1');
const t=Date.UTC(2026,9,8,19,0,0);
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
const secret=privateKey.export({format:'pem',type:'pkcs8'});
const n='NODE1ReadonlyProbeNonce0123456789';
function output(){
 const domains=['imotion-directadmin','prhm-production'].map((domain,i)=>({
  domain,source:'/var/lib/libvirt/images/'+domain+'.qcow2',
  ok:true,virtualBytes:(i+1)*1024**3,physicalBytes:(i+1)*1024**2,allocationBytes:(i+1)*1024**2,
  geometrySource:'qemu-img-info',guestAgentResponsive:true,mountedFilesystems:2,errors:[]
 }));
 return JSON.stringify({schema_version:api.SCHEMA,host:'server1.prhm.ir',readonly:true,
  production_mutation:false,ready_for_deployment:false,domains,all_domains_verified:true,totalVirtualBytes:3*1024**3})+'\n';
}
function params(extra={}){
 return {getPinned:rel=>fs.readFileSync(path.join(__dirname,rel)),
  run:output,loadKey:()=>secret,now:()=>t,nonce:()=>n,...extra};
}
function verifier(){return ({payload,signature,publicKeyPath})=>{
 assert.equal(publicKeyPath,e.PUBKEY_PATH);
 return crypto.verify(null,payload,publicKey,Buffer.from(signature,'base64'));};}
test('live-scope attestor pins exactly 3 source files and fixed key path',()=>{
 assert.deepEqual(a.PINNED.map(x=>x.path).sort(),[
 'node1-live-vm-backup-v1.js','node1-vm-geometry-readonly-v1.js','node1-vm-geometry-runner-v1.js']);
 assert.equal(a.SIGNING_KEY,'/etc/prhm-agent3/keys/node1-readonly-receipts-ed25519.pem');
 assert(a.PINNED.every(x=>/^[a-f0-9]{40}$/.test(x.sha)));
});
test('emits a real Ed25519 signed readonly report verified by receiving executor',()=>{
 const signed=a.makeBundle(params());
 assert.equal(typeof signed.stdout,'string');
 assert.equal(signed.receipt.readOnly,true);
 assert.equal(signed.receipt.sourceCommit,'8b2b7077d760bc0aaccf21f8ce503903bb19ff61');
 assert.equal(signed.receipt.runnerSourceGitBlob,'b0e96415aa6faa571a106fe75c678cfb3008fa88');
 const good=e.verifyTransportEvidence(signed,{
   verifyReceipt:verifier(),now:()=>t,seenNonce:()=>false
 });
 assert.equal(good.evidence.cryptographicReceiptVerified,true);
 assert.equal(good.all_domains_verified,true);
 assert.equal(good.ready_for_deployment,false);
});
test('mutated pinned runner source blocks before execution or key read',()=>{
 let invoked=false;
 assert.throws(()=>a.makeBundle(params({getPinned:rel=>{
    if(rel==='node1-vm-geometry-runner-v1.js')return Buffer.from('evil');
    return fs.readFileSync(path.join(__dirname,rel));
  },run:()=>{invoked=true;return output()}})),/node1_runner_source_sha_mismatch/);
 assert.equal(invoked,false);
});
test('no private signing key blocks a valid result',()=>{
 assert.throws(()=>a.makeBundle(params({loadKey:()=>{throw Error('signing key missing')}})),/signing key missing/);
 assert.throws(()=>a.makeBundle(params({loadKey:()=>Buffer.from('garbage')})),/attestor_private_key_unavailable/);
});
test('wrong key type is rejected even when PEM parses',()=>{
 const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({format:'pem',type:'pkcs8'});
 assert.throws(()=>a.makeBundle(params({loadKey:()=>rsa})),/attestor_wrong_key_type/);
});
test('unhealthy guest or unparseable diagnostic will never be signed',()=>{
 let keyRead=false;
 const red=JSON.parse(output());red.all_domains_verified=false;red.totalVirtualBytes=null;
 red.domains[0].ok=false;red.domains[0].errors=['guest_agent_unavailable'];
 red.domains[0].guestAgentResponsive=false;red.domains[0].virtualBytes=null;
 assert.throws(()=>a.makeBundle(params({run:()=>JSON.stringify(red),loadKey:()=>{keyRead=true;return secret}})),/node1_vm_diagnostics_red/);
 assert.equal(keyRead,false);
 assert.throws(()=>a.makeBundle(params({run:()=>'{bad json'})),/attestor_stdout_not_json/);
});
test('nonce entropy and valid time are mandatory',()=>{
 assert.throws(()=>a.makeBundle(params({nonce:()=>''})),/attestor_nonce_invalid/);
 assert.throws(()=>a.makeBundle(params({now:()=>Infinity})),/attestor_clock_untrusted/);
});
test('oversize stdout cannot be signed',()=>{
 assert.throws(()=>a.makeBundle(params({run:()=>output()+'a'.repeat(e.MAX_RESPONSE_BYTES)})),/attestor_stdout_invalid/);
});
test('CLI with no explicit readonly mode cannot run',()=>{
 for(const args of [[],['--sign'],['--readonly','--host','x']])
  assert.throws(()=>a.main(args),/only_readonly_attestation_supported/);
});
test('secret handling is bounded and root-only in real adapter, no repository PEM',()=>{
 const source=fs.readFileSync(path.join(__dirname,'node1-vm-geometry-attestor-v1.js'),'utf8');
 assert(source.includes('(st.mode&0o077)===0'));
 assert(source.includes('fs.constants.O_NOFOLLOW'));
 assert(!source.includes('-----BEGIN PRIVATE KEY-----'));
 assert(!source.includes('shell:true'));
});
