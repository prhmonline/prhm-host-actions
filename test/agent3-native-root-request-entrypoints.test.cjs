'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const cp=require('node:child_process');
const path=require('node:path');
const native=require('../ops/agent3-universal-backup/five-field-native-route-contract.cjs');
const registration=require('../ops/agent3-universal-backup/registration-contract.cjs');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const SOURCE=fs.readFileSync(path.join(__dirname,
 '../ops/agent3-universal-backup/native-root-request-entrypoints.cjs'),'utf8');
const ID='8b56f036-917e-4c09-9a55-1e8c33198c16';
function args(){return{
 action:registration.REGISTRY_ACTION,
 project:registration.PROJECT,
 source_commit:registration.SOURCE_COMMIT,
 manifest_commit:'b'.repeat(40),
 manifest_sha256:'c'.repeat(64)
};}
function issued(){return{
 request_id:ID,action:gateway.ACTION,
 arguments_sha256:gateway.approvalBindingSha(args()),
 expires_at:new Date(Date.now()+90000).toISOString(),
 level:4,risk:'critical'
};}
function applyBody(){return {
 request_id:ID,second_confirmation:'CONFIRM_LEVEL_4_CRITICAL',...args()
};}
function stubRoot({uid=0}={}){
 const calls={persist:[],load:[],dispatch:[]};
 const prepared=native.prepareRequest(args());
 const entry={request_id:ID,status:'pending',
  expires_at:new Date(Date.now()+90000).toISOString(),
  ...prepared.storage_shape};
 const pending={
  storeNativePending(input){calls.persist.push(input);return {durable:true,approved:false};},
  loadNativePending(id){calls.load.push(id);return entry;}
 };
 const patchedNative={
  ...native,
  applyFromTrustedNativeExecutor:async p=>{
   calls.dispatch.push(p);return {ok:true,from:'isolated_stub_not_installed'};
  }
 };
 const module={exports:{}};
 const requireStub=id=>{
  if(id==='../../prhm-action-registry-gateway-v1.cjs')return gateway;
  if(id==='./five-field-native-route-contract.cjs')return patchedNative;
  if(id==='./root-five-field-pending-store.cjs')return pending;
  throw Error('module not allowlisted:'+id);
 };
 const load=vm.runInNewContext(
  '(function(require,module,exports,process){'+SOURCE+'\n})',
  {Buffer,console},
  {filename:'native-root-request-entrypoints.cjs',timeout:4000}
 );
 load(requireStub,module,module.exports,{getuid:()=>uid,argv:[],stderr:{write(){}},exitCode:0});
 return {api:module.exports,calls,entry,pending};
}
test('only real typed issuer metadata is persisted with fixed root store',()=>{
 const {api,calls}=stubRoot();
 const out=api.persistIssuedNativeRequest({input:args(),issued:issued()});
 assert.equal(out.durable,true);
 assert.equal(out.approved,false);
 assert.equal(calls.persist.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(calls.persist[0])),{
  requestId:ID,expiresAt:issued().expires_at,
  arguments:args()
 });
});
test('forged receipts, altered digests or client-added approval flags abort before writes',()=>{
 const {api,calls}=stubRoot();
 const sample=issued();
 for(const forged of [
  {...sample,arguments_sha256:'0'.repeat(64)},
  {...sample,level:3},
  {...sample,risk:'high'},
  {...sample,action:'host_action_v2_installer_v1'},
  {...sample,request_id:'untrusted'},
  {...sample,approvalToken:'fake'},
  {...sample,approved:true}
 ])assert.throws(()=>api.persistIssuedNativeRequest({input:args(),issued:forged}));
 assert.equal(calls.persist.length,0);
});
test('native apply loads persisted server-side request by UUID, never trusts client record',()=>{
 const {api,calls}=stubRoot();
 const body=applyBody();
 const out=api.prepareApplyFromFixedRootStore(body);
 assert.equal(calls.load.length,1);
 assert.equal(calls.load[0],ID);
 assert.equal(out.request_id,ID);
 assert.equal(out.signed_approval_verified,false);
 assert.equal(out.ready_to_invoke_root_dispatch,false);
 assert.equal(out.approval_consumed,undefined);
 assert.throws(()=>api.prepareApplyFromFixedRootStore({
  ...body,persistedRequest:{status:'approved'},approvalToken:'fake'
 }),/untrusted_native_apply_body/);
 assert.equal(calls.load.length,1);
});
test('root apply refuses fake token and only dispatches after reading trusted pending record',async()=>{
 const {api,calls}=stubRoot();
 await assert.rejects(api.applyFromFixedRootStore({
  body:applyBody(),signedApprovalToken:'approved',rootCapabilities:{}
 }),/signed_trusted_consume_result_required/);
 assert.equal(calls.dispatch.length,0);
 const out=await api.applyFromFixedRootStore({
  body:applyBody(),signedApprovalToken:'x'.repeat(140),
  rootCapabilities:{stub_only:true}
 });
 assert.equal(out.from,'isolated_stub_not_installed');
 assert.equal(calls.dispatch.length,1);
 assert.equal(calls.dispatch[0].precheck.request_id,ID);
 assert.equal(calls.dispatch[0].precheck.arguments_sha256,
  gateway.approvalBindingSha(args()));
 assert.equal(calls.load.length,2);
});
test('root-only guard denies both paths before touching persistent store',()=>{
 const {api,calls}=stubRoot({uid:1001});
 assert.throws(()=>api.persistIssuedNativeRequest({input:args(),issued:issued()}),
  /root_required/);
 assert.throws(()=>api.prepareApplyFromFixedRootStore(applyBody()),/root_required/);
 assert.equal(calls.persist.length,0);
 assert.equal(calls.load.length,0);
});
test('no CLI, issuer replacement, standalone native installation or impersonation',()=>{
 const file=path.join(__dirname,
 '../ops/agent3-universal-backup/native-root-request-entrypoints.cjs');
 const run=cp.spawnSync(process.execPath,[file,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(run.status,78);
 assert.match(run.stderr,/no CLI, no implicit approval, no registrar bootstrap/);
 const {api}=stubRoot();
 for(const x of ['registerTool','approve','consume','mintToken','install','rootCapabilities'])
  assert.equal(Object.hasOwn(api,x),false,x);
});
