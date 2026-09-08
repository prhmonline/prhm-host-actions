#!/usr/bin/env node
'use strict';
const assert=require('assert');
const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');
assert(src.includes("const BASE_SERVER_SHA='8e873aa564f685b6002a273856b523639dd2631533742242236ac8c0c6372154'"));
assert(src.includes("const CURRENT_HELPER_SHA='dda9fa1d892c450153c9a1585bf662797e32545e64d4f80e8e1e631d3b25e508'"));
assert(src.includes("const CURRENT_API_PIN='05b0af5fd6f8ef640ab67ca1ed786818a45b3b439b8fc3fb02ee8cb7b8ccfac8'"));
assert(src.includes("source.replace(OLD_HELPER_SHA,CURRENT_HELPER_SHA).replace(OLD_API_PIN,CURRENT_API_PIN)"));
assert(src.includes("if(count(source,OLD_HELPER_SHA)!==1||count(source,CURRENT_HELPER_SHA)!==0)fail('forward_v5_helper_anchor_mismatch')"));
assert(src.includes("if(count(source,OLD_API_PIN)!==1||count(source,CURRENT_API_PIN)!==0)fail('forward_v5_api_pin_anchor_mismatch')"));
console.log('agent-api forward v5 contract PASS');
