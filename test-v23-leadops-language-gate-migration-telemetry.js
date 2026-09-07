#!/usr/local/bin/prhm-node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const r=require('./bootstrap-host-actions-v23-leadops-language-gate-migration-telemetry.js');
const fixture=`function x(){
    const migration=parseLastJson(psql(migrationSql()));
    const finalCheck=parseLastJson(psql(detectionSql(),{readOnly:true}));
    if(Number(finalCheck.missing)!==0)throw Error('language_gate_postcheck_missing:'+finalCheck.missing);
}`;
test('migration stdout is telemetry not success gate',()=>{const o=r.patchSource(fixture);assert.doesNotMatch(o,/migration=parseLastJson/);assert.match(o,/migrationOutput=psql\(migrationSql\(\)\)/);assert.match(o,/committed:true/)});
test('final readback remains mandatory',()=>{const o=r.patchSource(fixture);assert.match(o,/finalCheck=parseLastJson/);assert.match(o,/language_gate_postcheck_missing/)});
test('bound to current production sha',()=>assert.equal(r.EXPECTED_SHA,'00b5e035f823f65156e1ebd04c0f9de1367efe230de8c9fcb5438c6159d90a72'));
