'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const x=require('./honartik-u06-mysql-grants-v1.cjs');
const who="'honartik_universal_backup'@'127.0.0.1'";
const good=[
 "GRANT USAGE ON *.* TO "+who+" IDENTIFIED BY PASSWORD '*"+'a'.repeat(40)+"'",
 'GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON `honartik_db`.* TO '+who
];
const verify=rows=>x.verifyExactBackupGrants(rows);
test('exact MariaDB minimal privileges match and never authorize production',()=>{
 const r=verify(good);
 assert.equal(r.granted_scope_review_matches,true);
 assert.equal(r.verified_by_trusted_root,false);
 assert.equal(r.level4_approval_consumed,false);
 assert.equal(r.production_backup_enabled,false);
 assert.equal(r.backend_deploy_authorized,false);
 assert.equal(x.ROOT_PROVISIONING_EXPORTED,false);
 assert.equal(x.ROOT_HANDLER_INSTALLED,false);
});
test('grant ordering and MariaDB quoting accepted only when privileges exact',()=>{
 const rows=[
 "GRANT USAGE ON *.* TO `honartik_universal_backup``127.0.0.1`",
 "GRANT EVENT, TRIGGER, SELECT, SHOW VIEW ON `honartik_db`.* TO `honartik_universal_backup``127.0.0.1`"
 ];
 assert.equal(verify(rows).granted_scope_review_matches,true);
});
test('reject write/admin/extra grants, wildcard schemas and GRANT OPTION',()=>{
 for(const change of [
  'GRANT ALL PRIVILEGES ON `honartik_db`.* TO '+who,
  'GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, INSERT ON `honartik_db`.* TO '+who,
  'GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON *.* TO '+who,
  'GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON `mysql`.* TO '+who,
  'GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON `honartik_db`.* TO '+who+' WITH GRANT OPTION',
  'GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, SELECT ON `honartik_db`.* TO '+who,
  'GRANT SELECT, TRIGGER, EVENT ON `honartik_db`.* TO '+who,
  'GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON `honartik_db`.* TO '+who.replace('127.0.0.1','localhost'),
  'GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON `honartik_db`.* TO '+who.replace('honartik_universal_backup','root')
 ])assert.throws(()=>verify([good[0],change]),/u06_mysql_grants_/);
 assert.throws(()=>verify([...good,'GRANT USAGE ON *.* TO '+who]),/invalid_or_unexpected_grant_rows/);
});
test('reject malicious suffixes and wrong principal',()=>{
 for(const s of [" WITH GRANT OPTION"," WITH MAX_USER_CONNECTIONS 0"," REQUIRE NONE", " IDENTIFIED BY PASSWORD 'plaintext'"]){
  assert.throws(()=>verify([good[0]+s,good[1]]),/u06_mysql_grants_/);
 }
 assert.throws(()=>verify([good[0].replace("127.0.0.1","%"),good[1]]),/u06_mysql_grants_/);
});
test('reject duplicates, missing grants, control payload and blank input',()=>{
 for(const rows of [[],[good[0]],[good[1]],[good[0],good[0]], [good[1],good[1]],
  [good[0]+'\nDROP USER',good[1]],null,"foo"]){
  assert.throws(()=>verify(rows),/u06_mysql_grants_/);
 }
});
test('review report does not reproduce password hashes',()=>{
 const r=verify(good);
 assert.ok(!JSON.stringify(r).includes('*'+'a'.repeat(40)));
 assert.deepEqual(r.privileges,['EVENT','SELECT','SHOW VIEW','TRIGGER']);
});
