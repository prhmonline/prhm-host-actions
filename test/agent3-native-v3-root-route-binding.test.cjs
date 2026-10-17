'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const child=require('node:child_process');
const file=path.resolve(__dirname,'../ops/agent3-universal-backup/native-v3-root-route-binding.cjs');
function fixture(uid=0){
 const calls=[];
 const native={
  REQUEST_PATH:'/v3/agent3-registry/request',
  EXECUTE_PATH:'/v3/agent3-registry/execute',
  bindTrustedExecutor(args){
   calls.push(['root_bind',args]);
   return {
    async request(body){calls.push(['request',body]);return {request_id:'root-issued',installed:false};},
    async execute(body){calls.push(['execute',body]);return {signed_root_verified:true};}
   };
  }
 };
 const exports={};
 const module={exports};
 const req=id=>{
  assert.equal(id,'./native-five-field-executor-v3-handlers.cjs');
  return native;
 };
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{
  require:req,module,process:{getuid:()=>uid,stderr:{write(){}}},
  Object,Array,Error
 },{filename:'isolated-root-route-binding.cjs',timeout:1500});
 return {adapter:module.exports,calls};
}
function bind(f,verify=()=>true){
 return f.adapter.bind({
  basePost:async()=>({}),
  rootCapabilities:Object.freeze({fixed_root_only:true}),
  assertAuthenticatedTransport:verify
 });
}
test('root-only source binding rejects non-root bootstrap and absent trusted dependencies',()=>{
 const nonRoot=fixture(1000);
 assert.throws(()=>bind(nonRoot),/trusted_root_executor_required/);
 const f=fixture();
 assert.throws(()=>f.adapter.bind({}),/fixed_root_native_dependencies_required/);
 assert.equal(f.calls.length,0);
});
test('exact POST v3 routes call only the bound native executor after transport authentication',async()=>{
 const f=fixture(); const contexts=[];
 const router=bind(f,c=>{contexts.push(c);return c===Object(c)&&c.serverAuthenticated===true;});
 const body={action:'immutable-fixed-five-fields'};
 const peer=Object.freeze({serverAuthenticated:true});
 const request=await router.handle({method:'POST',url:f.adapter.REQUEST,body,transportContext:peer});
 const execute=await router.handle({method:'POST',url:f.adapter.EXECUTE,body,transportContext:peer});
 assert.equal(request.handled,true);
 assert.equal(request.response.request_id,'root-issued');
 assert.equal(request.response.installed,false);
 assert.equal(execute.response.signed_root_verified,true);
 assert.equal(contexts.length,2);
 assert.deepEqual(f.calls.map(x=>x[0]),['root_bind','request','execute']);
 assert.equal(f.calls[1][1],body);
 assert.equal(f.calls[2][1],body);
});
test('legacy and unrelated routes are not intercepted and cannot initiate native callbacks',async()=>{
 const f=fixture();let authCalls=0;
 const r=bind(f,()=>{authCalls++;return true});
 for(const url of ['/v2/host-actions/request','/v2/host-actions/confirm','/v1/requests','/v3/agent3-registry/request/extra']){
  const result=await r.handle({method:'POST',url,body:{approved:true}});
  assert.equal(result.handled,false);
 }
 assert.equal(authCalls,0);
 assert.equal(f.calls.filter(x=>x[0]!=='root_bind').length,0);
});
test('non-POST and unauthenticated v3 routes fail closed before body reaches native executor',async()=>{
 const f=fixture();const r=bind(f,()=>false);
 await assert.rejects(r.handle({method:'GET',url:f.adapter.REQUEST,body:{}}),/post_only/);
 await assert.rejects(r.handle({method:'POST',url:f.adapter.EXECUTE,body:{uid:0,approved:true}}),/unauthenticated_native_transport/);
 const rejective=bind(f,()=>{throw Error('peercred_missing')});
 await assert.rejects(rejective.handle({method:'POST',url:f.adapter.REQUEST}),/peercred_missing/);
 assert.equal(f.calls.filter(x=>x[0]!=='root_bind').length,0);
});
test('no dynamic route, standalone executable installer, or false production status',()=>{
 const f=fixture();
 assert.equal(f.adapter.PATHS.length,2);
 assert.equal(typeof f.adapter.install,'undefined');
 assert.equal(typeof f.adapter.approve,'undefined');
 assert.equal(typeof f.adapter.listen,'undefined');
 const run=child.spawnSync(process.execPath,[file,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(run.status,78);
 assert.match(run.stderr,/no server, apply or install/);
});
