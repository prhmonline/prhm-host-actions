#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const m=require('./bootstrap-agent-mcp-green-rolling-refresh-v3.js');
(async()=>{
 const state={hostname:'prhm-production.prhm.ir',source_sha_match:true,topology_match:true,router_active:true,router_enabled:true,blue_active:true,blue_enabled:true,green_active:true,green_disabled:true,public_health:true,public_ready:true,blue_health:true,blue_ready:true,green_health:true,green_ready:true,legacy_listening:true,pointer_regular:true,pointer_blue:true,disk_enough:true,dependencies:true};
 assert.equal(m.ACTION,'agent_mcp_green_rolling_refresh_v3');
 assert.equal(m.EXPECTED_SHA[m.PATHS.safeFiles],'2f4cedb73d58bff927e09e8d0b534a08cf49f08b3e5da54f47900f57d8a5f910');
 let pf=await m.preflight({inspect:async()=>({...state})});
 assert.equal(pf.ok,true); assert.equal(pf.preflight_only,true); assert.equal(pf.current_backend,8124); assert.equal(pf.candidate_backend,8125); assert.equal(pf.production_mutation,false);
 await assert.rejects(()=>m.preflight({inspect:async()=>({...state,pointer_blue:false})}),/pointer_not_blue/);
 await assert.rejects(()=>m.preflight({inspect:async()=>({...state,green_health:false})}),/green_health_failed/);
 const calls=[];
 const adapter={inspect:async()=>({...state}),captureApplyState:async()=>({backup_path:'/tmp/x'}),restartGreen:async()=>calls.push('restartGreen'),healthGreen:async()=>true,readyGreen:async()=>true,switchToGreen:async()=>calls.push('switchToGreen'),healthPublic:async()=>true,readyPublic:async()=>true,persistApply:async()=>calls.push('persistApply'),restoreApplyState:async()=>calls.push('restoreApplyState'),persistApplyFailure:async()=>{}};
 const out=await m.runApply(adapter); assert.equal(out.active_backend,8125); assert.equal(out.previous_backend,8124); assert.equal(out.green_restarted,true); assert.equal(out.rollback_performed,false); assert.deepEqual(calls,['restartGreen','switchToGreen','persistApply']);
 let rolled=false; const bad={...adapter,restartGreen:async()=>{},healthGreen:async()=>false,restoreApplyState:async()=>{rolled=true}};
 await assert.rejects(()=>m.runApply(bad),/green_health_failed/); assert.equal(rolled,true);
 const src=fs.readFileSync(__dirname+'/bootstrap-agent-mcp-green-rolling-refresh-v3.js','utf8');
 assert(!src.includes('green_inactive')); assert(!src.includes('green_free')); assert(!src.includes('async startGreen(')); assert(src.includes("async restartGreen(){systemctl('restart',UNITS.green);}")); assert.equal(m.PATHS.backupRoot,'/var/backups/prhm-agent-mcp-green-rolling-refresh-v3'); assert.equal(m.PATHS.latest,'/var/backups/prhm-agent-mcp-green-rolling-refresh-v3/latest.json');
 console.log('GREEN_ROLLING_V3_TESTS=PASS');
})().catch(e=>{console.error(e);process.exit(1)});
