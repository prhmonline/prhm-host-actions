'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const observed=require('../ops/agent3-universal-backup/operator-owner-sha-observation.json');
const contract=require('../ops/agent3-universal-backup/production-registration-contract.json');
const {OWNERS,SERVICES}=require('../ops/agent3-universal-backup/four-owner-readonly-preflight.cjs');
const SHA=/^[a-f0-9]{64}$/;
function check(o){
 if(o.schema!=='prhm.agent3.operator-readonly-observation.v1'||
    o.evidence_type!=='operator_supplied_terminal_output'||o.target_host!=='prhm-production')
   throw Error('invalid_observation_identity');
 if(o.operator_reported_only!==true||
    o.authenticated_host_attestation!==false||
    o.execution_time_recheck_required!==true||
    o.approval_consumed!==false||o.installation_completed!==false)
   throw Error('operator_observation_not_approval');
 const ownerKeys=Object.keys(OWNERS).sort();
 if(Object.keys(o.owner_sha256||{}).sort().join('|')!==ownerKeys.join('|'))
   throw Error('unexpected_owner_keys');
 for(const key of ownerKeys){
  if(!SHA.test(o.owner_sha256[key])||
     o.owner_sha256[key]!==contract.preimage_sha256[key])
    throw Error('operator_sha_drift:'+key);
 }
 if(Object.keys(o.services||{}).sort().join('|')!==[...SERVICES].sort().join('|'))
   throw Error('unexpected_service_keys');
 for(const name of SERVICES){
  if(o.services[name]!=='active')throw Error('service_not_active:'+name);
 }
 return {reported_sha_matches:4,reported_active_services:4,
         signed_attestation:false,production_registration:false};
}
test('operator read-only SHA values match all four pinned contract preimages',()=>{
 const x=check(observed);
 assert.deepEqual(x,{reported_sha_matches:4,reported_active_services:4,
                       signed_attestation:false,production_registration:false});
});
test('a stale owner SHA or a stopped service must never be counted as preflight match',()=>{
 for(const k of Object.keys(OWNERS)){
  const bad=structuredClone(observed);
  bad.owner_sha256[k]='a'.repeat(64);
  assert.throws(()=>check(bad),/operator_sha_drift/);
 }
 for(const s of SERVICES){
  const bad=structuredClone(observed);
  bad.services[s]='failed';
  assert.throws(()=>check(bad),/service_not_active/);
 }
});
test('reported output is never upgraded into signed authorization by a boolean flip',()=>{
 for(const mutation of [
  x=>{x.authenticated_host_attestation=true;},
  x=>{x.approval_consumed=true;},
  x=>{x.installation_completed=true;},
  x=>{x.operator_reported_only=false;},
  x=>{x.execution_time_recheck_required=false;}
 ]){
  const x=structuredClone(observed);
  mutation(x);
  assert.throws(()=>check(x),/operator_observation_not_approval/);
 }
});
