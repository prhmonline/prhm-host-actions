const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const helper=fs.readFileSync(path.join(root,'leadops-parscoders-runtime-v3-restore-v1.js'),'utf8');
const bootstrap=fs.readFileSync(path.join(root,'bootstrap-host-actions-v12-parscoders-runtime-v3-restore.js'),'utf8');

test('ParsCoders role grants only conflict-target SELECT needed by ON CONFLICT DO NOTHING',()=>{
  assert.match(helper,/GRANT SELECT \(idempotency_key\) ON automation\.outbox_events TO leadops_parscoders;/);
  assert.doesNotMatch(helper,/GRANT SELECT ON automation\.outbox_events TO leadops_parscoders;/);
  assert.match(helper,/has_column_privilege\('\$\{ROLE\}','automation\.outbox_events','idempotency_key','SELECT'\)/);
  assert.match(helper,/outbox_idempotency_select/);
});

test('canonical v12 bootstrap embeds the fixed helper byte-for-byte',()=>{
  const m=bootstrap.match(/const HELPER_B64='([^']+)'/);
  const h=bootstrap.match(/const HELPER_SHA='([a-f0-9]{64})'/);
  assert.ok(m&&h,'bootstrap helper payload/hash anchors must exist');
  const payload=Buffer.from(m[1],'base64');
  const crypto=require('node:crypto');
  const helperBuf=fs.readFileSync(path.join(root,'leadops-parscoders-runtime-v3-restore-v1.js'));
  assert.deepEqual(payload,helperBuf);
  assert.equal(crypto.createHash('sha256').update(payload).digest('hex'),h[1]);
});
