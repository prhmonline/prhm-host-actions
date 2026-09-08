'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const candidate=path.join(__dirname,'agent-mcp-central-offsite-registry-registration-v1.js');

test('registry forward-registration patch is fixed, SHA-bound and minimal',()=>{
  assert.equal(fs.existsSync(candidate),true,'candidate must exist');
  const m=require(candidate);
  assert.equal(m.CONTRACT.target,'/home/agent/ssh-mcp-server/src/core/registry.js');
  assert.equal(m.CONTRACT.expected_old_sha256,'0d69b284f8bcf9b772a711dff962a614bd0c1234ee03b87f3faa70877eadb48c');
  assert.equal(m.CONTRACT.find,"  registerHostActionsPlugin(mcp, context);\n");
  assert.equal(m.CONTRACT.replace,"  registerHostActionsPlugin(mcp, context);\n  registerCentralOffsitePlugin(mcp, context);\n");
  assert.equal(m.CONTRACT.arbitrary_path,false);
  assert.equal(m.CONTRACT.arbitrary_command,false);
});

test('transform requires exact preimage and exactly one registration anchor',()=>{
  const m=require(candidate);
  const base="x\n  registerHostActionsPlugin(mcp, context);\ny\n";
  const crypto=require('node:crypto');
  const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
  assert.throws(()=>m.transform(base,'0'.repeat(64)),/preimage_sha_mismatch/);
  const custom={...m.CONTRACT,expected_old_sha256:sha(base)};
  const out=m.transform(base,custom.expected_old_sha256,custom);
  assert.equal(out,"x\n  registerHostActionsPlugin(mcp, context);\n  registerCentralOffsitePlugin(mcp, context);\ny\n");
  assert.throws(()=>m.transform(base+base,sha(base+base),{...custom,expected_old_sha256:sha(base+base)}),/anchor_count_mismatch/);
});
