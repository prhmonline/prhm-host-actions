'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const P='/mnt/data/safeFiles-installer-refresh-l4-binding-repair-surface-v1.js';
const s=fs.readFileSync(P,'utf8');
test('surface is fixed request/status/apply with independent L4 gate',()=>{
 for(const x of ['control_plane_installer_refresh_l4_binding_repair_request_v1','control_plane_installer_refresh_l4_binding_repair_status_v1','control_plane_installer_refresh_l4_binding_repair_apply_v1','CONFIRM_LEVEL_4_CRITICAL','one_time_use:true','TTL=180000','request_not_pending','request_expired','installer_sha_mismatch','d29fb00470886adc50b1a2111f8b72b4b6c3769b9c201967786fee6a58f18bdd','ProtectSystem=strict','ReadWritePaths=','/opt/prhm-company-control-plane','production_mutation:true','database_mutation:false'])assert.ok(s.includes(x),x);
 assert.doesNotMatch(s,/req\.body|destinationPath|callerContent|arbitrary_command/);
});
test('surface is exact-base wrapper',()=>{
 assert.ok(s.includes('c2a5fe6c67190d5b22464803ca8dfa98cb54d701611b80515d9ec5fa16b90c90'));
 assert.ok(s.includes("agent_mcp-src_plugins_safeFiles.js-"));
});

test('embedded state script syntax is valid',()=>{
 const src=fs.readFileSync(P,'utf8');
 const a=src.indexOf('const STATE_SCRIPT=String.raw`')+'const STATE_SCRIPT=String.raw`'.length;
 const b=src.indexOf('`;\nfunction runState',a)>=0?src.indexOf('`;\nfunction runState',a):src.indexOf('`;function runState',a);
 assert.ok(a>0&&b>a);
 const state=src.slice(a,b);
 const cp=require('node:child_process');
 const r=cp.spawnSync('node',['--check','-'],{input:state,encoding:'utf8'});
 assert.equal(r.status,0,String(r.stderr||r.stdout||''));
});
