#!/usr/local/bin/prhm-node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const r=require('./bootstrap-host-actions-v21-leadops-language-gate-repair-v2.js');
const fixture=[
  'function migrationSql(){return `BEGIN;',
  'CREATE TEMP TABLE leadops_language_gate_targets ON COMMIT DROP AS',
  'SELECT 1;',
  'SELECT CASE WHEN count(*)<=${MAX_TARGETS} THEN 1 ELSE 1/0 END FROM leadops_language_gate_targets;',
  'SELECT CASE WHEN count(*)=0 THEN 1 ELSE 1/0 END',
  'FROM marketplace.opportunities;',
  'SELECT CASE WHEN count(*)=0 THEN 1 ELSE 1/0 END',
  'FROM automation.outbox_events;',
  'COMMIT;`;}',
  'function restoreParscodersTimer(wasActive){',
  "  if(wasActive){systemctl(['start','leadops-parscoders-v3.timer'],{timeout:15000});return;}",
  "  systemctl(['stop','leadops-parscoders-v3.timer'],{allowFailure:true,timeout:15000});",
  '}',
  'function main(){',
  '  let timerWasActive=false,timerStateCaptured=false;',
  "    systemctl(['stop','leadops-parscoders-v3.timer'],{allowFailure:true,timeout:15000});",
  '    restoreParscodersTimer(timerWasActive);',
  '    const result={timer_active:timerWasActive};',
  "    if(timerStateCaptured){try{restoreParscodersTimer(timerWasActive)}catch(e){rollbackErrors.push('timer:'+e.message)}}",
  '}'
].join('\n')+'\n';
test('aggregate assertions cannot be planner-folded constants',()=>{const o=r.patchSource(fixture);assert.doesNotMatch(o,/ELSE 1\/0 END/);assert.match(o,/SELECT 1 \/ CASE WHEN count\(\*\)<=\$\{MAX_TARGETS\} THEN 1 ELSE 0 END/);assert.equal((o.match(/SELECT 1 \/ CASE WHEN count\(\*\)=0 THEN 1 ELSE 0 END/g)||[]).length,2)});
test('migration serializes producer writes in transaction',()=>{const o=r.patchSource(fixture);assert.ok(o.indexOf('LOCK TABLE automation.outbox_events')<o.indexOf('CREATE TEMP TABLE'));assert.ok(o.indexOf('LOCK TABLE marketplace.opportunities')<o.indexOf('CREATE TEMP TABLE'))});
test('transient timer is never stopped or restarted by language gate',()=>{const o=r.patchSource(fixture);assert.doesNotMatch(o,/systemctl\(\['stop','leadops-parscoders-v3\.timer'/);assert.doesNotMatch(o,/restoreParscodersTimer/);assert.doesNotMatch(o,/systemctl\(\['start','leadops-parscoders-v3\.timer'/)});
test('repair is SHA-bound to current production helper',()=>{assert.equal(r.EXPECTED_SHA,'87013c001e572931ae425e54109dccfeca14612af8589aa937f40fd5d21343b1')});
