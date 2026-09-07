const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const helper=require('./honartik-iticket-pretoken-prepare-v1.js');

test('helper is bound to current Honartik production baseline and isolated branch',()=>{
  assert.equal(helper.ACTION,'honartik_iticket_pretoken_prepare_v1');
  assert.equal(helper.ROOT,'/home/honartik/domains/dashboard.honartik.ir/public_html');
  assert.equal(helper.WORKTREE,'/home/honartik/worktrees/iticket-pretoken-v1-back');
  assert.equal(helper.BRANCH,'feature/iticket-pretoken-v1');
  assert.equal(helper.EXPECTED_HEAD,'1eb4335da14f9eacf23b9d5fd4288c133786386c');
  assert.equal(helper.LEGACY_PROVIDER_SHA256,'ca14ecdc210c418686c73d5ef60b150adc0629d6b943b32d11d0d06dd3a3bdf6');
});

test('rendered provider removes embedded credentials and keeps seller API contract configurable',()=>{
  const files=helper.renderFiles();
  const provider=files['app/components/external/base.php'];
  assert.equal(typeof provider,'string');
  assert.match(provider,/https:\/\/seller\.iticket\.ir\/api\/v1/);
  assert.match(provider,/ITICKET_API_ACCESS_TOKEN/);
  assert.match(provider,/ITICKET_AUTH_HEADER/);
  assert.match(provider,/ITICKET_AUTH_PREFIX/);
  assert.match(provider,/function publicStatus\(/);
  assert.match(provider,/function reserve\(/);
  assert.match(provider,/function sale\(/);
  assert.match(provider,/function cancel\(/);
  assert.doesNotMatch(provider,/Bearer\s+eyJ/);
  assert.doesNotMatch(provider,/echo\s+["']cURL Error/);
  assert.doesNotMatch(provider,/exit\s*\(/);
  assert.match(provider,/CURLOPT_FOLLOWLOCATION\s*=>\s*false/);
  assert.match(provider,/CURLOPT_CONNECTTIMEOUT\s*=>\s*5/);
  assert.match(provider,/CURLOPT_TIMEOUT\s*=>\s*15/);
});

test('standalone PHP test proves dual gate, secret redaction and both auth header profiles',()=>{
  const files=helper.renderFiles();
  const t=files['app/components/external/tests/IticketExternalProviderTest.php'];
  assert.match(t,/ITICKET_EXTERNAL_PROVIDER_TEST=PASS/);
  assert.match(t,/disabled must make zero transport calls/);
  assert.match(t,/public status must not expose token/);
  assert.match(t,/X-Api-Access-Token/);
  assert.match(t,/Authorization/);
});

test('helper source forbids token reads, external network and production app writes by construction',()=>{
  const runtime=helper.execute.toString()+helper.preflightState.toString();
  const src=fs.readFileSync(path.join(__dirname,'honartik-iticket-pretoken-prepare-v1.js'),'utf8');
  assert.doesNotMatch(runtime,/process\.env\.ITICKET_API_ACCESS_TOKEN/);
  assert.doesNotMatch(runtime,/curl|https\.request|http\.request|fetch\s*\(/i);
  assert.match(src,/production_application_tree_mutation:false/);
  assert.match(src,/database_mutation:false/);
  assert.match(src,/external_network:false/);
  assert.match(src,/token_read:false/);
});
