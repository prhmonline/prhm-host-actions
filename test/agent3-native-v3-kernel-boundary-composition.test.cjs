'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const cp=require('node:child_process');
const vm=require('node:vm');
const file=path.resolve(__dirname,
 '../ops/agent3-universal-backup/native-v3-kernel-boundary-composition.cjs');
const SOCK='/run/prhm-agent3-native-registry/registry.sock';
function fixture({
 rootUid=0,readerReady=false,legacyGranted=false,routesReady=false
}={}){
 const log=[];
 const readPeer=socket=>({socket,kernel_source_only:true});
 const fakeKernel={bindKernelPeerReader(options){
  log.push({type:'kernel',options});
  return {
   release_ready:readerReady,
   readKernelPeerCredentials:readPeer
  };
 }};
 const fakeBoundary={
  DEDICATED_SOCKET:SOCK,
  bindDedicatedUnixBoundary(options){
   log.push({type:'boundary',options});
   return {
    handleRequest:async()=>({handled:false}),
    paths:['/v3/agent3-registry/request','/v3/agent3-registry/execute'],
    legacy_socket_access_granted:legacyGranted,
    release_ready:routesReady
   };
  }
 };
 const exports={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{
  module:exports,
  require(name){
   if(name==='./native-v3-kernel-peer-reader.cjs')return fakeKernel;
   if(name==='./native-v3-dedicated-unix-boundary.cjs')return fakeBoundary;
   throw Error('unexpected_module');
  },
  process:{getuid:()=>rootUid,stderr:{write(){}}},
  Error,Number,Object
 },{timeout:1800,filename:'source-only-native-v3-kernel-composition-fixture'});
 return {api:exports.exports,log,readPeer};
}
function fixed(){
 return {
  rootServer:{address:()=>SOCK},
  nativeAddon:{readPeerCredentials:()=>({pid:2,uid:1001,gid:1002})},
  expectedUid:1001,expectedGid:1002,
  basePost:async()=>({}),
  rootCapabilities:{fixture_only:true}
 };
}
test('requires trusted root owner, fixed dedicated listener and nonroot UID/GID',()=>{
 const unprivileged=fixture({rootUid:1001});
 assert.throws(()=>unprivileged.api.bindSourceOnlyNativeV3(fixed()),
  /root_executor_only/);
 const f=fixture();
 for(const bad of [
  {rootServer:{address:()=>'/run/prhm-agent-selfmaint-exec/exec.sock'}},
  {rootServer:{address:()=>'/tmp/user-controlled.sock'}},
  {expectedUid:0},{expectedGid:0},
  {expectedUid:'1001'},{expectedGid:-1}
 ]){
  assert.throws(
   ()=>f.api.bindSourceOnlyNativeV3({...fixed(),...bad}),
   /only_dedicated_native_v3_unix_listener|fixed_nonroot_identity_required/
  );
 }
 assert.equal(f.log.length,0);
});
test('passes only the accepted kernel credential function to dedicated v3 router',()=>{
 const f=fixture(),args=fixed();
 const result=f.api.bindSourceOnlyNativeV3(args);
 assert.equal(f.log.length,2);
 assert.equal(f.log[0].type,'kernel');
 assert.equal(f.log[0].options.rootServer,args.rootServer);
 assert.equal(f.log[0].options.nativeAddon,args.nativeAddon);
 assert.equal(f.log[1].type,'boundary');
 assert.equal(f.log[1].options.expectedUid,1001);
 assert.equal(f.log[1].options.expectedGid,1002);
 assert.equal(f.log[1].options.readKernelPeerCredentials,f.readPeer);
 assert.equal(result.dedicated_socket,SOCK);
 assert.deepEqual(Array.from(result.paths),[
  '/v3/agent3-registry/request','/v3/agent3-registry/execute'
 ]);
 assert.equal(result.kernel_reader_production_attested,false);
 assert.equal(result.root_dispatcher_installed,false);
 assert.equal(result.level4_signed_and_consumed,false);
 assert.equal(result.release_ready,false);
 assert.equal(result.production_mutation,false);
 assert.equal(result.listen,undefined);
 assert.equal(result.install,undefined);
});
test('any unexpected attestation or legacy grant must fail closed',()=>{
 const kernelReady=fixture({readerReady:true});
 assert.throws(()=>kernelReady.api.bindSourceOnlyNativeV3(fixed()),
  /unattested_kernel_reader/);
 assert.equal(kernelReady.log.length,1);
 const legacy=fixture({legacyGranted:true});
 assert.throws(()=>legacy.api.bindSourceOnlyNativeV3(fixed()),
  /unattested_or_legacy_route/);
 const ready=fixture({routesReady:true});
 assert.throws(()=>ready.api.bindSourceOnlyNativeV3(fixed()),
  /unattested_or_legacy_route/);
});
test('source-only executable cannot apply installation or approval',()=>{
 const call=cp.spawnSync(process.execPath,[file,'--apply'],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(call.status,78);
 assert.match(call.stderr,/source-only kernel Native v3 composition/);
});
