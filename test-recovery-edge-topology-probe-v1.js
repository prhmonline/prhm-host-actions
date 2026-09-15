\'use strict\';
const test=require('node:test');
const assert=require('node:assert/strict');
const probe=require('./recovery-edge-topology-probe-v1.js');

test('identity and request surface are immutable',()=>{
  assert.equal(probe.ACTION,'recovery_edge_topology_probe_v1');
  assert.equal(probe.OPERATION,'host_action.recovery_edge_topology_probe_v1');
  assert.equal(probe.READ_ONLY,true);
  assert.equal(probe.RISK,'low');
  assert.deepEqual(probe.REQUEST_FIELDS,[]);
  assert.equal(probe.SERVICE,'prhm-recovery-edge.service');
});

test('node1 targets and credentials are fixed',()=>{
  assert.deepEqual(probe.NODE1_HOSTS,['10.71.0.1','185.191.76.138']);
  assert.deepEqual(probe.KEY_CANDIDATES,[
    '/root/.ssh/prhm_controlplane_ed25519',
    '/root/.ssh/id_ed25519',
    '/root/.ssh/id_rsa'
  ]);
});

test('remote script is strictly read-only and service-scoped',()=>{
  const script=probe.remoteScript();
  assert.match(script,/prhm-recovery-edge\\.service/);
  assert.match(script,/systemctl show/);
  assert.match(script,/FragmentPath/);
  assert.match(script,/ExecStart/);
  assert.match(script,/sha256sum/);
  assert.match(script,/9080/);
  assert.match(script,/9444/);
  for(const forbidden of [
    /systemctl\\s+(restart|start|stop|reload|enable|disable|mask|unmask)/i,
    /\\b(rm|mv|cp|install|chmod|chown|truncate|dd)\\b/,
    /sed\\s+-i/,
    /\\btee\\b/,
    /firewall-cmd/,
    /iptables/,
    /nft\\s/,
    /curl\\s+.*-X\\s*(POST|PUT|PATCH|DELETE)/i
  ]) assert.doesNotMatch(script,forbidden);
});

test('ssh attempts are fixed and cannot accept caller host, command, path or credential',()=>{
  const fsOps={statSync(p){if(p.endsWith('prhm_controlplane_ed25519'))return{isFile:()=>true};throw Object.assign(new Error('no'),{code:'ENOENT'});}};
  const attempts=probe.buildSshAttempts(fsOps);
  assert.equal(attempts.length,2);
  assert.equal(attempts[0].target,'root@10.71.0.1');
  assert.equal(attempts[1].target,'root@185.191.76.138');
  for(const a of attempts){
    assert.equal(a.file,'/usr/bin/ssh');
    assert.ok(a.args.includes('bash'));
    assert.ok(a.args.includes('-s'));
    assert.ok(a.args.includes('/root/.ssh/prhm_controlplane_ed25519'));
    assert.equal(a.input,probe.remoteScript());
  }
});

test('parser returns only bounded topology evidence',()=>{
  const sample=[
    'Id=prhm-recovery-edge.service',
    'LoadState=loaded',
    'ActiveState=active',
    'SubState=running',
    'FragmentPath=/etc/systemd/system/prhm-recovery-edge.service',
    'ExecStart={ path=/usr/local/bin/prhm-node ; argv[]=/usr/local/bin/prhm-node /opt/prhm-recovery-edge/server.js ; }',
    'UNIT_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'CANDIDATE_PATH=/opt/prhm-recovery-edge/server.js',
    'CANDIDATE_SHA256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'LISTENER=LISTEN 0 511 127.0.0.1:9444 0.0.0.0:*',
    'LISTENER=LISTEN 0 511 127.0.0.1:9080 0.0.0.0:*'
  ].join('\\n');
  const out=probe.parseEvidence(sample);
  assert.equal(out.service.id,'prhm-recovery-edge.service');
  assert.equal(out.service.fragment_path,'/etc/systemd/system/prhm-recovery-edge.service');
  assert.equal(out.service.unit_sha256,'a'.repeat(64));
  assert.deepEqual(out.candidates,[{path:'/opt/prhm-recovery-edge/server.js',sha256:'b'.repeat(64)}]);
  assert.equal(out.listeners.length,2);
  assert.equal(JSON.stringify(out).includes('PRIVATE KEY'),false);
});

test('execution fails closed when node1 is unreachable',()=>{
  const spawn=()=>({status:255,stdout:'',stderr:'connection refused'});
  const fsOps={statSync(){throw Object.assign(new Error('no'),{code:'ENOENT'});}};
  const out=probe.runProbe({spawnSync:spawn,fsOps});
  assert.equal(out.ok,false);
  assert.equal(out.read_only,true);
  assert.equal(out.error,'node1_unreachable');
  assert.equal(out.attempts.length,2);
});
