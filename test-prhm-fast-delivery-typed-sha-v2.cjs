'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const t=require('./prhm-fast-delivery-typed-sha-v2.cjs');
const gitSha='c89241e415a093f9c07782ce156b51c7019368c5';
const registrationSha='f'.repeat(40);
const request='df6bf01a-635d-4886-af4b-0fd7bf286bb1';
const aid='e2d62f88-c078-4574-b9fe-82591f92a2ae';
function binding(s=gitSha){return t.makeBinding({project:'rahekomak',sha:s,registration_sha:registrationSha});}
function proof(b=binding()){
 const c={schema_version:'prhm.approval-consumption.v1',
  approval_id:aid,request_id:request,operation:b.operation,
  project_id:'control_plane'};
 const a={approval_id:aid,request_id:request,action:b.action,
  operation:b.operation,project:'control_plane',environment:'production',
  arguments_sha256:b.arguments_sha256,risk:'critical',level:4,
  consumed:true,expired:false,revoked:false,execution_authorized:true,
  expires_at:'2099-10-10T12:00:00.000Z'};
 return {ok:true,consumed:true,consumption:c,approval:a};
}
test('canonical Approval Center SHA-256 excludes property ordering',()=>{
 assert.equal(t.sha256(t.canonicalJson({z:4,a:{n:1,b:2}})),
  t.sha256(t.canonicalJson({a:{b:2,n:1},z:4})));
});
test('two future commits use the same action but different approval hashes',()=>{
 const a=binding(),b=binding('a'.repeat(40));
 assert.equal(a.action,b.action);
 assert.equal(a.root,b.root);
 assert.equal(a.registration_sha,b.registration_sha);
 assert.notEqual(a.arguments_sha256,b.arguments_sha256);
});
test('no arbitrary projects, roots, extra fields, SHA or registration allowed',()=>{
 assert.throws(()=>t.makeBinding({project:'shifa',sha:gitSha,registration_sha:registrationSha}),/unregistered/);
 assert.throws(()=>t.makeBinding({project:'rahekomak',sha:'main',registration_sha:registrationSha}),/sha_must/);
 assert.throws(()=>t.makeBinding({project:'rahekomak',sha:gitSha,registration_sha:'a'}),/registry_binding/);
 assert.throws(()=>t.makeBinding({project:'rahekomak',sha:gitSha,registration_sha:registrationSha,root:'/etc'}),/field_set/);
 assert.throws(()=>t.main(['--apply',gitSha,registrationSha]),/no apply/);
});
test('signed and consumed native proof binds one exact SHA and registration',()=>{
 const b=binding();const res=t.assertConsumed(proof(b),b,request);
 assert.equal(res.signature_verified,true);
 assert.equal(res.single_use_consumed,true);
 assert.equal(res.sha,gitSha);
 assert.equal(res.arguments_sha256,b.arguments_sha256);
});
test('incorrect, stale, fake or replay-like proofs fail closed',()=>{
 const b=binding(),bad=proof(b);
 bad.approval.arguments_sha256='0'.repeat(64);
 assert.throws(()=>t.assertConsumed(bad,b,request),/sha_bound_approval_mismatch/);
 const wrongRequest=proof(b);wrongRequest.approval.request_id=aid;
 assert.throws(()=>t.assertConsumed(wrongRequest,b,request),/request_or_consumption_mismatch/);
 const wrongAction=proof(b);wrongAction.approval.action='rahekomak_production_deploy_v1';
 assert.throws(()=>t.assertConsumed(wrongAction,b,request),/sha_bound_approval_mismatch/);
 const stale=proof(b);stale.approval.expires_at='2020-01-01T00:00:00Z';
 assert.throws(()=>t.assertConsumed(stale,b,request),/approval_expired/);
 const unused=proof(b);unused.approval.consumed=false;
 assert.throws(()=>t.assertConsumed(unused,b,request),/sha_bound_approval_mismatch/);
 assert.throws(()=>t.assertConsumed({ok:true},b,request),/native_consume_proof_missing/);
});
test('native bridge input is exact and tokens never appear in verified output',async()=>{
 const b=binding();
 let called=false;
 const resp=await t.consumeNativeApproval({binding:b,request_id:request,
  consumeNative:async x=>{
   called=true;
   assert.deepEqual(Object.keys(x).sort(),['action','arguments_sha256','operation','project','request_id']);
   assert.equal(x.arguments_sha256,b.arguments_sha256);
   return proof(b);
  }});
 assert.equal(called,true);
 assert.equal(resp.request_id,request);
 assert.equal(JSON.stringify(resp).includes('token'),false);
 await assert.rejects(()=>t.consumeNativeApproval({binding:b,request_id:request}),/trusted_native_consumer_missing/);
});

test('typed SHA approval feeds the shared coordinator without reinstalling adapter',async()=>{
 const c=require('./prhm-fast-delivery-coordinator-v1.cjs');
 const b=binding(),steps=[];
 const profile=require('./prhm-fast-delivery-gate-v1.cjs').PROFILES.rahekomak;
 const adapter={
  project:'rahekomak',root:profile.root,profile_adapter:profile.adapter,
  action:t.ACTION,registration_sha:registrationSha,approval_level:'L4',
  async preflight(){steps.push('preflight');return {ok:true,baseline_sha256:'b'.repeat(64)};},
  async test(){steps.push('test');},async build(){steps.push('build');},
  async deploy(){steps.push('deploy');return {ok:true,deployed_sha:gitSha};},
  async smoke(){steps.push('smoke');return {ok:true,home:200};},
  async rollback(){steps.push('rollback');return {ok:true,restored_baseline_sha256:'b'.repeat(64),health:{ok:true}};}
 };
 const approvalCenter={async consumeExact(payload){
  assert.equal(payload.sha,gitSha);
  assert.equal(payload.registration_sha,registrationSha);
  return t.consumeNativeApproval({binding:b,request_id:request,consumeNative:async args=>{
   steps.push('native-consume');
   assert.equal(args.arguments_sha256,b.arguments_sha256);
   return proof(b);
  }});
 }};
 const inspectProject=()=>({project:'rahekomak',head:gitSha,
  root:profile.root,branch:profile.branch,adapter:profile.adapter,
  ready:true,changed_files:0,blockers:[]});
 const logs=[];
 const logger={async append(value){logs.push(value);return {ok:true,durable:true};}};
 const release=await c.coordinate({project:'rahekomak',sha:gitSha,registry:{rahekomak:adapter},
  approvalCenter,logger,inspectProject});
 assert.equal(release.status,'deployed');
 assert.deepEqual(steps,['preflight','test','build','native-consume','deploy','smoke']);
 assert.equal(logs.length,2);
 assert.equal(logs[1].sha,gitSha);
});
