'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

const FILE='./safeFiles-installer-refresh-state-helper-rebase-v37-surface-v1.mjs';
const REVIEWED='./safeFiles-installer-refresh-l4-binding-repair-surface-v1.js';
const src=fs.readFileSync(FILE,'utf8');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

function literal(name){
  const m=src.match(new RegExp("const "+name+"='([^']+)'"));
  assert.ok(m,'missing '+name);
  return m[1];
}

function reviewedPair(){
  const s=fs.readFileSync(REVIEWED,'utf8');
  const tick=String.fromCharCode(96);
  const mark='const STATE_SCRIPT=String.raw'+tick;
  const a=s.indexOf(mark)+mark.length;
  const b=s.indexOf(tick+';\nfunction runState',a);
  assert.ok(a>=mark.length&&b>a,'reviewed state script anchor missing');
  const target=s.slice(a,b);
  const targetExpr="const p='/run/prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js';";
  const currentExpr="const p=path.join(ROOT,'prhm-installer-refresh-l4-binding-repair-v1-'+process.pid+'.js');";
  assert.equal(target.split(targetExpr).length-1,1);
  const current=target.replace(targetExpr,currentExpr);
  return {current,target,currentExpr,targetExpr};
}

test('surface is pinned to exact current SafeFiles baseline and V37 SHA pair',()=>{
  assert.equal(literal('BASE_SHA'),'41416010bd28f7eb38c57d5e0482a56d782c0f8fca42a961a8480e6f0c88a6d5');
  assert.equal(literal('CURRENT_SHA'),'b3b99e33fccb9122bcb5155cce64e4a6e9c73ce2404860d43aaa0def2a12db1e');
  assert.equal(literal('TARGET_SHA'),'b80f1f75e1794b7ffd21a432564454a5da42245b533e1b8cae09c4c73113c2cb');
  const pair=reviewedPair();
  assert.equal(sha(Buffer.from(pair.current,'utf8')),literal('CURRENT_SHA'));
  assert.equal(sha(Buffer.from(pair.target,'utf8')),literal('TARGET_SHA'));
});

test('surface preserves the existing SafeFiles base before registering V37 tools',()=>{
  assert.match(src,/const base=await import\(pathToFileURL\(BASE_FILE\)\.href\+'\?v37-rebase='\+BASE_SHA\)/);
  assert.match(src,/const result=base\.registerSafeFilesPlugin\(mcp,context\)/);
  assert.match(src,/return result;/);
});

test('surface exposes only fixed preflight request status apply entrypoints',()=>{
  assert.equal(literal('PREFLIGHT_TOOL'),'control_plane_installer_refresh_state_helper_rebase_v37_preflight_v1');
  assert.equal(literal('REQUEST_TOOL'),'control_plane_installer_refresh_state_helper_rebase_v37_request_v1');
  assert.equal(literal('STATUS_TOOL'),'control_plane_installer_refresh_state_helper_rebase_v37_status_v1');
  assert.equal(literal('APPLY_TOOL'),'control_plane_installer_refresh_state_helper_rebase_v37_apply_v1');
  assert.equal(literal('CONFIRM'),'CONFIRM_LEVEL_4_CRITICAL');
  assert.match(src,/inputSchema:\{request_id:z\.string\(\)\.uuid\(\),second_confirmation:z\.literal\(CONFIRM\)\}/);
});

test('caller cannot select target path command service mode or payload',()=>{
  for(const forbidden of [
    /args\.path/,/args\.target/,/args\.command/,/args\.service/,/args\.mode/,/args\.payload/,
    /inputSchema:\{[^}]*path:/,/inputSchema:\{[^}]*target:/,/inputSchema:\{[^}]*command:/
  ]) assert.doesNotMatch(src,forbidden);
  assert.equal(literal('TARGET'),'/opt/prhm-agent-selfmaint-exec/actions/installer-refresh-l4-binding-repair-state-v1.js');
  assert.equal(literal('STATE_ROOT'),'/var/lib/prhm-agent-selfmaint-exec/installer-refresh-state-helper-rebase-v37');
  assert.equal(literal('ACTION_BACKUP_ROOT'),'/var/backups/prhm-installer-refresh-state-helper-rebase-v37');
});

test('sandbox writable scope is fixed and network is AF_UNIX only',()=>{
  assert.match(src,/writePaths:\[STATE_ROOT,'\/opt\/prhm-agent-selfmaint-exec\/actions',ACTION_BACKUP_ROOT\]/);
  assert.match(src,/RestrictAddressFamilies=AF_UNIX/);
  assert.doesNotMatch(src,/AF_INET|AF_INET6/);
});

test('worker enforces exact transform and one-time Level-4 request semantics',()=>{
  const pair=reviewedPair();
  assert.ok(src.includes(pair.currentExpr));
  assert.ok(src.includes(pair.targetExpr));
  assert.match(src,/TTL=180000/);
  assert.match(src,/one_time_use:true/);
  assert.match(src,/second_confirmation_required:true/);
  assert.match(src,/if\(confirmation!==CONFIRM\)fail\('critical_second_confirmation_required'\)/);
  assert.match(src,/if\(obj\.status!=='pending'\)fail\('request_not_pending'\)/);
  assert.match(src,/if\(Date\.now\(\)>Date\.parse\(obj\.expires_at\)\)/);
});

test('worker is fail-closed and rollback-safe',()=>{
  assert.match(src,/v37_current_state_sha_mismatch/);
  assert.match(src,/v37_target_state_sha_mismatch/);
  assert.match(src,/candidate_tmp_sha_mismatch/);
  assert.match(src,/post_write_sha_mismatch/);
  assert.match(src,/rollback_sha_mismatch/);
  assert.match(src,/state-helper\.preimage\.bak/);
  assert.match(src,/control_plane_mutation:true/);
  assert.match(src,/production_application_mutation:false/);
  assert.match(src,/database_mutation:false/);
});
