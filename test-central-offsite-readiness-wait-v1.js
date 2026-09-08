#!/usr/bin/env node
'use strict';
const assert=require('assert');
const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');
assert(src.includes("for(let i=0;i<40;i++)"));
assert(src.includes("Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250)"));
assert(src.includes("if(!ready)fail('central_offsite_executor_reload_failed')"));
console.log('central-offsite executor readiness wait contract PASS');
