'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const base=path.join(__dirname,'test-fixtures/honartik-open-price-live-inventory');
const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8'));
const source=fs.readFileSync(path.join(base,manifest.sourcePath));
const str=source.toString('utf8');
const gitBlob=b=>crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
test('source is exact immutable backend Git blob',()=>{
  assert.match(manifest.sourceBlob,/^[a-f0-9]{40}$/);
  assert.equal(gitBlob(source),manifest.sourceBlob);
  assert.equal(manifest.expectedLiveBackendSha,'502376d0360a338f9522e4a2be5f9dccc91408d7');
});
test('read-only Yii DB session and guaranteed rollback',()=>{
  assert.match(str,/SET TRANSACTION READ ONLY/);
  assert.match(str,/beginTransaction\(\)/);
  assert.match(str,/\$tx->rollBack\(\)/);
  assert.match(str,/SELECT DATABASE\(\)/);
  assert.match(str,/LIVE_MIGRATION_INVENTORY=PASS/);
  assert.equal(manifest.noProductionMutation,true);
});
test('examines exact finance and feature columns, and both canonical migration history records',()=>{
  for(const key of ['finance_transactions','finance_wallet','paying_amount',
  'free_price_enabled','free_price_enabled_snapshot',
  'm261016_105000_open_price_money_capacity',
  'm261016_110000_open_price_schedules','system_db_migration'])
    assert.ok(str.includes(key),key);
});
test('unrelated migrations are counted, never executed',()=>{
  assert.match(str,/DirectoryIterator/);
  assert.match(str,/APP_DB_UNRELATED_PENDING_COUNT/);
  assert.match(str,/APP_DB_LOOKUP_SCOPE_ONLY=YES/);
  assert.match(str,/DEPLOY_READY=NO/);
  for(const forbidden of [/\bmigrate\/up\b/,/->(?:insert|update|delete|batchInsert)\s*\(/,
     /\b(?:ALTER|CREATE|DROP|TRUNCATE)\s+TABLE\b/i,
     /\bMigration::safeUp\b/,/\bSET\s+TRANSACTION\s+READ\s+WRITE\b/i])
     assert.doesNotMatch(str,forbidden);
});
