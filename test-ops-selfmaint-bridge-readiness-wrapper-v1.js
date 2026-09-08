#!/usr/bin/env node
'use strict';
const fs=require('fs'),assert=require('assert');
const p=process.argv[2];assert(p,'wrapper path required');const src=fs.readFileSync(p,'utf8');
assert(src.includes("const BASE_BRIDGE_SHA='df5ae0789529f982e2c5321be87dc07c8b174676df7bced18dd1801f30deaa30'"));
assert(src.includes("for(let i=0;i<40;i++)"));
assert(src.includes("Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250)"));
assert(src.includes("readiness_wrapper_base_backup_missing"));
assert(src.includes("readiness_wrapper_anchor_mismatch"));
console.log('ops-selfmaint readiness wrapper contract PASS');
