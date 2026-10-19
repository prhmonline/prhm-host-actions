'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const owner=require('./pbcinema-four-owner-root-readonly-preflight-v1.cjs');
const reg=require('./pbcinema-banners-host-action-registration-v1.cjs');
const fake=(option={})=>({
  lstatSync:()=>({
    isFile:()=>!option.notFile,
    isSymbolicLink:()=>!!option.symlink,
    uid:option.uid??0,
    mode:option.mode??0o100644,
  }),
  readFileSync:()=>Buffer.from('x'.repeat(2000))
});
test('exactly four fixed root-owner paths; no caller-provided paths',()=>{
 assert.deepEqual(owner.KEYS,['base','exec','policy','mcp']);
 assert.equal(owner.PATHS.base,reg.BASE_OWNER);
 assert.equal(owner.PATHS.exec,reg.EXEC_OWNER);
 assert.equal(owner.PATHS.policy,reg.POLICY_OWNER);
 assert.equal(owner.PATHS.mcp,reg.MCP_OWNER);
 assert.throws(()=>owner.attestOne('arbitrary',fake()),/unknown_owner/);
});
test('rejects symlink, nonroot ownership, world-writable and non-file',()=>{
 for(const option of [{symlink:true},{uid:1000},{mode:0o100666},{notFile:true}])
   assert.throws(()=>owner.attestOne('base',fake(option)),/untrusted_file_base/);
});
test('hash differences block candidate calculation and emit metadata only',()=>{
 const result=owner.attestAll(fake());
 assert.equal(result.ok,false);
 assert.equal(result.read_only,true);
 assert.equal(result.production_mutation,false);
 assert.equal(result.approval_issued,false);
 assert.equal(result.block_reason,'owner_preimage_mismatch');
 assert.deepEqual(Object.keys(result.owner_match).sort(),owner.KEYS.slice().sort());
 assert.equal(result.candidate_sha256,null);
 assert.equal(Object.prototype.hasOwnProperty.call(result,'source'),false);
 assert.equal(Object.prototype.hasOwnProperty.call(result,'contents'),false);
});
test('source-size and non-buffer checks reject anomalous file data',()=>{
 for(const data of [Buffer.from('short'),Buffer.alloc(2000001), 'string not buffer']){
   const o={...fake(),readFileSync:()=>data};
   assert.throws(()=>owner.attestOne('policy',o),/invalid_content_policy/);
 }
});
test('CLI rejects wrong mode and unprivileged callers before reading owner files',()=>{
 assert.throws(()=>owner.main(['node','file.js','--unknown']),/unsupported_arguments/);
 if(process.getuid()!==0)assert.throws(()=>owner.main(['node','file.js','--preflight']),/requires_preapproved_root_read_only_action/);
});
test('preflight source has no command execution or write operations',()=>{
 const s=require('node:fs').readFileSync(require('node:path').join(__dirname,'pbcinema-four-owner-root-readonly-preflight-v1.cjs'),'utf8');
 for(const token of ['execFileSync','spawnSync','writeFileSync','renameSync','chmodSync','chownSync','sudo ','systemctl '])
   assert.equal(s.includes(token),false,'unexpected privileged action: '+token);
});
