'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const transport = require('./imotion-compose-fixed-host-inspector-v1.cjs');

const LABELS={
  'com.docker.compose.project':'imotion',
  'com.docker.compose.project.working_dir':'/srv/imotion',
  'com.docker.compose.project.config_files':'/srv/imotion/docker-compose.yml',
  'com.docker.compose.service':'node'
};

test('transport binds only fixed remote alias and allowlisted container', async () => {
  let called=0;
  const fake=async (binary,args,opts)=>{
    called++;
    assert.equal(binary,'/usr/bin/ssh');
    assert.equal(args[args.length-1],'imotion-node');
    assert.deepEqual(args.slice(-5),['imotion-prod-vm','docker','inspect','--type','container','imotion-node'].slice(-5));
    assert.equal(args.includes('StrictHostKeyChecking=yes'),true);
    assert.equal(opts.shell,false);
    assert.equal(opts.timeout,25000);
    assert.ok(opts.maxBuffer <= 262144);
    return {stdout:JSON.stringify([{Name:'/imotion-node',Config:{Labels:LABELS},Mounts:[]}])};
  };
  assert.deepEqual((await transport.inspectFixedContainer('imotion-node',fake))[0].Name,'/imotion-node');
  assert.equal(called,1);
  await assert.rejects(transport.inspectFixedContainer('other',fake),/not_allowlisted/);
  assert.equal(called,1);
});

test('remote failure and invalid output have fixed non-sensitive error messages', async () => {
  await assert.rejects(
    transport.inspectFixedContainer('imotion-node',async()=>{throw Error('secret key!');}),
    err=>err.message==='imotion_compose_remote_inspection_failed');
  await assert.rejects(
    transport.inspectFixedContainer('imotion-node',async()=>({stdout:'{TOKEN=secret'})),
    err=>err.message==='imotion_compose_remote_json_invalid');
  await assert.rejects(
    transport.inspectFixedContainer('imotion-node',async()=>({stdout:'[]'})),
    err=>err.message==='imotion_compose_remote_identity_invalid');
});

test('transport does not expose general remote command, deploy, or shell adapter',()=>{
  for(const method of ['exec','spawn','deploy','restart','command']) {
    assert.equal(typeof transport[method], 'undefined');
  }
  assert.equal(transport.discoverOnFixedHost.length, 0);
});
