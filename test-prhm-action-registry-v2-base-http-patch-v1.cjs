'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const cp=require('node:child_process');
const P=require('./prhm-action-registry-v2-base-http-patch-v1.cjs');
const F=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
test('a different current base SHA cannot be patched even if it has matching route anchors',()=>{
 const synthetic=Buffer.from((
  "const HOST_ACTIONS_V2_BASE_MARKER = true;\n"+
  "const HOST_ACTION_V2_SPECS = Object.freeze({});\n"+
  P.ROUTE_ANCHOR+"\n"+
  "if(req.url === '/v2/host-actions/authorize-consume')return;\n"
 ).repeat(50));
 assert.throws(()=>P.prepare(synthetic),/current_base_sha_drift/);
 assert.throws(()=>P.prepare(Buffer.from('bad')),/expected_real_owner_bytes/);
});
test('the compiled insertion is exact, not a wildcard or action-only compatibility route',()=>{
 const fragment=P.compiledRoutes();
 assert.equal(fragment.includes(P.MARKER),true);
 assert.equal(fragment.includes(P.TRUSTED),true);
 assert.equal(fragment.includes(P.ADAPTER),true);
 assert.equal(fragment.includes("'/v2/host-actions/request'"),false);
 for(const p of [
  '/v2/registry/honartik/request',
  '/v2/registry/honartik/confirm',
  '/v2/registry/honartik/execute'
 ])assert.ok(fragment.includes("'"+p+"'"));
 assert.equal(fragment.includes('child_process'),false);
 assert.equal(fragment.includes('eval('),false);
 assert.equal(fragment.includes('approval_token:'),false);
});
function evalRoutes(req,loader,readBody){
 const src=P.compiledRoutes()+
  '\nreturn {ok:false,status:404};';
 const runner=new Function('req','res','require','readBody','send',
  'approvalHttp','approvalBridge','readEnvFile','APPROVAL_CLIENT_ENV',
  'return (async function(){'+src+'}).call(null);');
 return runner(req,{},loader,readBody,(_res,status,result)=>({status,result}),
  ()=>null,()=>null,()=>({}),'/etc/approved-client.env');
}
test('injected v2 route dispatches through ONLY exact fixed trusted factory',async()=>{
 const requested=[],body={...F.REQUEST};
 const loader=id=>{
  requested.push(id);
  if(id===P.ADAPTER)return {createHandlers:cap=>{
   assert.equal(cap.bound,true);
   return {dispatch:(method,path,request)=>{
    assert.equal(method,'POST');
    assert.deepEqual(request,body);
    return {ok:true,status:'pending',secret_exposed:false};
   }};
  }};
  if(id===P.TRUSTED)return {createRootCapabilities:x=>{
   assert.equal(x.approvalClientEnv,'/etc/approved-client.env');
   return {bound:true};
  }};
  throw Error('unknown_module');
 };
 const result=await evalRoutes({method:'POST',
  url:'/v2/registry/honartik/request'},loader,async()=>body);
 assert.equal(result.status,201);
 assert.equal(result.result.secret_exposed,false);
 assert.deepEqual(requested,[P.ADAPTER,P.TRUSTED]);
});
test('old Host Actions request is never intercepted by the dedicated route',async()=>{
 let loaded=false;
 const x=await evalRoutes({method:'POST',url:'/v2/host-actions/request'},
  ()=>{loaded=true;throw Error('incorrect route')},async()=>({}));
 assert.equal(x.status,404);
 assert.equal(loaded,false);
});
test('GET or arbitrary commands do not load the privileged runtime at all',async()=>{
 for(const req of [
  {method:'GET',url:'/v2/registry/honartik/request'},
  {method:'POST',url:'/v2/registry/other/request'},
  {method:'POST',url:'/v2/registry/honartik/execute/../../etc/passwd'}
 ]){
  let reads=0;
  const result=await evalRoutes(req,()=>{reads++;throw Error('unexpected require')},
   async()=>{reads++;return {}});
  assert.equal(result.status,404);
  assert.equal(reads,0);
 }
});
test('missing trusted root capabilities factory denies the route before HTTP body is processed',async()=>{
 let bodyRead=false;
 await assert.rejects(evalRoutes({method:'POST',
  url:'/v2/registry/honartik/request'},id=>{
    if(id===P.ADAPTER)return {createHandlers:()=>({dispatch:()=>({ok:true})})};
    throw Error('trusted_root_capability_module_missing');
   },async()=>{bodyRead=true;return{}}),/trusted_root_capability_module_missing/);
 assert.equal(bodyRead,false);
});
test('existing base remains immutable in the source-only patcher',()=>{
 assert.equal(Object.hasOwn(P,'apply'),false);
 assert.equal(Object.hasOwn(P,'install'),false);
 assert.equal(Object.hasOwn(P,'writeFile'),false);
 assert.equal(Object.hasOwn(P,'spawn'),false);
 assert.equal(P.PINNED_BEFORE,'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406');
});
