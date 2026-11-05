'use strict';
// Regression contract for exact-credential rollback in the PHP enrollment source.
// These static assertions supplement (do not replace) isolated DB rollback tests.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('scripts/honartik-config-center-prod-enroll-20261012.php','utf8');
test('rollback selects a credential using a specific hashed private token',()=>{
 assert.match(source,/function revokeBoundToken\(Site \$site, string \$token\): int/);
 assert.match(source,/->where\('token_hash', hash\('sha256', \$token\)\)/);
 assert.match(source,/->where\('name', CREDENTIAL_NAME\)/);
 assert.match(source,/->whereNull\('revoked_at'\)->lockForUpdate\(\)->first\(\)/);
});
test('forbid name-wide revocation even during failure recovery',()=>{
 assert.doesNotMatch(source,/function revokeByName/);
 assert.doesNotMatch(source,/revokeByName\(/);
 assert.match(source,/if \(\$created && \$site !== null && is_string\(\$token\)\)/);
 assert.match(source,/try \{ revokeBoundToken\(\$site, \$token\); \}/);
});
test('missing credential file with live DB record fails closed',()=>{
 assert.match(source,/if \(\$boundToken === null\)/);
 assert.match(source,/throw new RuntimeException\('unbound_live_credential'\)/);
 assert.match(source,/throw new RuntimeException\('bound_credential_not_revoked'\)/);
});
test('rollback file removal is token-bound and cannot remove rotated token',()=>{
 assert.match(source,/function removeSecretOwned\(string \$candidate\)/);
 assert.match(source,/hash_equals\(\$candidate, \$current\)/);
 assert.match(source,/throw new RuntimeException\('private_file_ownership_mismatch'\)/);
});
test('issued and revoked credentials always remain read-only tenant honartik',()=>{
 assert.match(source,/where\('slug', 'honartik'\)/);
 assert.match(source,/if \(\$item->scopes !== \['config:read'\]\)/);
 assert.match(source,/\$secretsStatus === 403/);
 assert.match(source,/\$configStatus === 200/);
});
test('no secret is put into stdout or URL parameters',()=>{
 assert.doesNotMatch(source,/echo\s+\$token/);
 assert.doesNotMatch(source,/print_r\(\$token/);
 assert.doesNotMatch(source,/CURLOPT_URL.*\$token/);
 assert.match(source,/CURLOPT_HTTPHEADER => \['Accept: application\/json', 'Authorization: Bearer ' \./);
});
