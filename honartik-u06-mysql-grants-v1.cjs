'use strict';
/**
 * U06 exact MariaDB backup-only grant attestation.
 *
 * Consumes SHOW GRANTS rows from a trusted MariaDB session; does NOT
 * connect to MySQL, create an account or credential, install Root,
 * authorize U06, or deploy an application. The only valid user/host is
 * honartik_universal_backup@127.0.0.1, and the only database privileges
 * are SELECT, SHOW VIEW, TRIGGER and EVENT on honartik_db.*.
 *
 * Caller-provided rows are evidence candidates, NOT a signed live proof.
 * The future dedicated Root action MUST run SHOW GRANTS itself after a
 * consumed one-use L4 approval and bind the result to the Root journal.
 */
const crypto=require('node:crypto');
const SCOPE=Object.freeze({
 operation:'honartik_back.production.native_backup',
 user:'honartik_universal_backup',
 host:'127.0.0.1',
 database:'honartik_db',
 grants:Object.freeze(['EVENT','SELECT','SHOW VIEW','TRIGGER'])
});
const fail=x=>{throw Error('u06_mysql_grants_'+x)};
const REQUIRED=SCOPE.grants.join('|');
const ACCOUNT="(?:'honartik_universal_backup'|\\x60honartik_universal_backup\\x60)@(?:'127\\.0\\.0\\.1'|\\x60127\\.0\\.0\\.1\\x60)";
const GRANT_RE=new RegExp('^GRANT (.+?) ON (.+?) TO '+ACCOUNT+'(.*)$','i');
const GLOBAL_RE=/^(?:IDENTIFIED BY PASSWORD '\*[a-f0-9]{40}'|IDENTIFIED VIA mysql_native_password USING '\*[a-f0-9]{40}')?$/i;
function verifyExactBackupGrants(rows){
 if(!Array.isArray(rows)||rows.length!==2||rows.some(x=>
   typeof x!=='string'||x.length>2048||/[\x00-\x09\x0b-\x1f\x7f]/.test(x)))
   fail('invalid_or_unexpected_grant_rows');
 let usage=false,scoped=false;
 for(const raw of rows){
  const line=raw.trim();
  const m=line.match(GRANT_RE);
  if(!m)fail('unrecognized_principal_or_grant');
  const perms=m[1].toUpperCase().trim();
  const target=m[2].trim().replace(/`/g,'');
  const suffix=m[3].trim();
  if(perms==='USAGE'&&target==='*.*'){
   if(usage||!GLOBAL_RE.test(suffix))fail('global_grant_or_auth_policy_not_minimal');
   usage=true;
  }else if(target===SCOPE.database+'.*'){
   if(scoped||suffix)fail('extra_grant_option_or_clause');
   const list=perms.split(',').map(s=>s.trim()).sort();
   if(list.join('|')!==REQUIRED||new Set(list).size!==4)
    fail('schema_privileges_not_exact');
   scoped=true;
  }else fail('unexpected_grant_scope');
 }
 if(!usage||!scoped)fail('usage_or_schema_grant_missing');
 return Object.freeze({
  schema:'prhm.u06.mysql.grant-scope-review.v1',
  account:SCOPE.user,
  host:SCOPE.host,
  database:SCOPE.database,
  privileges:Object.freeze([...SCOPE.grants]),
  granted_scope_review_matches:true,
  verified_by_trusted_root:false,
  level4_approval_consumed:false,
  production_backup_enabled:false,
  backend_deploy_authorized:false,
  scope_digest_sha256:crypto.createHash('sha256').update(
   JSON.stringify({account:SCOPE.user,host:SCOPE.host,
     database:SCOPE.database,grants:SCOPE.grants})).digest('hex')
 });
}
module.exports=Object.freeze({SCOPE,verifyExactBackupGrants,
 ROOT_HANDLER_INSTALLED:false,
 ROOT_PROVISIONING_EXPORTED:false,
 PRODUCTION_BACKUP_AUTHORIZED:false});
