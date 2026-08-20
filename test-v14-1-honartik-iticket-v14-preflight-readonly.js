'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROUTE_FILE=path.join(__dirname,'honartik-iticket-v14-preflight-readonly-routes.js');

test('runtime module exposes the fixed zero-input contract',()=>{
  const route=require(ROUTE_FILE);
  assert.equal(typeof route.registerHonartikIticketV14PreflightRoutes,'function');
  assert.equal(typeof route.runPinnedPreflight,'function');
  assert.equal(route.TOOL,'honartik_iticket_v14_preflight_readonly');
  assert.equal(route.ROUTE,'/honartik/iticket/v14/preflight');
  assert.equal(route.V14_SHA,'134ef8c0828b6c941b98e0d5c3ecb5d6ceaff1e1bf6ef73daabc79a92f5d8b78');
});

test('runtime source contains no public arbitrary execution surface',()=>{
  const source=fs.readFileSync(ROUTE_FILE,'utf8');
  assert.match(source,/app\.post\(ROUTE,auth,/);
  assert.match(source,/Object\.keys\(body\)\.length!==0/);
  assert.doesNotMatch(source,/req\.body\.(command|path|ref|host|token)/);
  assert.match(source,/iticket_v14_preflight_network_denied/);
  assert.match(source,/iticket_v14_preflight_child_process_denied/);
});
