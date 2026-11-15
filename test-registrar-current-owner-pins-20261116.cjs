'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const trust=require('./shared-registrar-root-trust-preflight-v1.cjs');
const builders=require('./shared-registrar-three-owner-candidate-builder-v1.cjs');
const policy=require('./shared-registrar-policy-candidate-builder-v1.cjs');
const baseline=require('./test-registrar-four-owner-preimage-v1.cjs');
const pinned={
  base:{old:'649941e1a2f77a9a1515327e47fa7176a0ae8f4602042750d53847e568deed0e',bytes:34802,after:'452ac7670963c363f644d9625474aa014a4c1597cfd05dde9f0e656a0f8a2860'},
  executor:{old:'34ce844008fbb7763250cdfa7859ca16360db1aa414fff77d107ffb0ccfa4121',bytes:120352,after:'cffa9924a926467a0706da51d24d926dc324efd91794289f9bae44955e1cdc5d'},
  mcp:{old:'01eb930e8e9177b8754ab5cf36a004cb69141d44b74e70b4d42dc3f0f33f1c56',bytes:12362,after:'2bef3b13bfc7f0609be8e029b1e2f8096c4aa7ea80e56eefbaf93e4a74ea8229'},
  policy:{old:'aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934',bytes:32036,after:'8eb49274cdf12d39823a6d39a05a22d24c9909e18748d0ea7bd7fed0956ce8e7'}
};
test('2026-11-16 owners are SHA-pinned across all review-only modules',()=>{
  const remap={'base.server.js':'base','executor.server.js':'executor','mcp.hostActionsV2.js':'mcp'};
  for(const [owner,value] of Object.entries(pinned)){
    assert.equal(trust.OWNERS[owner].sha256,value.old);
    const row=baseline.SPECS.find(x=>x.owner===owner);
    assert.ok(row);assert.equal(row.sha,value.old);assert.equal(row.bytes,value.bytes);
  }
  for(const [filename,owner] of Object.entries(remap)){
    assert.deepEqual(builders.INPUTS[filename],[pinned[owner].old,pinned[owner].bytes]);
  }
  assert.equal(policy.ORIGINAL_SHA,pinned.policy.old);
  const privateVerifier=fs.readFileSync(path.join(__dirname,'test-registrar-private-four-owner-package-v1.cjs'),'utf8');
  for(const row of Object.values(pinned)){
    assert.ok(privateVerifier.includes(row.old));
    assert.ok(privateVerifier.includes(row.after));
  }
  assert.equal(trust.BACKUP_DIR,'/var/backups/prhm-host-actions-registration/preinstall.20261116-649941e1');
});
test('historical 2026-10 owner SHA pins cannot be used for current installation',()=>{
  const outdated=["4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406","410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0","bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166","148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174"];
  for(const name of ['shared-registrar-root-trust-preflight-v1.cjs',
                     'shared-registrar-three-owner-candidate-builder-v1.cjs',
                     'shared-registrar-policy-candidate-builder-v1.cjs',
                     'test-registrar-four-owner-preimage-v1.cjs',
                     'test-registrar-private-four-owner-package-v1.cjs']){
    const src=fs.readFileSync(path.join(__dirname,name),'utf8');
    for(const hash of outdated)assert.ok(!src.includes(hash),'stale_live_preimage:'+name);
  }
});
test('no installation authority is produced by source-only refresh',()=>{
  assert.equal('install' in trust,false);
  assert.equal('apply' in policy,false);
  assert.equal('deploy' in builders,false);
  assert.equal(trust.VERSION,'2026-10-27.2-shared-registrar-bootstrap-proposal');
});
