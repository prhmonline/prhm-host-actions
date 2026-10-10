'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const script=path.join(__dirname,'central-offsite-rclone-proof-deploy-v1.js');
const call=(...args)=>cp.spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:8000});
test('release refuses empty operation',()=>{const r=call();assert.equal(r.status,2);assert.match(r.stderr,/USAGE_PREPARE_ONLY/);});
test('release refuses arbitrary approval code without touching production',()=>{const r=call('--apply','a'.repeat(40),'NO');assert.equal(r.status,2);assert.match(r.stderr,/LEVEL4_EXPLICIT_APPROVAL_REQUIRED/);});
test('release refuses non-SHA commit even with confirmation',()=>{const r=call('--apply','HEAD','CONFIRM_LEVEL_4_CRITICAL');assert.equal(r.status,2);assert.match(r.stderr,/EXACT_COMMIT_REQUIRED/);});
test('release targets bounded MCP services only, with rollback integrity and logger',()=>{
  const s=fs.readFileSync(script,'utf8');
  for(const n of ['prhm-agent-mcp-green.service','prhm-agent-mcp-blue.service','prhm-agent-mcp-safe-delivery-candidate.service','PINNED_GIT_REF_MISMATCH','BACKUP_SHA_MISMATCH','CANDIDATE_SHA_MISMATCH','POSTIMAGE_SHA_MISMATCH','ROLLBACK_SHA_MISMATCH','fs.renameSync(rbTemp,TARGET)','fs.renameSync(tmp,dest)','waitHealth(unit.port)','healthy(ROUTER)'])assert.ok(s.includes(n),n);
  assert.doesNotMatch(s,/docker\s+exec|rclone\s+(copy|delete)|DELETE\s+FROM|DROP\s+TABLE/);
});
