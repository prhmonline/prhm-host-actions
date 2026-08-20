const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=__dirname;
const helperPath=path.join(ROOT,'honartik-iticket-dark-backend-batch1-v1.js');
const bootstrapPath=path.join(ROOT,'bootstrap-host-actions-v14-honartik-iticket-dark-backend-batch1.js');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

test('helper implements fixed dark Batch 1 contract',()=>{
  assert.equal(fs.existsSync(helperPath),true,'helper must exist');
  const helper=require(helperPath);
  assert.equal(helper.ACTION,'honartik_iticket_dark_backend_batch1_v1');
  assert.equal(helper.FRONT.sha,'ecd3bfce8790b5cb3d32afbfbf45bc39839dba62');
  assert.equal(helper.BACK.sha,'54d8038a64ce64e78c84dfeaffbb4cca36446108');
  assert.equal(helper.FRONT.branch,'feature/iticket-dark-v1');
  assert.equal(helper.BACK.branch,'feature/iticket-dark-v1');
  assert.equal(helper.PAYLOADS.length,3);
  const expected={
    'app/components/iticket/IticketConfig.php':'033b636fd5b491006e2ee6f129720301aea1778f0b3e412423cc25b94ecce66f',
    'app/components/iticket/IticketClient.php':'d717f45ab691ff2da664a0fbfbe964f348f1944d75f80e2b6d9b0f79469ee723',
    'app/components/iticket/tests/DarkGateTest.php':'1153e731f404e45fe3d7b9ce55f0551085ec4394d195512f3ace3762261fd1e2'
  };
  for(const item of helper.PAYLOADS){
    assert.equal(sha(item.bytes),expected[item.rel]);
    assert.equal(item.sha256,expected[item.rel]);
  }
  const config=helper.PAYLOADS.find(x=>x.rel.endsWith('IticketConfig.php')).bytes.toString('utf8');
  const client=helper.PAYLOADS.find(x=>x.rel.endsWith('IticketClient.php')).bytes.toString('utf8');
  const phpTest=helper.PAYLOADS.find(x=>x.rel.endsWith('DarkGateTest.php')).bytes.toString('utf8');
  assert.match(config,/ITICKET_ENABLED/);
  assert.match(config,/ITICKET_API_ACCESS_TOKEN/);
  assert.match(config,/X-Api-Access-Token/);
  assert.doesNotMatch(config,/Bearer/i);
  assert.doesNotMatch(client,/Authorization/);
  assert.match(phpTest,/ITICKET_DARK_GATE_TEST=PASS/);
  assert.match(phpTest,/calls === 0/);
  const source=fs.readFileSync(helperPath,'utf8').replace(/\s+/g,'');
  for(const token of ['database_mutation:false','deploy:false','external_network:false','token_read:false','git_metadata_mutation:false','production_application_tree_mutation:false']) assert.match(source,new RegExp(token));
});

test('bootstrap registers fixed Level-4 action with rollback',()=>{
  assert.equal(fs.existsSync(bootstrapPath),true,'bootstrap must exist');
  const bootstrap=require(bootstrapPath);
  assert.equal(bootstrap.ACTION,'honartik_iticket_dark_backend_batch1_v1');
  assert.equal(bootstrap.BASELINE.base,'b084b501b2ea572b39336e45673b4d987a6f7cdb10c769a4db3191ce86ca2877');
  assert.equal(bootstrap.BASELINE.executor,'5346b24f88c19121898288bd197a8dbe2a18a8c587402cfcd5a27afcfeadacad');
  assert.equal(bootstrap.BASELINE.mcp,'ebe988fb99794ed3e09b2cefa7496c2d47c967a850b900a117b6b762b388cc34');
  assert.equal(bootstrap.BASELINE.policy,'c56f3f7c35e6ac22735f0689371e8ca4a7de6f8c375436a456798f8df0b7596a');
  assert.equal(bootstrap.sha(Buffer.from(bootstrap.HELPER_B64,'base64')),bootstrap.HELPER_SHA);
  const baseFixture="const HOST_ACTION_V2_SPECS = Object.freeze({\n  agent_zero_downtime_bootstrap_v1: { operation: 'host_action.agent_zero_downtime_bootstrap_v1', rollback: 'host-action-v2:agent-zero-downtime-bootstrap-v1:backup-restore' }\n});";
  const executorFixture="const HOST_ACTION_V2_SPECS = Object.freeze({\n  agent_zero_downtime_bootstrap_v1:{operation:'host_action.agent_zero_downtime_bootstrap_v1',kind:'agent_zero_downtime_bootstrap_v1'}\n});\nconst AGENT_ZDT_BOOTSTRAP_HELPER='/x';\nfunction applyAgentZeroDowntimeBootstrapV1(){return true;}\nfunction verifyProcessSandboxV2(){return true;}\napplyHostActionV2=async function(action){if(action==='agent_zero_downtime_bootstrap_v1')return applyAgentZeroDowntimeBootstrapV1();return applyHostActionV2Original(action);};\nreturn json(res, 200, { ok: true, service: 'prhm-agent-selfmaint-exec', version: '1.12.4-host-actions-v2-verified-economics-fixture', host_actions: [HOST_ACTION_NAME], host_actions_v2: Object.keys(HOST_ACTION_V2_SPECS), base: sanitize(base) });";
  const mcpFixture="const HostActionV2=z.enum(['agent_zero_downtime_bootstrap_v1']);";
  const policyFixture=JSON.stringify({version:'2026-08-19.1-agent-zero-downtime-bootstrap-v1',operations:{},typed_scopes:[]},null,2);
  const pb=bootstrap.patchBase(baseFixture);
  const pe=bootstrap.patchExecutor(executorFixture);
  const pm=bootstrap.patchMcp(mcpFixture);
  const pp=JSON.parse(bootstrap.patchPolicy(policyFixture));
  assert.match(pb,/host_action\.honartik_iticket_dark_backend_batch1_v1/);
  assert.match(pe,/RestrictAddressFamilies=AF_UNIX/);
  assert.match(pe,/1\.12\.5-host-actions-v2-honartik-iticket-dark-backend-batch1/);
  assert.match(pm,/honartik_iticket_dark_backend_batch1_v1/);
  assert.equal(pp.version,'2026-08-20.1-honartik-iticket-dark-backend-batch1-v1');
  assert.deepEqual(pp.operations['host_action.honartik_iticket_dark_backend_batch1_v1'],{level:4});
  const scope=pp.typed_scopes.find(x=>x.action==='honartik_iticket_dark_backend_batch1_v1');
  assert.equal(scope.tool,'host_action_v2_apply');
  assert.equal(scope.project,'control_plane');
  assert.equal(scope.environment,'production');
  assert.equal(scope.risk,'critical');
  assert.deepEqual(scope.principals,[{principal_id:'mohammad',roles:['mcp-operator']}]);
  const source=fs.readFileSync(bootstrapPath,'utf8');
  assert.match(source,/--preflight-only/);
  assert.match(source,/rollback/i);
  assert.match(source,/prhm-host-actions-v14-honartik-iticket/);
  assert.match(source,/RestrictAddressFamilies=AF_UNIX/);
});
