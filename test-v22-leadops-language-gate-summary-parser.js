#!/usr/local/bin/prhm-node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const r=require('./bootstrap-host-actions-v22-leadops-language-gate-summary-parser.js');
const fixture=`function detectionSql(){return \`SELECT json_build_object('missing',count(*))::text FROM d\`;}
function migrationSql(){return \`SELECT json_build_object(\\n  'targets',1\\n)::text;\`;}
function parseLastJson(text){const lines=String(text||'').split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean);for(let i=lines.length-1;i>=0;i--){try{return JSON.parse(lines[i]);}catch{}}throw Error('json_summary_missing');}`;
test('patches exactly both SQL summaries with marker',()=>{const o=r.patchSource(fixture);assert.equal((o.match(/__LEADOPS_JSON__/g)||[]).length,4);assert.equal((o.match(/SELECT '__LEADOPS_JSON__'\|\|json_build_object\(/g)||[]).length,2)});
test('replaces legacy parser with marker parser',()=>{const o=r.patchSource(fixture);assert.doesNotMatch(o,/json_summary_missing/);assert.match(o,/json_summary_marker_missing/);assert.match(o,/json_summary_invalid/)});
test('is bound to current production v2 SHA',()=>assert.equal(r.EXPECTED_SHA,'bc5b41039d3928d1062f7d545b932123ecd3a8733881703965430394d7a0af5f'));
