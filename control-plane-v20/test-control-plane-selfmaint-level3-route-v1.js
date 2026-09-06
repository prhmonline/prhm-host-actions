#!/usr/local/bin/prhm-node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {transformSource,EXPECTED_OLD_SHA}=require('./control-plane-selfmaint-level3-route-v1.js');
const source=fs.readFileSync(process.argv[2]||'control-plane-v19/runtime/agent-selfmaint-server.js','utf8');
assert.equal(crypto.createHash('sha256').update(source).digest('hex'),EXPECTED_OLD_SHA,'fixture must equal reconciled production baseline');
const out=transformSource(source);
const candidatePath=process.argv[3];
if(candidatePath){assert.equal(out,fs.readFileSync(candidatePath,'utf8'),'generated candidate must byte-match committed runtime snapshot');}
assert.ok(out.includes("'src/plugins/hostActionsV2.js'"),'hostActionsV2 must be allowlisted');
assert.ok(out.includes("environment: 'production', action: 'write', risk: 'high', operation: OPERATION"),'Level-3/high risk binding must be emitted');
assert.ok(out.includes("arguments: spec, ttl_seconds: 300"),'Level-3 request TTL must be 300');
assert.ok(out.includes("!== LEVEL3_CONFIRM_LITERAL"),'Level-3 confirmation must be required');
assert.ok(out.includes("second_confirmation: LEVEL3_CONFIRM_LITERAL"),'Level-3 confirmation must be forwarded');
const confirmSegment=out.slice(out.indexOf("req.url === '/v1/confirm'"),out.indexOf("req.url === '/v1/host-actions/request'"));
assert.ok(!confirmSegment.includes("critical_second_confirmation_required"),'legacy critical gate must be removed from selfmaint confirm route');
assert.ok(confirmSegment.includes("level3_second_confirmation_required"),'selfmaint confirm route must expose the Level-3 gate');
assert.ok(out.includes("risk: 'critical'"),'unrelated Level-4 host-action paths must remain present');
assert.equal((out.match(/src\/plugins\/hostActionsV2\.js/g)||[]).length,1,'allowlist entry must be unique');
console.log('CONTROL_PLANE_SELFMAINT_LEVEL3_ROUTE_V1=PASS');
