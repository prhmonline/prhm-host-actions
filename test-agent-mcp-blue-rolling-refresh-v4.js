#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const m=require('./bootstrap-agent-mcp-blue-rolling-refresh-v4.js');
(async()=>{
 const state={hostname:'prhm-production.prhm.ir',source_sha_match:true,topology_match:true,router_active:true,router_enabled:true,green_active:true,green_enabled:true,blue_active:true,blue_disabled:true,public_health:true,public_ready:true,green_health:true,green_ready:true,blue_health:true,blue_ready:true,legacy_listening:true,pointer_regular:true,pointer_green:true,disk_enough:true,dependencies:true};
 assert.equal(m.ACTION,'agent_mcp_blue_rolling_refresh_v4');
 assert.equal(m.EXPECTED_SHA[m.PATHS.hostActionsV2],'d9823fe703c91c938cdf688a6c0944775fc5226a420892c3a35053170a19f360');
 assert.equal(m.EXPECTED_SHA[m.PATHS.safeFiles],'2f4cedb73d58bff927e09e8d0b534a08cf49f08b3e5da54f47900f57d8a5f910');
 let pf=await m.preflight({inspect:async()=>({...state})});
 assert.equal(pf.ok,true); assert.equal(pf.preflight_only,true); assert.equal(pf.current_backend,8125); assert.equal(pf.candidate_backend,8124); assert.equal(pf.production_mutation,false);
 await assert.rejects(()=>m.preflight({inspect:async()=>({...state,pointer_green:false})}),/pointer_not_green/);
 await assert.rejects(()=>m.preflight({inspect:async()=>({...state,blue_health:false})}),/blue_health_failed/);
 const calls=[];
 const adapter={inspect:async()=>({...state}),captureApplyState:async()=>({backup_path:'/tmp/x'}),restartBlue:async()=>calls.push('restartBlue'),healthBlue:async()=>true,readyBlue:async()=>true,switchToBlue:async()=>calls.push('switchToBlue'),healthPublic:async()=>true,readyPublic:async()=>true,persistApply:async()=>calls.push('persistApply'),restoreApplyState:async()=>calls.push('restoreApplyState'),persistApplyFailure:async()=>{}};
 const out=await m.runApply(adapter); assert.equal(out.active_backend,8124); assert.equal(out.previous_backend,8125); assert.equal(out.blue_restarted,true); assert.equal(out.rollback_performed,false); assert.deepEqual(calls,['restartBlue','switchToBlue','persistApply']);
 let rolled=false; const bad={...adapter,restartBlue:async()=>{},healthBlue:async()=>false,restoreApplyState:async()=>{rolled=true}};
 await assert.rejects(()=>m.runApply(bad),/blue_health_failed/); assert.equal(rolled,true);
 const src=fs.readFileSync(__dirname+'/bootstrap-agent-mcp-blue-rolling-refresh-v4.js','utf8');
 assert(!src.includes('blue_inactive')); assert(!src.includes('blue_free')); assert(!src.includes('async startBlue(')); assert(src.includes("async restartBlue(){systemctl('restart',UNITS.blue);}")); assert.equal(m.PATHS.backupRoot,'/var/backups/prhm-agent-mcp-blue-rolling-refresh-v4'); assert.equal(m.PATHS.latest,'/var/backups/prhm-agent-mcp-blue-rolling-refresh-v4/latest.json');
 console.log('BLUE_ROLLING_V4_TESTS=PASS');
})().catch(e=>{console.error(e);process.exit(1)});
