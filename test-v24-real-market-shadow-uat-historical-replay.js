#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const r=require('./bootstrap-host-actions-v24-real-market-shadow-uat-historical-replay.js');
const fixture=[
"const EVAL_ID='8c74a9fb-64fe-4161-a4db-0e0697912012';",
"function patchWorker(src,runId){if(crypto.createHash('sha256').update(src).digest('hex')!==EXPECTED_WORKER_SHA)fail('worker_source_sha_mismatch');let out=src;out=replaceOnce(out,\"const VER =\\n  'p0-shadow-v1';\",`const VER =\\n  'p0-shadow-uat-v1-${runId}';`,'ver');out=replaceOnce(out,\"const LOCK =\\n  '/run/prhm-p0-shadow-worker/run.lock';\",`const LOCK =\\n  '/run/prhm-p0-shadow-worker/uat-${runId}.lock';`,'lock');const a=\") econ\\n        on true\\n\\n      where not exists (\";const b=\") econ\\n        on true\\n\\n      where o.id = '\"+TARGET+\"'::uuid\\n\\n      and not exists (\";out=replaceOnce(out,a,b,'candidate_filter');return out}",
"service_category:'EDITING',resolved_economics_count:0,expected_decision:'ASK_CLARIFICATION'",
"service_category:'EDITING'},decision:'ASK_CLARIFICATION'"
].join('\n');
test('v24 injects a fixed historical replay only into the temporary worker copy',()=>{const o=r.patchSource(fixture);assert.match(o,/historical_replay_now/);assert.match(o,/2026-08-13T12:08:38\.414617Z/);assert.match(o,/new Date\(\)/)});
test('v24 reports replay metadata while preserving ASK_CLARIFICATION economics intent',()=>{const o=r.patchSource(fixture);assert.equal((o.match(/replay_now:REPLAY_NOW/g)||[]).length,2);assert.match(o,/ASK_CLARIFICATION/)});
test('canonical source equals the exact post-repair runtime target',()=>{const b=fs.readFileSync('real-market-shadow-uat-v1.js');assert.equal(crypto.createHash('sha256').update(b).digest('hex'),r.EXPECTED_AFTER_SHA);const s=b.toString('utf8');assert.match(s,/const REPLAY_NOW='2026-08-13T12:08:38\.414617Z'/);assert.match(s,/historical_replay_now/);assert.match(s,/economics_inputs_incomplete/)});
