import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const wrapper=fs.readFileSync('safeFiles-waha-shared-run-v7.mjs','utf8');
const original=fs.readFileSync('waha-student-bridge-registration-surface-v37.mjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const gitBlob=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length)).update(Buffer.from([0])).update(b).digest('hex');
let transformedSource,regText,originalReg;
function extract(){
 const m=wrapper.match(/const WAHA_B64='([A-Za-z0-9+/=]+)';/);
 assert.ok(m);assert.deepEqual(Buffer.from(m[1],'base64'),original);
 assert.equal(gitBlob(original),'7b6e08d2ffb9faed164115be085491fce7ce6261');
 const start=wrapper.indexOf('function exactWahaCode(){');
 const end=wrapper.indexOf('\nloadExactPreimage();',start);
 assert.ok(start>=0&&end>start);
 const context={
   Buffer,zlib,WAHA_B64:m[1],
   REVIEWED_WAHA_BLOB_SHA1:gitBlob(original),
   blobHash:gitBlob,sha,fail:x=>{throw Error(x);}
 };
 vm.runInNewContext(wrapper.slice(start,end)+'\nresult=exactWahaCode();',context);
 const converted=Buffer.from(context.result,'base64').toString('utf8');
 const originalCompressed=original.toString().match(/const REG_GZ_B64='([A-Za-z0-9+/=]+)';/)[1];
 const currentCompressed=converted.match(/const REG_GZ_B64='([A-Za-z0-9+/=]+)';/)[1];
 originalReg=zlib.gunzipSync(Buffer.from(originalCompressed,'base64')).toString('utf8');
 regText=zlib.gunzipSync(Buffer.from(currentCompressed,'base64')).toString('utf8');
 const expectedSha=converted.match(/const REG_SHA='([a-f0-9]{64})';/)[1];
 assert.equal(sha(regText),expectedSha);
 const check=spawnSync(process.execPath,['--check','--input-type=commonjs'],{input:regText,encoding:'utf8'});
 assert.equal(check.status,0,check.stderr);
 transformedSource=converted;
}
extract();
test('four live owner pins rebased exactly, no old pins remain',()=>{
 const pins={
  base:['ad2f0fc6924238e7bb7bff6d69a517c366ce82fbafb116bb0a2d31d78c5ed32f','4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406'],
  exec:['a988dfcd706d3a032bd4d0d60a85c78b7fd6cdbea4e81b5e6c21212a6cd754a4','410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0'],
  policy:['aad8b3262a86c31f6d746f0bcfbd3eada6187c4e671b51ca79957b6ca6c3340c','148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174'],
  mcp:['8f24b6ed70644c1eda7b255a47ccf0d4fabfe03ac7c73dd8799ff9aeb5294075','bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166']
 };
 for(const [key,[oldHash,newHash]] of Object.entries(pins)){
  assert.equal(regText.includes(oldHash),false,key+':old hash');
  assert.equal(regText.includes(newHash),true,key+':new hash');
 }
 assert.equal(sha(originalReg),'35041977d41d349c7fcaa10f9116d39d7c6f6fcbfe158838b49ab64be93e154d');
});
test('the generated production runner has no --pipe and reads bound journal',()=>{
 assert.equal(regText.includes("'--wait','--pipe','--unit='"),false);
 assert.equal(regText.includes("'--wait','--collect','--unit='"),true);
 assert.ok(regText.includes("cp.execFileSync('/usr/bin/journalctl'"));
 assert.ok(regText.includes("cp.spawnSync('/usr/bin/systemd-run'"));
 assert.ok(regText.includes("'--no-pager','-o','cat','-n','25'"));
});
test('old WAHA action digest and installation worker untouched',()=>{
 const originalWorker=original.toString().match(/const WORKER_GZ_B64='([A-Za-z0-9+/=]+)';/)[1];
 const transformedWorker=transformedSource.match(/const WORKER_GZ_B64='([A-Za-z0-9+/=]+)';/)[1];
 assert.equal(transformedWorker,originalWorker);
 assert.ok(transformedSource.includes("const WORKER_SHA='9907f6df0a34151a6068c2c046b39b6943c6d816ff21520352e5a658c7523e96';"));
});
test('original reviewed registration patch functions compile and remain preflight-compatible',()=>{
 const sandbox={module:{exports:{}},exports:{},Buffer,require,console,process,__dirname:'/tmp/waha-isolated-test'};
 vm.runInNewContext(regText,sandbox,{timeout:5000});
 const functions=sandbox.module.exports;
 for(const f of ['patchBase','patchExec','patchPolicy','patchMcp'])assert.equal(typeof functions[f],'function');
 const base="const host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1'},\nconst HOST_ACTION_V2_LEVEL3 = new Set([]);";
 // Ensure contract stays fail-closed: minimal missing anchors must fail rather than mutate.
 assert.throws(()=>functions.patchBase('unrelated code'),/base_action_anchor_missing/);
 assert.throws(()=>functions.patchExec('unrelated code'),/exec_action_anchor_missing/);
 assert.throws(()=>functions.patchMcp('unrelated code'),/mcp_enum_anchor_missing/);
});
test('only reviewed WAHA names and fixed confirmation mode retained in composite',()=>{
 assert.ok(wrapper.includes('waha_legacy_exact_two_missing'));
 assert.ok(wrapper.includes('waha_legacy_reviewed_tool_contract_mismatch'));
 assert.ok(transformedSource.includes("const CONFIRM='CONFIRM_LEVEL_4_CRITICAL'"));
 assert.ok(transformedSource.includes('waha_student_bridge_registration_preflight_v1'));
 assert.ok(transformedSource.includes('waha_student_bridge_registration_apply_v1'));
});
test('MCP PrivateTmp requires SHA-reviewed materialization under shared root-only /run',()=>{
 assert.ok(transformedSource.includes("const STATE='/run/prhm-waha-student-bridge-registration-surface-v7';"));
 assert.ok(!transformedSource.includes("const STATE='/tmp/prhm-waha-student-bridge-registration-surface-v1';"));
 assert.ok(transformedSource.includes("'--property=BindReadOnlyPaths='+STATE"));
 assert.ok(transformedSource.includes("fs.mkdirSync(STATE,{recursive:true,mode:0o700})"));
 assert.ok(transformedSource.includes("fs.chmodSync(STATE,0o700)"));
 assert.ok(transformedSource.includes("const REG=path.join(STATE,'waha-student-bridge-registration-v1.js')"));
 assert.ok(transformedSource.includes("const WORKER=path.join(STATE,'waha-student-bridge-install-v1.js')"));
 assert.ok(!transformedSource.includes("'--wait','--collect','--pipe','--quiet'"));
 assert.ok(transformedSource.includes("const capture=spawnSync('/usr/bin/journalctl'"));
});
test('one hardcoded root-only bundle location, not a user-supplied service/path',()=>{
 const marker=transformedSource.match(/const STATE='([^']+)';/);
 assert.equal(marker?.[1],'/run/prhm-waha-student-bridge-registration-surface-v7');
 const pathMatches=transformedSource.match(/const STATE='/g)||[];
 assert.equal(pathMatches.length,1);
 assert.ok(wrapper.includes('waha_private_tmp_anchor_invalid'));
 assert.ok(wrapper.includes('waha_shared_runtime_path_guard_failed'));
});
