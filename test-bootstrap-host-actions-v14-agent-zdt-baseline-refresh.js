const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'bootstrap-host-actions-v14-agent-zdt-baseline-refresh.js');

test('installer exists',()=>assert.equal(fs.existsSync(file),true,'installer must exist'));
test('installer registers one fixed Level-4 action across four control-plane layers',()=>{
  const s=fs.readFileSync(file,'utf8');
  assert.match(s,/agent_zdt_baseline_refresh_v1/);
  assert.match(s,/host_action\.agent_zdt_baseline_refresh_v1/);
  assert.match(s,/\/opt\/prhm-agent-selfmaint\/server\.js/);
  assert.match(s,/\/opt\/prhm-agent-selfmaint-exec\/server\.js/);
  assert.match(s,/\/opt\/prhm-company-control-plane\/config\/approval-policy\.json/);
  assert.match(s,/\/home\/agent\/ssh-mcp-server\/src\/plugins\/hostActionsV2\.js/);
  assert.match(s,/\/opt\/prhm-agent-selfmaint-exec\/actions\/agent-zdt-baseline-refresh-v1\.js/);
  assert.match(s,/--preflight-only/);
  assert.match(s,/--apply/);
  assert.match(s,/rollback/);
  assert.match(s,/b0ada3809307005d7715a1c7c970687b65ace82e765c8dfaeb5408061477b4ae/);
  assert.match(s,/6b945fcb3afe8ef3e074b07745912c5183f28826728bf4d14ed93c1161c961ba/);
  assert.match(s,/139e5571086b5ead1805e959d9a66866bd9ef3be19ead760a6281c63956a0e18/);
  assert.match(s,/7362fcf00bff04e46287df574f875110603d8c7da8b1bb207e9e609dc86c5b85/);
});
