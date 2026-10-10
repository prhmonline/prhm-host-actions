'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const {stableRemoteProof,plan,hash,PREIMAGE_SHA256}=require('./central-offsite-rclone-proof-v1.js');
const size=1328373760,name='20261010T092103Z.restic-repo.tar',remote='gdrive-backup:PRHM-Backups/bundles/central/'+name;
function item(s=size){return {exit_code:0,error:null,stdout:JSON.stringify({Name:name,Path:name,IsDir:false,Size:s}),stderr:''}}
function failure(stderr){return {exit_code:1,error:null,stdout:'',stderr}}
function status(value){return {exit_code:0,error:null,stdout:value,stderr:''}}
function run(entries){
  let index=0,args=[];
  const audit=(bin,argv,timeout)=>{args.push({bin,argv,timeout});return entries[index++]||failure('remote temporary failure')};
  const result=stableRemoteProof(audit,'rclone-binary','/etc/prhm-rclone/rclone.conf',remote,name,size);
  return {result,args};
}
test('two exact-byte checks required, stat only',()=>{
  const {result,args}=run([item(),item()]);
  assert.equal(result.ok,true);assert.equal(result.status,'verified');assert.equal(result.attempts.length,2);
  for(const a of args){assert.equal(a.argv[0],'lsjson');assert.equal(a.argv[1],remote);assert.equal(a.argv[2],'--stat');assert.ok(!a.argv.includes('copy'));assert.ok(!a.argv.includes('delete'))}
});
test('timeout then two successes allowed, no false missing',()=>{
  const {result}=run([failure('context deadline exceeded'),item(),item()]);
  assert.equal(result.ok,true);assert.deepEqual(result.attempts.map(x=>x.status),['transport_error','match','match']);
});
test('1 0 1 1 sequence requires last consecutive confirmations',()=>{
  const {result}=run([item(),failure('couldn\'t find root directory ID: Get'),item(),item()]);
  assert.equal(result.ok,true);assert.deepEqual(result.attempts.map(x=>x.status),['match','transport_error','match','match']);
});
test('persistent transient failures never green and not labeled deleted',()=>{
  const {result}=run(Array.from({length:4},()=>failure('couldn\'t find root directory ID: Get')));
  assert.equal(result.ok,false);assert.equal(result.status,'indeterminate');assert.equal(result.attempts.length,4);
  assert.ok(result.attempts.every(x=>x.status==='transport_error'));
});
test('rate limit and access failures redacted and never auto-green',()=>{
  const {result}=run([failure('429 quotaExceeded secret=SHOULD_NOT_LEAK'),failure('403 permission denied'),failure('401 invalid_grant'),failure('404 filesystem missing')]);
  assert.equal(result.ok,false);assert.equal(result.status,'indeterminate');assert.deepEqual(result.attempts.map(x=>x.status),['rate_limited','access_error','access_error','remote_stat_error']);
  assert.ok(!JSON.stringify(result).includes('SHOULD_NOT_LEAK'));
});
test('wrong-size response immediately fails closed',()=>{
  const {result}=run([item(size-1),item(),item()]);
  assert.equal(result.ok,false);assert.equal(result.status,'integrity_mismatch');assert.equal(result.attempts.length,1);
});
test('empty, malformed, and mismatched file stat never green',()=>{
  const wrong=JSON.stringify({Name:'unrelated.tar',Path:'unrelated.tar',Size:size});
  const {result}=run([status('null'),status('not json'),status(wrong),item()]);
  assert.equal(result.ok,false);assert.deepEqual(result.attempts.map(x=>x.status),['inconclusive_stat','invalid_json','inconclusive_stat','match']);
});
test('plan rejects any preimage other than exact live source',()=>{
  assert.throws(()=>plan('const x=1'),/PREIMAGE_SHA256_MISMATCH/);
  assert.match(PREIMAGE_SHA256,/^[0-9a-f]{64}$/);
});
test('CLI has no write/apply operation',()=>{
  const script=path.join(__dirname,'central-offsite-rclone-proof-v1.js');
  const ret=cp.spawnSync(process.execPath,[script,'--apply'],{encoding:'utf8',timeout:5000});
  assert.equal(ret.status,2);assert.match(ret.stderr,/READ_ONLY_ONLY/);
});
