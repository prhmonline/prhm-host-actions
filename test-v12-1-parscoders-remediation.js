const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const file=path.join(root,'remediate-host-actions-v12-1-parscoders-outbox-privilege.js');

test('v12.1 remediation is helper-only, exact-state-bound and rollback-capable',()=>{
  assert.equal(fs.existsSync(file),true,'remediation must exist');
  const s=fs.readFileSync(file,'utf8');
  for(const x of [
    "const OLD_HELPER_SHA='525a68322e8c980fff243505e2da43a4842b197cceca81d81c2fb277d35dfeb5'",
    "const NEW_HELPER_SHA='15e8274230ff33a0a1572430a5928bdd6a54210f687569d8e1009db947432d14'",
    "'/opt/prhm-agent-selfmaint/server.js':'8e12064a1c1cb9bc016196fa23a9d474ad7fcacda86b1466c6600fd04cbe9a54'",
    "'/opt/prhm-agent-selfmaint-exec/server.js':'0b7c6fcb2ead77fcecd55160ed805fc0e9bb5df6ce6cead488a95fee04be14cf'",
    "'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js':'29bad6c7bd165fe445c452927edbbc9c708d5999f571362725256d85bd892023'",
    "'/opt/prhm-company-control-plane/config/approval-policy.json':'c7af99488a67a3edc4fa0e4be1f010f7e9d2dfd82de53413bedc6fae3db221c5'",
    '--preflight-only',
    'helper_only:true',
    'database_mutation:false',
    'business_mutation:false',
    'proposal_send:false',
    'bid_send:false',
    'p0_live:false',
    'p0_decision:false',
    'rollback_failed'
  ]) assert.ok(s.includes(x),`missing ${x}`);
  assert.doesNotMatch(s,/systemctl\s*\W*restart|systemctl\s*\W*enable|systemctl\s*\W*start/);
  assert.doesNotMatch(s,/approval-policy\.json[^\n]*(writeFile|atomic)|hostActionsV2\.js[^\n]*(writeFile|atomic)/);
});
