'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const audit=require('../ops/agent3-universal-backup/native-v3-production-node-runtime-audit.cjs');
const lock=require('../ops/agent3-universal-backup/native-v3-addon-ci-build-lock.json');
const cli=path.resolve(__dirname,'../ops/agent3-universal-backup/native-v3-production-node-runtime-audit.cjs');
function sample(){
 return {
  pid:1234,
  liveUID:0,
  stable:true,
  version:{
   node:lock.node_version,napi:lock.napi_version,
   modules:'115',uv:'1.46.0',platform:'linux',
   arch:lock.arch,glibc:'2.36'
  }
 };
}
test('matching exact live Node runtime metadata is not production binary or release proof',()=>{
 const out=audit.assess(sample());
 assert.equal(out.schema,'prhm.agent3.native-v3-production-node-runtime-readonly.v1');
 assert.equal(out.exact_node_runtime_matches_ci,true);
 assert.deepEqual(out.blockers,[]);
 assert.equal(out.production_native_addon_binary_attested,false);
 assert.equal(out.undocumented_node_fd_binding_reviewed,false);
 assert.equal(out.native_listener_installed,false);
 assert.equal(out.four_owner_dispatch_installed,false);
 assert.equal(out.signed_level4_consumed,false);
 assert.equal(out.production_mutation,false);
 assert.equal(out.release_ready,false);
});
test('mismatched Node version, NAPI, libc, unstable PID and nonroot owner block deployment',()=>{
 const x=sample();
 x.stable=false;
 x.liveUID=1001;
 x.version={...x.version,node:'18.20.2',napi:'8',glibc:null};
 const out=audit.assess(x);
 for(const blocker of [
  'LIVE_PID_OR_EXECUTABLE_DRIFT',
  'EXECUTOR_SERVICE_IDENTITY_DRIFT',
  'NODE_VERSION_DIFFERS_FROM_PINNED_CI',
  'NODE_NAPI_VERSION_DIFFERS_FROM_CI',
  'GLIBC_RUNTIME_VERSION_NOT_OBSERVED'
 ])assert.ok(out.blockers.includes(blocker),blocker);
 assert.equal(out.exact_node_runtime_matches_ci,false);
 assert.equal(out.release_ready,false);
});
test('wrong architecture and OS cannot pass',()=>{
 const x=sample();x.version.arch='arm64';x.version.platform='darwin';
 const out=audit.assess(x);
 assert.ok(out.blockers.includes('NODE_PLATFORM_OR_ARCH_MISMATCH'));
 assert.equal(out.release_ready,false);
});
test('invalid runtime evidence fails closed',()=>{
 for(const invalid of [
  {...sample(),pid:0},
  {...sample(),stable:'true'},
  {...sample(),liveUID:undefined},
  {...sample(),version:null}
 ])assert.throws(()=>audit.assess(invalid),/invalid_fixed_evidence/);
});
test('direct execution rejects install arguments and does not run process inspection',()=>{
 const out=cp.spawnSync(process.execPath,[cli,'--apply'],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(out.status,64);
 assert.match(out.stderr,/only --check is allowed/);
 assert.equal(out.stdout,'');
});
