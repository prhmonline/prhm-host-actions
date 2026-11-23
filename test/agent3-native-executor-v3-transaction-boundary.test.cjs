'use strict';
/**
 * Isolated integration harness for the source-only v3 native Executor adapter.
 * The real root store, Approval Center, signed JWS verifier, and production
 * installer are NOT invoked; this tests trust-boundary ordering and denial.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {createRequire}=require('node:module');
const route=require('../ops/agent3-universal-backup/five-field-native-route-contract.cjs');
const registration=require('../ops/agent3-universal-backup/registration-contract.cjs');

const candidatePath=path.resolve(__dirname,
 '../ops/agent3-universal-backup/native-five-field-executor-v3-handlers.cjs');
const loadReal=createRequire(candidatePath);
const REQUEST_ID='f1234567-1234-4123-8123-123456789abc';
const VALID_INPUT=Object.freeze({
 action:registration.REGISTRY_ACTION,project:registration.PROJECT,
 source_commit:registration.SOURCE_COMMIT,
 manifest_commit:'a'.repeat(40),manifest_sha256:'b'.repeat(64)
});
const FAKE_JWS='eyJhbGciOiJFZERTQSJ9.'+'a'.repeat(100)+'.'+'b'.repeat(88);
function fixture(overrides={}){
 const events=[];
 const state={pending:null,installed:false,denySignature:false,
  denyPersistence:false,denyIssuerHash:false,denyConsumedHash:false,
  denyRootVerifier:false,denyPending:false,...overrides};
 const digest=route.prepareRequest(VALID_INPUT).arguments_sha256;
 const root={
  ISSUED_FIELDS:Object.freeze(['request_id','expires_at','action',
   'arguments_sha256','level','risk']),
  persistIssuedNativeRequest({input,issued}){
   events.push('root_persist');
   if(state.denyPersistence)throw Error('durable_store_unavailable');
   assert.equal(route.prepareRequest(input).arguments_sha256,digest);
   assert.equal(issued.arguments_sha256,digest);
   state.pending={...route.prepareRequest(input).storage_shape,
    request_id:issued.request_id,status:'pending',expires_at:issued.expires_at};
   return {request_id:issued.request_id,durable:true,exclusive:true,
    arguments_sha256:digest};
  },
  prepareApplyFromFixedRootStore(body){
   events.push('root_pending_lookup');
   if(state.denyPending||!state.pending)throw Error('pending_not_found');
   return route.prepareApply({body,persistedRequest:state.pending});
  },
  async applyFromFixedRootStore({body,signedApprovalToken,rootCapabilities}){
   events.push('root_cryptographic_and_consumed_ledger_check');
   assert.equal(body.request_id,REQUEST_ID);
   assert.ok(rootCapabilities);
   if(state.denySignature||state.denyRootVerifier||
      signedApprovalToken!==FAKE_JWS)
    throw Error('root_signature_or_consumed_ledger_rejected');
   state.installed=true;
   return Object.freeze({fixture_only:true,installed:true});
  }
 };
 const requireFixed=id=>id==='./native-root-request-entrypoints.cjs'
  ?root:loadReal(id);
 const moduleObj={exports:{}};
 vm.runInNewContext(fs.readFileSync(candidatePath,'utf8'),
  {module:moduleObj,require:requireFixed,Buffer,
   process:{getuid:()=>0,stderr:{write() {}}},
   Date}, {filename:'isolated-native-v3-executor.cjs',timeout:1500});
 const candidate=moduleObj.exports;
 let delayConfirm=null;
 const basePost=async(routePath,body)=>{
  if(routePath===candidate.REQUEST_PATH){
   events.push('base_issues_request');
   const expires_at=new Date(Date.now()+60000).toISOString();
   return {ok:true,request:{
    request_id:REQUEST_ID,expires_at,action:registration.REGISTRY_ACTION,
    arguments_sha256:state.denyIssuerHash?'0'.repeat(64):digest,
    level:4,risk:'critical'},arguments_sha256:digest};
  }
  if(routePath!=='/v3/agent3-registry/confirm-consume')
   throw Error('nonallowlisted_base_endpoint');
  events.push('base_consumes_approval');
  if(delayConfirm)await delayConfirm;
  return {ok:true,request_id:REQUEST_ID,
   arguments_sha256:state.denyConsumedHash?'0'.repeat(64):digest,
   approval_token:FAKE_JWS,consumed_by_approval_center:true,
   root_jws_verified:false};
 };
 const bound=candidate.bindTrustedExecutor({
  basePost,rootCapabilities:Object.freeze({fixtureRootVerifier:true})
 });
 return {events,state,bound,
  setConfirmDelay:promise=>{delayConfirm=promise;}};
}
function applyBody(){
 return {...VALID_INPUT,request_id:REQUEST_ID,
  second_confirmation:'CONFIRM_LEVEL_4_CRITICAL'};
}
test('request, root O_EXCL persistence, root precheck, consume, and independent root verifier run in that order',async()=>{
 const f=fixture();
 const issued=await f.bound.request(VALID_INPUT);
 assert.equal(issued.approved,false);
 assert.equal(issued.installed,false);
 assert.equal(issued.request_id,REQUEST_ID);
 const result=await f.bound.execute(applyBody());
 assert.equal(result.fixture_only,true);
 assert.equal(f.state.installed,true);
 assert.equal(f.events.join('>'),[
  'base_issues_request','root_persist','root_pending_lookup',
  'base_consumes_approval','root_cryptographic_and_consumed_ledger_check'
 ].join('>'));
});
test('bad issuer digest cannot reach root pending persistence',async()=>{
 const f=fixture({denyIssuerHash:true});
 await assert.rejects(f.bound.request(VALID_INPUT),/issuer_request_binding/);
 assert.equal(f.events.includes('root_persist'),false);
 assert.equal(f.state.installed,false);
});
test('root persistence failure denies even a syntactically issued request',async()=>{
 const f=fixture({denyPersistence:true});
 await assert.rejects(f.bound.request(VALID_INPUT),/durable_store_unavailable/);
 assert.equal(f.state.installed,false);
});
test('no persisted pending request means no approval decision/consume',async()=>{
 const f=fixture();
 await assert.rejects(f.bound.execute(applyBody()),/pending_not_found/);
 assert.equal(f.events.includes('base_consumes_approval'),false);
});
test('bound request mutation cannot consume approval',async()=>{
 const f=fixture();
 await f.bound.request(VALID_INPUT);
 await assert.rejects(f.bound.execute({...applyBody(),
  manifest_sha256:'c'.repeat(64)}),/denied|mismatch|drift/);
 assert.equal(f.events.includes('base_consumes_approval'),false);
});
test('mismatched Base consumed hash denies BEFORE calling root installer',async()=>{
 const f=fixture({denyConsumedHash:true});
 await f.bound.request(VALID_INPUT);
 await assert.rejects(f.bound.execute(applyBody()),/base_consumed_receipt_untrusted_or_unbound/);
 assert.equal(f.events.includes('root_cryptographic_and_consumed_ledger_check'),false);
 assert.equal(f.state.installed,false);
});
test('Base consumed flag does not bypass independent root verifier',async()=>{
 const f=fixture({denyRootVerifier:true});
 await f.bound.request(VALID_INPUT);
 await assert.rejects(f.bound.execute(applyBody()),/root_signature_or_consumed_ledger_rejected/);
 assert.equal(f.state.installed,false);
 assert.equal(f.events.at(-1),'root_cryptographic_and_consumed_ledger_check');
});
test('same-process concurrent execute refuses second operation',async()=>{
 const f=fixture();
 await f.bound.request(VALID_INPUT);
 let release;
 const wait=new Promise(resolve=>{release=resolve;});
 f.setConfirmDelay(wait);
 const first=f.bound.execute(applyBody());
 await assert.rejects(f.bound.execute(applyBody()),/same_process_execution_inflight/);
 release();
 await first;
 assert.equal(f.events.filter(x=>x==='base_consumes_approval').length,1);
});
