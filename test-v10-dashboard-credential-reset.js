const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const helper=path.join(__dirname,'company-os-dashboard-credentials-reset-v1.js');
const bootstrap=path.join(__dirname,'bootstrap-host-actions-v10-company-os-dashboard-credentials-reset.js');
test('credential reset helper is fixed, state-bound, hash-only and removes old plaintext credential',()=>{
 const s=fs.readFileSync(helper,'utf8');
 for(const sha of [
  '22a1af33eacab4dc898de9c871ecae9b80d29a418108c5c501336d6116a8adf3',
  '17ab12cafb08d85d176117482a70da60ba4425ff4eccebda3b82325eec68e4f8',
  '18d82cd3f88b48f1a0235386c266bc5be120d178192892059252152682b3fe3e']) assert.match(s,new RegExp(sha));
 assert.match(s,/company_os_dashboard_credentials_reset_v1/);
 assert.match(s,/--preflight-only/);
 assert.match(s,/password_sha256/);
 assert.doesNotMatch(s,/PASSWORD_PLAINTEXT|NEW_PASSWORD_PLAINTEXT|password_plaintext/);
 assert.match(s,/unlinkSync\(OLD_CREDENTIALS\)/);
 assert.match(s,/database_mutation:false/);assert.match(s,/business_mutation:false/);assert.match(s,/p0_live:false/);assert.match(s,/proposal_send:false/);assert.match(s,/bid_send:false/);
});
test('v10 registers reset as fresh Level-4 action without weakening Dashboard or send safety',()=>{
 const s=fs.readFileSync(bootstrap,'utf8');
 assert.match(s,/company_os_dashboard_credentials_reset_v1/);
 assert.match(s,/host_action\.company_os_dashboard_credentials_reset_v1/);
 assert.match(s,/level:4/);
 assert.match(s,/risk:'critical'/);
 assert.match(s,/ReadWritePaths=\/etc\/prhm-company-os-dashboard \/var\/lib\/prhm-agent-selfmaint-exec\/company-os-dashboard-v1 \/var\/lib\/prhm-agent-selfmaint-exec\/company-os-dashboard-credentials-reset-v1 \/var\/backups/);
 assert.doesNotMatch(s,/PASSWORD_PLAINTEXT|NEW_PASSWORD_PLAINTEXT|password_plaintext/);
 assert.doesNotMatch(s,/P0_DECISION_ENABLED[^\n]{0,120}(true|1)/i);
});
