'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

const BRIDGE='./bootstrap-host-actions-v30-safe-delivery-candidate-install-bridge.js';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

test('candidate install bridge is fixed, zero-input and self-contained',()=>{
  const m=require(BRIDGE);
  assert.equal(m.ACTION,'safe_delivery_v30_candidate_install_bridge_v1');
  assert.equal(m.INSTALLER_ACTION,'safe_delivery_profile_enable_next_v1');
  assert.deepEqual(m.MODES,['--preflight-only','--apply']);
  assert.equal(m.PATHS.canonicalMcp,'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js');
  assert.equal(m.PATHS.candidateMcp,'/home/agent/candidates/agent3-safe-delivery-profile-expansion/mcp/src/plugins/hostActionsV2.js');
  assert.equal(m.EXPECTED.canonicalMcp,'8f24b6ed70644c1eda7b255a47ccf0d4fabfe03ac7c73dd8799ff9aeb5294075');
  assert.equal(m.EXPECTED.candidateMcp,'103dfdf49f95794e84dfa40d97d1622aabb2efb7a373809010262def63fd00d8');
  const src=fs.readFileSync(BRIDGE,'utf8');
  for(const bad of ['req.body.command','arbitrary_path','eval(','child_process.exec(','process.env.TARGET']) assert.equal(src.includes(bad),false);
});

test('embedded bundle exactly matches reviewed V30 sources',()=>{
  const m=require(BRIDGE);
  const sources=m.embeddedSources();
  const expected={
    core:fs.readFileSync('./safe-delivery-profile-enable-next-v1.js'),
    helper:fs.readFileSync('./safe-delivery-profile-enable-next-helper-v1.js'),
    installer:fs.readFileSync('./bootstrap-host-actions-v30-safe-delivery-profile-enable-next.js')
  };
  for(const key of Object.keys(expected)){
    assert.equal(Buffer.from(sources[key],'utf8').equals(expected[key]),true,key+' bytes');
    assert.equal(sha(Buffer.from(sources[key],'utf8')),sha(expected[key]),key+' sha256');
  }
});

test('bridge refuses in-service MCP execution and only delegates installer install',()=>{
  const m=require(BRIDGE);
  const source=m.apply.toString();
  assert.ok(source.includes('refuseMcpServiceContext'));
  assert.ok(source.includes('installer.install()'));
  assert.equal(source.includes('profile-enablement.json'),false);
  assert.equal(source.includes('cfpark_front_prod'),false);
});
