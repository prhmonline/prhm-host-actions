'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const cp=require('node:child_process'),path=require('node:path');
const {verify,KEYS}=require('../ops/agent3-universal-backup/verify-pinned-owner-preimages.cjs');
const {OWNERS,SERVICES}=require('../ops/agent3-universal-backup/four-owner-readonly-preflight.cjs');
function sha(x){return crypto.createHash('sha256').update(x).digest('hex');}
function fixture(){
 const pinned=Object.fromEntries(KEYS.map(k=>[k,sha('fixture:'+k)]));
 const contract={schema:'prhm.agent3.universal-backup.registration-contract.v1',
   action:'agent3_universal_backup_engine_install_v1',
   status:'registration_candidate_not_applied',host:'prhm-production',
   approval:{level:4,one_time_signed_approval_required:true},preimage_sha256:pinned};
 const owners=Object.fromEntries(KEYS.map(k=>[k,{path:OWNERS[k],sha256:pinned[k],size:200}]));
 const evidence={schema:'prhm.agent3.registry-owner-evidence.v1',
    mode:'READ_ONLY_PREFLIGHT',production_mutation:false,
    enrollment_authorized:false,cryptographically_signed:false,
    owner_count:4,service_count:4,owners,hashes:{...pinned},
    services:SERVICES.map(unit=>({unit,active:true,running:true,loaded:true}))};
 return {evidence,contract};
}
test('four live owner SHA matches are a preinstall evidence gate, never approval',()=>{
 const v=verify(fixture());
 assert.equal(v.ok,true);
 assert.equal(v.owner_count,4);
 assert.equal(v.approval_consumed,false);
 assert.equal(v.registration_installed,false);
 assert.equal(v.installation_complete,false);
 assert.equal(v.rollback_tested,false);
});
test('mismatched or stale original SHA aborts before any registration',()=>{
 for(const k of KEYS){
  const x=fixture();x.evidence.hashes[k]=sha('changed '+k);
  x.evidence.owners[k].sha256=x.evidence.hashes[k];
  assert.throws(()=>verify(x),new RegExp('preimage_mismatch:'+k));
 }
});
test('fail closed on partial evidence, forged permissions and changed host',()=>{
 for(const modify of [
  x=>{x.evidence.owner_count=3},
  x=>{x.evidence.services[0].running=false},
  x=>{x.contract.host='other-host'},
  x=>{x.contract.approval.level=3},
  x=>{delete x.contract.preimage_sha256.mcp},
  x=>{x.evidence.owners.base.path='/tmp/untrusted'}
 ]){
  const v=fixture();modify(v);assert.throws(()=>verify(v));
 }
});
test('there is no CLI apply, stage, token or registration route',()=>{
 const f=path.join(__dirname,'../ops/agent3-universal-backup/verify-pinned-owner-preimages.cjs');
 const x=cp.spawnSync(process.execPath,[f,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(x.status,64);
 assert.match(x.stderr,/read-only --check only/);
});
