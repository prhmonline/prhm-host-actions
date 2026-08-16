const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const helper=path.join(root,'leadops-parscoders-runtime-v3-restore-v1.js');
const boot=path.join(root,'bootstrap-host-actions-v12-parscoders-runtime-v3-restore.js');

test('v12 restore helper is exact-source-bound, least-privilege, direct-psql and rollback-capable',()=>{
  assert.equal(fs.existsSync(helper),true,'helper must exist');
  const s=fs.readFileSync(helper,'utf8');
  for(const x of [
    'fb8af82a47bf219f30b5d460220491457d105c12cd997886ec4e3bd71abf5b79',
    '61459e3934107d25a88cc4c375c880bb4faa6f59df755f62c46d62b51244cb61',
    '/home/drtarjomeh/leadops/runtime-v3/collector',
    '/home/drtarjomeh/leadops/runtime-v3/scorer',
    "const RUNTIME='/home/drtarjomeh/leadops/runtime-v3'",
    "const RULES=RUNTIME+'/rules-v3-parscoders.sql'",
    "const ENV_FILE=RUNTIME+'/.env'",
    'leadops_parscoders',
    'GRANT SELECT ON marketplace.sources',
    'GRANT SELECT, INSERT, UPDATE ON marketplace.opportunities',
    'GRANT SELECT, INSERT ON marketplace.opportunity_evaluations',
    'GRANT INSERT ON automation.outbox_events',
    'GRANT CONNECT, TEMP ON DATABASE leadops',
    "User=drtarjomeh",
    "Group=drtarjomeh",
    '40-runtime-v3-canonical.conf',
    'leadops-parscoders-collector.timer',
    '--preflight-only',
    'rollback',
    'outbox_published',
    'bids_submitted',
    'proposal_send:false',
    'bid_send:false',
    'p0_live:false',
    'p0_decision:false',
  ]) assert.ok(s.includes(x),`missing ${x}`);
  assert.match(s,/\/usr\/bin\/psql/);
  assert.doesNotMatch(s,/usermod[^\n]*docker|gpasswd[^\n]*docker|groupmod[^\n]*docker/);
  assert.match(s,/collector_still_privileged/);
  assert.match(s,/scorer_still_privileged/);
  assert.match(s,/if\(\/docker exec\|leadops_admin\/.test\(collector\)\)/);
  assert.match(s,/if\(\/docker exec\|leadops_admin\/.test\(scorer\)\)/);
  assert.doesNotMatch(s,/PGPASSWORD[^\n]*console|console\.log\([^\n]*password/i);
});

test('v12 runtime identity and grants are intentionally narrower than existing broad roles',()=>{
  assert.equal(fs.existsSync(helper),true,'helper must exist');
  const s=fs.readFileSync(helper,'utf8');
  assert.match(s,/NOSUPERUSER/);
  assert.match(s,/NOCREATEDB/);
  assert.match(s,/NOCREATEROLE/);
  assert.match(s,/NOINHERIT/);
  assert.doesNotMatch(s,/GRANT\s+(DELETE|TRUNCATE|REFERENCES|TRIGGER|CREATE)/i);
  assert.doesNotMatch(s,/PGUSER=(leadops_admin|leadops_app|leadops_p0_shadow|leadops_ro)/);
});

test('v12 bootstrap registers a fresh critical Level-4 action with fixed helper dispatch',()=>{
  assert.equal(fs.existsSync(boot),true,'bootstrap must exist');
  const s=fs.readFileSync(boot,'utf8');
  for(const x of [
    'leadops_parscoders_runtime_v3_restore_v1',
    'host_action.leadops_parscoders_runtime_v3_restore_v1',
    '1.12.0-host-actions-v2-parscoders-runtime-v3-restore',
    '2026-08-16.2-leadops-parscoders-runtime-v3-restore-v1',
    'risk:\'critical\'',
    'level:4',
    '--preflight-only',
  ]) assert.ok(s.includes(x),`missing ${x}`);
  assert.match(s,/production_mutation:false/);
  assert.match(s,/database_mutation:false/);
  assert.match(s,/proposal_send:false/);
  assert.match(s,/bid_send:false/);
});
