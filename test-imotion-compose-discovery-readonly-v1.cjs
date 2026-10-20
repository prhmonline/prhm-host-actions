'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('./imotion-compose-discovery-readonly-v1.cjs');

function detail(name) {
  return [{
    Name:'/' + name,
    Config:{Labels:{
      'com.docker.compose.project':'imotion',
      'com.docker.compose.project.working_dir':'/srv/imotion',
      'com.docker.compose.project.config_files':'/srv/imotion/docker-compose.yml',
      'com.docker.compose.service':name.slice('imotion-'.length),
      'SECRET':'must-not-appear'
    }, Env:['TOKEN=must-not-appear']},
    Mounts:[
      {Type:'bind',Source:'/private/source',Destination:'/app',RW:true},
      {Type:'volume',Source:'/var/lib/docker/volumes/secret',
        Name:'imotion_data',Destination:'/data'}
    ]
  }];
}

test('fixed six-container scope with trusted inspector dependency only', async () => {
  const called = [];
  const result = await handler.discover(async name => {
    called.push(name);
    return detail(name);
  });
  assert.deepEqual(called, handler.CONTAINERS);
  assert.equal(result.complete, true);
  assert.equal(result.production_mutation, false);
  assert.equal(result.containers.length, 6);
  const output = JSON.stringify(result);
  for (const privateValue of ['/private/source','/var/lib/docker/volumes/secret','must-not-appear','TOKEN=']) {
    assert.ok(!output.includes(privateValue), 'sensitive data leaked');
  }
  assert.equal(result.containers[0].mounts[1].named_volume, 'imotion_data');
});

test('rejects unapproved name, missing container, spoofed identity, missing Compose labels', async () => {
  assert.throws(() => handler.normalizedContainer('other', detail('other')), /allowlisted/);
  await assert.rejects(handler.discover(async () => []), /container_missing/);
  await assert.rejects(handler.discover(async name => detail('other')), /container_identity/);
  const incomplete = detail('imotion-node');
  delete incomplete[0].Config.Labels['com.docker.compose.project.config_files'];
  await assert.rejects(handler.discover(async () => incomplete), /compose_labels_missing/);
});

test('rejects missing authorized inspector, oversized labels and unrecognized mounts', async () => {
  await assert.rejects(handler.discover(null), /trusted_inspector_required/);
  const excessive = detail('imotion-node');
  excessive[0].Config.Labels['com.docker.compose.project.working_dir'] = 'x'.repeat(1025);
  assert.throws(() => handler.normalizedContainer('imotion-node', excessive), /untrusted_label/);
  const invalidMount = detail('imotion-node');
  invalidMount[0].Mounts[0].Type = 'device';
  assert.throws(() => handler.normalizedContainer('imotion-node', invalidMount), /mount_type_unknown/);
});

test('has no public shell, docker or mutation executor', () => {
  assert.equal(handler.ACTION, 'imotion_compose_discovery_readonly_v1');
  assert.equal(typeof handler.exec, 'undefined');
  assert.equal(typeof handler.spawn, 'undefined');
  assert.equal(typeof handler.install, 'undefined');
  assert.equal(typeof handler.deploy, 'undefined');
});
