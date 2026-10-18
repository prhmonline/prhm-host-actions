'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const cp=require('node:child_process');
const path=require('node:path');
const {Server}=require('node:http');
const file=path.resolve(__dirname,
 '../ops/agent3-universal-backup/native-v3-dedicated-unix-boundary.cjs');
const SOCK='/run/prhm-agent3-native-registry/registry.sock';
const LEGACY='/run/prhm-agent-selfmaint-exec/exec.sock';
const PATHS=Object.freeze([
 '/v3/agent3-registry/request','/v3/agent3-registry/execute'
]);
function fakeServer(address=SOCK){
 const server=new Server();
 Object.defineProperty(server,'listening',{value:true});
 Object.defineProperty(server,'address',{value:()=>address,configurable:true});
 return server;
}
function fixture(uid=0,paths=PATHS){
 const records=[];
 const bridge={bindRootHttp(options){
  records.push(options);
  return {paths:[...paths],handleRequest:async()=>({handled:false})};
 }};
 const m={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{
  module:m,
  require(name){
   if(name==='node:http')return {Server};
   if(name==='./native-v3-root-http-bridge.cjs')return bridge;
   throw Error('unexpected_import:'+name);
  },
  process:{getuid:()=>uid,stderr:{write(){}}},
  Object,Array,Error,Reflect,Number
 },{filename:'native-v3-isolation-source-fixture.cjs',timeout:1800});
 return {api:m.exports,records};
}
const config=()=>({
 rootServer:fakeServer(),
 basePost:async()=>({}),
 rootCapabilities:Object.freeze({test_only:true}),
 readKernelPeerCredentials:async()=>({pid:123,uid:2105,gid:2106}),
 expectedUid:2105,expectedGid:2106
});
test('dedicated socket MUST differ from legacy Root Executor socket',()=>{
 const f=fixture();
 assert.notEqual(f.api.DEDICATED_SOCKET,f.api.LEGACY_SOCKET);
 assert.equal(f.api.DEDICATED_SOCKET,SOCK);
 assert.equal(f.api.LEGACY_SOCKET,LEGACY);
 assert.throws(
  ()=>f.api.bindDedicatedUnixBoundary({...config(),rootServer:fakeServer(LEGACY)}),
  /dedicated_root_unix_listener_required/
 );
 assert.throws(
  ()=>f.api.bindDedicatedUnixBoundary({...config(),rootServer:new Server()}),
  /dedicated_root_unix_listener_required/
 );
 assert.equal(f.records.length,0);
});
test('production binding requires root owner and pinned strictly NONROOT peer identity',()=>{
 const f=fixture(1001);
 assert.throws(()=>f.api.bindDedicatedUnixBoundary(config()),/trusted_root_owner_required/);
 const root=fixture();
 for(const identity of [{expectedUid:0},{expectedGid:0},
  {expectedUid:-1},{expectedGid:-5},{expectedUid:'2105'},
  {expectedGid:2.1}]){
  assert.throws(
   ()=>root.api.bindDedicatedUnixBoundary({...config(),...identity}),
   /fixed_nonroot_broker_identity_required/
  );
 }
 assert.throws(
  ()=>root.api.bindDedicatedUnixBoundary({
   ...config(),readKernelPeerCredentials:undefined
  }),/kernel_peer_reader_required/
 );
 assert.equal(root.records.length,0);
});
test('source-only boundary accepts ONLY independently supplied native v3 dispatch',()=>{
 const f=fixture();
 const bound=f.api.bindDedicatedUnixBoundary(config());
 assert.deepEqual(Array.from(bound.paths),Array.from(PATHS));
 assert.equal(bound.dedicated_socket,SOCK);
 assert.equal(bound.legacy_socket_access_granted,false);
 assert.equal(bound.peer_reader_production_attested,false);
 assert.equal(bound.release_ready,false);
 assert.equal(typeof bound.install,'undefined');
 assert.equal(typeof bound.issueApproval,'undefined');
 assert.equal(typeof bound.listen,'undefined');
 assert.equal(f.records.length,1);
 const legacy=fixture(0,[...PATHS,'/v2/host-actions/execute']);
 assert.throws(()=>legacy.api.bindDedicatedUnixBoundary(config()),
  /native_v3_only_dispatch_required/);
});
test('kernel response is checked with exact pinned uid, gid and real positive pid',async()=>{
 const f=fixture();
 let result={pid:123,uid:2105,gid:2106};
 const opt=config();
 opt.readKernelPeerCredentials=async()=>result;
 const bound=f.api.bindDedicatedUnixBoundary(opt);
 assert.equal(bound.release_ready,false);
 const verify=f.records[0].assertNativePeer;
 assert.equal(await verify({}),true);
 for(const bad of [
  {pid:0,uid:2105,gid:2106},
  {pid:123,uid:2105,gid:0},
  {pid:123,uid:0,gid:2106},
  {pid:123,uid:2105,gid:2107},
  {pid:123,uid:2106,gid:2106},
  {pid:123,uid:'2105',gid:2106},
  {pid:123,uid:2105,gid:2106,authenticated:true},
  {pid:123,uid:2105,gid:2106,request_id:'spoof'},
  null,[],{}
 ]){
  result=bad;
  assert.equal(await verify({}),false,JSON.stringify(bad));
 }
 opt.readKernelPeerCredentials=()=>{throw Error('native_reader_failure')};
 result={pid:123,uid:2105,gid:2106};
 // Test the actual closure's fixed callback, not subsequently mutated options.
 assert.equal(await verify({}),true);
});
test('identity verification fails closed on revoked native reader or changed socket',async()=>{
 const f=fixture();
 let rejectNative=false;
 let server=fakeServer();
 const opt={...config(),rootServer:server,
  readKernelPeerCredentials:async()=>{
   if(rejectNative)throw Error('kernel_read_failed');
   return {pid:555,uid:2105,gid:2106};
  }
 };
 f.api.bindDedicatedUnixBoundary(opt);
 const verify=f.records[0].assertNativePeer;
 assert.equal(await verify({}),true);
 rejectNative=true;
 assert.equal(await verify({}),false);
 rejectNative=false;
 Object.defineProperty(server,'address',{value:()=>LEGACY,configurable:true});
 assert.equal(await verify({}),false);
});
test('credential structure disallows caller flags/getters and malformed values',()=>{
 const f=fixture();
 assert.equal(f.api.exactNativeCredentialShape({pid:1,uid:2105,gid:2106}),true);
 const forged={pid:1,uid:2105,gid:2106};
 Object.defineProperty(forged,'role',{value:'admin'});
 assert.equal(f.api.exactNativeCredentialShape(forged),false);
 assert.equal(f.api.exactNativeCredentialShape({
  pid:1,uid:2105,get gid(){throw Error('side_effect');}
 }),false);
 assert.equal(f.api.exactNativeCredentialShape({pid:NaN,uid:1,gid:2}),false);
});
test('direct invocation cannot create a listener, mutate host or apply an action',()=>{
 const r=cp.spawnSync(process.execPath,[file,'--apply'],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(r.status,78);
 assert.match(r.stderr,/source-only dedicated Native v3 Unix boundary/);
});
