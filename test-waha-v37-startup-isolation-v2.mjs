import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const wrapper=fs.readFileSync('safeFiles-waha-singlefile-isolated-v2.mjs','utf8');
const exactReviewed=fs.readFileSync('waha-student-bridge-registration-surface-v37.mjs');
const sha1=b=>createHash('sha1').update(Buffer.from('blob '+b.length))
  .update(Buffer.from([0])).update(b).digest('hex');

function getIsolatedSurface(){
  const match=wrapper.match(/const WAHA_B64='([A-Za-z0-9+/=]+)';/);
  assert.ok(match,'bundled source absent');
  const bytes=Buffer.from(match[1],'base64');
  assert.deepEqual(bytes,exactReviewed);
  assert.equal(sha1(bytes),'7b6e08d2ffb9faed164115be085491fce7ce6261');
  const begin=wrapper.indexOf('function exactWahaCode(){');
  const end=wrapper.indexOf('\nloadExactPreimage();',begin);
  assert.ok(begin>=0&&end>begin);
  const context={
    Buffer,WAHA_B64:match[1],REVIEWED_WAHA_BLOB_SHA1:'7b6e08d2ffb9faed164115be085491fce7ce6261',
    blobHash:sha1,fail:(reason)=>{throw new Error(reason);}
  };
  vm.runInNewContext(wrapper.slice(begin,end)+'\noutput=exactWahaCode();',context);
  return Buffer.from(context.output,'base64').toString('utf8');
}
test('isolation strips exactly the V37 legacy base chaining, preserves tools',()=>{
  const source=getIsolatedSurface();
  assert.ok(!source.includes('const PATCHED_BASE_SHA=ensureBase();'));
  assert.ok(!source.includes("const base=await import(pathToFileURL(BASE).href"));
  assert.ok(!source.includes('base.registerSafeFilesPlugin(mcp,context)'));
  assert.equal((source.match(/mcp.registerTool\(/g)||[]).length,2);
  assert.ok(source.includes('runRegistration(\'--preflight-only\')'));
  assert.ok(source.includes('runRegistration(\'--apply\')'));
  const syntax=spawnSync(process.execPath,['--check','--input-type=module'],{input:source,encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
});
test('real isolated WAHA module import and registration does not execute stale ensureBase',async()=>{
  const source=getIsolatedSurface();
  const zodLine="import { z } from 'file:///home/agent/ssh-mcp-server/node_modules/zod/index.js';";
  assert.ok(source.includes(zodLine));
  const fixture=source.replace(zodLine,"const z={literal:value=>value};");
  const module=await import('data:text/javascript;base64,'+Buffer.from(fixture).toString('base64'));
  const names=[];
  const out=module.registerSafeFilesPlugin({registerTool:name=>names.push(name)},{});
  assert.deepEqual(names,['waha_student_bridge_registration_preflight_v1','waha_student_bridge_registration_apply_v1']);
  assert.equal(out,undefined);
});
test('last-known-good owner pinned, fail-closed checks remain',()=>{
  assert.ok(wrapper.includes("OWNER_SHA256='822e2188d1cb80578fb150eb0066c522c38696459d673ef863473cf584f1c05e'"));
  assert.ok(wrapper.includes('current_safeFiles_exact_backup_missing'));
  assert.ok(wrapper.includes('waha_exact_tool_set_missing'));
  assert.ok(wrapper.includes('reviewed_waha_blob_sha_mismatch'));
  assert.ok(!wrapper.includes('spawnSync('));
});
