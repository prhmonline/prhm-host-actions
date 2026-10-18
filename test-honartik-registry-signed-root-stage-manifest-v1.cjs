'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const boundary=require('./honartik-staging-privilege-boundary-install-v1.js');
const review=require('./bootstrap-host-actions-honartik-staging-privilege-boundary-install-v1.js');
const stage=require('./honartik-registry-signed-root-stage-v1.cjs');
const testFile=path.join(__dirname,'test-honartik-staging-privilege-boundary-install-v1.js');
const PREFIX='const PINNED_OFFLINE_MANIFEST_BYTES=Object.freeze(';
function fixtures(){
 const line=fs.readFileSync(testFile,'utf8').split('\n').find(s=>s.startsWith(PREFIX));
 assert.ok(line&&line.endsWith(');'),'exact pinned reviewed manifest source fixture missing');
 const o=JSON.parse(line.slice(PREFIX.length,-2));
 assert.deepEqual(Object.keys(o).sort(),Object.keys(boundary.PINS).sort());
 return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,Buffer.from(v,'utf8')]));
}
test('canonical 35-asset+systemd reviewed closure creates exact 46 fixed operations',()=>{
 const manifestBytes=fixtures();
 const pinned=review.plan({manifestBytes,observedOwnerSha256:{...boundary.OWNERS}});
 assert.equal(stage.validateStage(pinned),pinned);
 assert.equal(pinned.operations.length,46);
 assert.equal(pinned.operations.filter(o=>o.kind==='mkdir_if_absent_root_only').length,10);
 assert.equal(pinned.operations.filter(o=>o.kind==='create_exclusive_pinned_git_file').length,36);
 assert.equal(pinned.operations.at(-1).destination,boundary.UNIT);
 assert.equal(pinned.installs,false);
 assert.equal(pinned.safe_to_request_l4,false);
});
test('tampered reviewed manifest fails before plan construction',()=>{
 const manifests=fixtures();
 manifests.runner[10]^=1;
 assert.throws(()=>review.plan({
    manifestBytes:manifests,observedOwnerSha256:{...boundary.OWNERS}
 }));
});
test('four protected owner SHA-256 pins cannot be bypassed by a forged observation',()=>{
 const manifests=fixtures();
 assert.throws(()=>review.plan({
    manifestBytes:manifests,
    observedOwnerSha256:{...boundary.OWNERS,executor:'f'.repeat(64)}
 }));
});
