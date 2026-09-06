'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const TARGET=path.join(__dirname,'selfmaint-exec-level3-persistence-remediation-v25.js');

test('v25 makes pending selfmaint requests independently readable and binds Level-3 confirmation fail-closed',()=>{
  const m=require(TARGET);
  assert.equal(m.ACTION,'selfmaint_exec_level3_persistence_remediation_v25');
  assert.equal(m.EXPECTED_SHA256,'d8db336881f80589b2ca30e953f8a7a3992d205dd79057ffc2fb0acd11d74c86');
  const source=`
      const record = {
        request_id: requestId,
        request_hash: out?.request?.request_hash || out?.request?.arguments_sha256 || null,
        expires_at: out?.request?.expires_at || null,
        created_at: new Date().toISOString(),
        spec
      };
      atomicJson(requestFile(requestId), record);
      if (body.second_confirmation !== CONFIRMATION) throw new Error('Level-4 confirmation required');
      if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length < 3 || body.note.length > 1000)) throw new Error('invalid_note');
      loadRequest(requestId);
      if (!fs.existsSync(jobFile(requestId))) return json(res, 404, { ok: false, error: 'status_not_found' });
      return json(res, 200, { ok: true, job: sanitize(readJson(jobFile(requestId))) });
`;
  const out=m.transformSource(source);
  assert.match(out,/level: Number\(out\?\.request\?\.level \|\| 4\)/);
  assert.match(out,/risk: String\(out\?\.request\?\.risk \|\| 'critical'\)/);
  assert.match(out,/CONFIRM_LEVEL_3_PRODUCTION/);
  assert.match(out,/Number\(record\.level\) === 3/);
  assert.match(out,/fs\.existsSync\(requestFile\(requestId\)\)/);
  assert.match(out,/status:'pending'/);
  assert.doesNotMatch(out,/if \(!fs\.existsSync\(jobFile\(requestId\)\)\) return json\(res, 404/);
});

test('v25 transform is fail-closed when structural anchors drift',()=>{
  const m=require(TARGET);
  assert.throws(()=>m.transformSource('anchorless'),/anchor/);
});

test('v25 remediation accepts no arbitrary target, path, command or payload input',()=>{
  const m=require(TARGET);
  assert.equal(m.TARGET,'/opt/prhm-agent-selfmaint-exec/server.js');
  assert.equal(m.SERVICE,'prhm-agent-selfmaint-exec.service');
  assert.equal(m.ARBITRARY_INPUT,false);
});

test(
  'v25 waits boundedly for executor health after restart',
  () => {
    const fs=require('node:fs');

    const source=
      fs.readFileSync(
        TARGET,
        'utf8'
      );

    assert.equal(
      source.includes('HEALTH_ATTEMPTS=40'),
      true
    );

    assert.equal(
      source.includes('HEALTH_RETRY_MS=250'),
      true
    );

    assert.equal(
      source.includes('health_not_ready_after_retry'),
      true
    );

    assert.equal(
      source.includes("cp.spawnSync("),
      true
    );

    assert.equal(
      source.includes("'/usr/bin/curl'"),
      true
    );

    assert.equal(
      source.includes("'--unix-socket'"),
      true
    );

    assert.equal(
      source.includes('process.argv[2]'),
      false
    );

    assert.equal(
      source.includes('process.argv[3]'),
      false
    );
  }
);
