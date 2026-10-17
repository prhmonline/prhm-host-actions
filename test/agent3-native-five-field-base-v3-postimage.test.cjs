'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const cp=require('node:child_process');
const path=require('node:path');
const gateway=require('../prhm-action-registry-gateway-v1.cjs');
const reg=require('../ops/agent3-universal-backup/registration-contract.cjs');
const base=require('../ops/agent3-universal-backup/native-five-field-base-v3-postimage.cjs');
const UUID='123e4567-e89b-42d3-a456-426614174000';
const args=()=>({action:gateway.ACTION,project:'agent3',
 source_commit:reg.SOURCE_COMMIT,manifest_commit:'a'.repeat(40),
 manifest_sha256:'b'.repeat(64)});
const legacyRequest="    if (req.method === 'POST' && req.url === '/v2/host-actions/request') {";
const fake=()=>[
 'async function handle(req,res){',
 legacyRequest,
 "      return send(res,201,{ok:true,legacy:true});",
 '    }',
 "    if(req.url==='/v2/host-actions/confirm')return send(res,200,{legacy:true});",
 "    if(req.url==='/v2/host-actions/authorize-consume')return send(res,200,{legacy:true});",
 '    return send(res,404,{ok:false});',
 '}',
 'handle;'
].join('\n');
function harness(input,mode={}) {
 const logs=[],sha=gateway.approvalBindingSha(args());
 const issued={request_id:UUID,expires_at:new Date(Date.now()+90000).toISOString(),
   action:gateway.ACTION,arguments_sha256:sha,level:4,risk:'critical'};
 const approval={execution_authorized:true,request_id:UUID,
   action:gateway.ACTION,arguments_sha256:sha,request_hash:sha,
   level:4,risk:'critical',one_time_use:true};
 const token=['a'.repeat(44),'b'.repeat(80),'c'.repeat(88)].join('.');
 const ctx={
  APPROVAL_CLIENT_ENV:'/fixed-fixture-approval-client.env',
  readBody:async()=>input,
  readEnvFile:()=>({APPROVAL_REQUEST_TOKEN:'private',APPROVAL_DECISION_TOKEN:'private'}),
  argumentsSha256:gateway.approvalBindingSha,
  approvalHttp:(method,url,auth,payload)=>{
   logs.push({call:'center',method,url,auth,body:payload});
   if(url==='/v1/requests')return {request:{...issued,...mode.issued}};
   if(url.endsWith('/decision'))return {
     approval:{...approval,...mode.approval},
     approval_token:mode.approval_token===undefined?token:mode.approval_token
   };
   throw Error('unknown_center_path');
  },
  approvalBridge:async(url,body)=>{
   logs.push({call:'bridge',url,body});
   if(url==='/v1/validate')return {valid:mode.invalid!==true};
   if(url==='/v1/consume')return {consumed:mode.notConsumed!==true};
   throw Error('unknown_bridge_path');
  },
  send:(res,code,data)=>({code,data})
 };
 const server=vm.runInNewContext(base.inject(fake()),ctx,{timeout:5000});
 return {server,logs,token};
}
test('Base proposal remains source-only SHA-bound and cannot accept untrusted bytes',()=>{
 assert.equal(base.REQUEST,'/v3/agent3-registry/request');
 assert.equal(base.CONFIRM,'/v3/agent3-registry/confirm-consume');
 assert.throws(()=>base.propose(Buffer.from(fake())),/base_preimage_not_pinned/);
 assert.throws(()=>base.inject(fake().replace(legacyRequest,'')),/base_v2_anchor_missing_or_duplicate/);
 assert.throws(()=>base.inject(fake()+fake()),/base_v2_anchor_missing_or_duplicate/);
 assert.throws(()=>base.inject(fake().replace('handle;',base.REQUEST)),/v3_route_already_present/);
 assert.ok(base.inject(fake()).includes('/v2/host-actions/authorize-consume'));
 assert.ok(base.inject(fake()).includes('/v2/host-actions/confirm'));
 assert.ok(base.inject(fake()).includes('/v2/host-actions/request'));
});
test('Base v3 request uses all five canonical SHA-bound fields and 180-second L4 policy',async()=>{
 const a=args(),h=harness(a);
 const r=await h.server({method:'POST',url:base.REQUEST},{});
 assert.equal(r.code,201);
 assert.equal(r.data.arguments_sha256,gateway.approvalBindingSha(a));
 assert.equal(r.data.request.request_id,UUID);
 assert.equal(h.logs.length,1);
 assert.equal(h.logs[0].url,'/v1/requests');
 assert.equal(h.logs[0].body.ttl_seconds,180);
 assert.equal(h.logs[0].body.operation,gateway.OPERATION);
 assert.equal(h.logs[0].body.risk,'critical');
 assert.equal(h.logs[0].body.arguments_sha256,gateway.approvalBindingSha(a));
 assert.deepEqual(JSON.parse(JSON.stringify(h.logs[0].body.arguments)),a);
 assert.equal(Object.hasOwn(r.data,'approval_token'),false);
});
test('Base v3 request rejects action-only or mutated binding prior to center traffic',async()=>{
 for(const a of [{action:gateway.ACTION},
  {...args(),action:reg.INSTALL_ACTION},
  {...args(),source_commit:'f'.repeat(40)},
  {...args(),manifest_sha256:'invalid'},
  {...args(),irrelevant:'value'}
 ]){
  const h=harness(a);
  await assert.rejects(h.server({method:'POST',url:base.REQUEST},{}));
  assert.equal(h.logs.length,0);
 }
 const h=harness(args(),{issued:{arguments_sha256:'f'.repeat(64)}});
 await assert.rejects(h.server({method:'POST',url:base.REQUEST},{}),/issuer_binding_mismatch/);
});
test('Base v3 consumes only exact signed-looking L4 receipt for same request+digest',async()=>{
 const input={request_id:UUID,second_confirmation:'CONFIRM_LEVEL_4_CRITICAL',...args()};
 const h=harness(input);
 const r=await h.server({method:'POST',url:base.CONFIRM},{});
 assert.equal(r.code,200);
 assert.equal(r.data.request_id,UUID);
 assert.equal(r.data.arguments_sha256,gateway.approvalBindingSha(args()));
 assert.equal(r.data.root_jws_verified,false);
 assert.equal(r.data.approval_token,h.token);
 assert.equal(h.logs.length,3);
 assert.equal(h.logs[0].url,'/v1/requests/'+UUID+'/decision');
 assert.equal(h.logs[0].body.second_confirmation,'CONFIRM_LEVEL_4_CRITICAL');
 assert.equal(h.logs[1].url,'/v1/validate');
 assert.equal(h.logs[2].url,'/v1/consume');
 assert.equal(h.logs[2].body.arguments_sha256,gateway.approvalBindingSha(args()));
});
test('Base v3 never consumes mismatched decision or changed seven-field request',async()=>{
 const input={request_id:UUID,second_confirmation:'CONFIRM_LEVEL_4_CRITICAL',...args()};
 for(const wrong of [
  {body:{...input,project:'shifa'}},
  {body:{...input,note:'forbidden'}},
  {body:{...input,request_id:'not-a-uuid'}},
  {body:{...input,second_confirmation:'CONFIRM_LEVEL_3_PRODUCTION'}},
  {body:input,opts:{approval:{request_id:'123e4567-e89b-42d3-a456-426614174999'}}},
  {body:input,opts:{approval:{arguments_sha256:'f'.repeat(64)}}},
  {body:input,opts:{approval_token:'fake'}},
  {body:input,opts:{invalid:true}},
  {body:input,opts:{notConsumed:true}}
 ]){
  const h=harness(wrong.body,wrong.opts||{});
  await assert.rejects(h.server({method:'POST',url:base.CONFIRM},{}));
  if(wrong.opts?.approval||wrong.opts?.approval_token)
   assert.equal(h.logs.some(x=>x.url==='/v1/consume'),false);
 }
});
test('No live service or CLI exists in pinned proposal',()=>{
 const proc=cp.spawnSync(process.execPath,[
 path.resolve(__dirname,'../ops/agent3-universal-backup/native-five-field-base-v3-postimage.cjs'),'--apply'
 ],{encoding:'utf8',timeout:10000});
 assert.equal(proc.status,78);
 assert.match(proc.stderr,/no stage, apply, approval or production changes/);
 assert.equal(proc.stdout,'');
 for(const k of ['deploy','apply','install','approve','consume','stage'])
  assert.equal(Object.hasOwn(base,k),false);
});
