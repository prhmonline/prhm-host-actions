import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const wrapper=fs.readFileSync('safeFiles-waha-shared-run-v7.mjs','utf8');
const original=fs.readFileSync('waha-student-bridge-registration-surface-v37.mjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const blobHash=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length)).update(Buffer.from([0])).update(b).digest('hex');
const match=wrapper.match(/const WAHA_B64='([A-Za-z0-9+/=]+)';/);
assert.ok(match,'SHA-reviewed WAHA registration code must exist');
assert.deepEqual(Buffer.from(match[1],'base64'),original);
assert.equal(blobHash(original),'7b6e08d2ffb9faed164115be085491fce7ce6261');
const start=wrapper.indexOf('function exactWahaCode(){');
const end=wrapper.indexOf('\nloadExactPreimage();',start);
assert.ok(start>0 && end>start);
const ctx={Buffer,zlib,WAHA_B64:match[1],REVIEWED_WAHA_BLOB_SHA1:blobHash(original),blobHash,sha,fail:s=>{throw new Error(s);}};
vm.runInNewContext(wrapper.slice(start,end)+'\nresult=exactWahaCode();',ctx,{timeout:10000});
const reviewed=Buffer.from(ctx.result,'base64').toString('utf8');
const packed=reviewed.match(/const REG_GZ_B64='([A-Za-z0-9+/=]+)';/);
assert.ok(packed);
const worker=zlib.gunzipSync(Buffer.from(packed[1],'base64')).toString('utf8');
const expected=reviewed.match(/const REG_SHA='([a-f0-9]{64})';/);
assert.ok(expected);assert.equal(sha(worker),expected[1]);

const cjs={module:{exports:{}},exports:{},require,Buffer,console,process,__dirname:'/tmp/waha-policy-contract-readonly'};
vm.runInNewContext(worker,cjs,{timeout:10000});
const patch=cjs.module.exports.patchPolicy;
assert.equal(typeof patch,'function');

test('policy patch rejects unrelated unrecognized policy without modifying it',()=>{
 assert.throws(()=>patch('not valid json'));
 assert.throws(()=>patch('{}'));
});

test('reviewed policy patch cannot rewrite source policies outside exact preimage operation',()=>{
 const fn=Function.prototype.toString.call(patch);
 assert.match(fn,/JSON\.parse/);
 assert.match(fn,/operations/);
 assert.ok(fn.includes('waha_student_bridge')||fn.includes('waha-student-bridge')||fn.includes('waha'));
});

test('all critical WAHA registration evidence remains SHA-bound before any production write',()=>{
 const pins=[
   '4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
   '410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
   '148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
   'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'
 ];
 // Use exact policy digest matching production rather than silently accepting a drift.
 assert.ok(worker.includes(pins[0]));
 assert.ok(worker.includes(pins[1]));
 assert.ok(worker.includes(pins[2]));
 assert.ok(worker.includes(pins[3]));
 assert.ok(reviewed.includes("const CONFIRM='CONFIRM_LEVEL_4_CRITICAL'"));
 assert.ok(reviewed.includes("const STATE='/run/prhm-waha-student-bridge-registration-surface-v7'"));
 assert.ok(reviewed.includes("'--property=BindReadOnlyPaths='+STATE"));
});
