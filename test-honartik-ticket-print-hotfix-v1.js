'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');

const IMPL=path.join(__dirname,'honartik-ticket-print-hotfix-v1.js');
let m=null;
try{m=require(IMPL);}catch(_e){m=null;}

const EXPECTED={
  ACTION:'honartik_ticket_print_hotfix_v1',
  OPERATION:'host_action.honartik_ticket_print_hotfix_v1',
  PROJECT:'honartik_admin_prod',
  ROOT:'/home/honartik/domains/dashboard.honartik.ir/public_html',
  FILE_REL:'app/modules/api/views/public/print-ticket-new.php',
  EXPECTED_BRANCH:'main',
  EXPECTED_HEAD:'cc489ea93d8b8ab9ebd748db554a460ca49e5683',
  TARGET_COMMIT:'a66242e0c6904a6e77eb83913c92be3170f25334',
  LIVE_SHA256:'722c7c05c3befa5399452a91bba8b9287acf1f46662d60cc8c68d65249d8e19c',
  TARGET_SHA256:'6b76f2c1ff9c48e0e9ff29cefbb77ab1664338c10a1d862ae0f7fa7176308377',
};

function goodState(overrides={}){
  return {
    project:EXPECTED.PROJECT,
    root:EXPECTED.ROOT,
    branch:EXPECTED.EXPECTED_BRANCH,
    head:EXPECTED.EXPECTED_HEAD,
    targetCommit:EXPECTED.TARGET_COMMIT,
    targetParent:EXPECTED.EXPECTED_HEAD,
    changedPaths:[EXPECTED.FILE_REL],
    liveSha256:EXPECTED.LIVE_SHA256,
    targetSha256:EXPECTED.TARGET_SHA256,
    wrapperDirty:false,
    dirtyPaths:['app/controllers/AdminController.php','common/config/main.php'],
    dirtyEntries:[' M app/controllers/AdminController.php','M  common/config/main.php'],
    ...overrides,
  };
}

function expectReject(state,code){
  assert.throws(()=>m.validatePreconditions(state),new RegExp(code));
}

test('implementation exists',()=>assert.ok(m,'Honartik ticket print hotfix implementation missing'));

test('exports immutable fixed identity',()=>{
  for(const [key,value] of Object.entries(EXPECTED)) assert.equal(m[key],value,key);
});

test('sandbox is strict and writable scope is minimal',()=>{
  assert.equal(m.SANDBOX.protectSystem,'strict');
  assert.equal(m.SANDBOX.protectHome,'read-only');
  assert.equal(m.SANDBOX.privateTmp,true);
  assert.equal(m.SANDBOX.noNewPrivileges,true);
  assert.deepEqual(m.SANDBOX.readWritePaths,[
    '/home/honartik/domains/dashboard.honartik.ir/public_html/app/modules/api/views/public',
    '/var/backups/prhm-honartik-ticket-print-hotfix-v1',
    '/var/lib/prhm-agent-selfmaint-exec/honartik-ticket-print-hotfix-v1',
    '/run',
  ]);
  assert.equal(m.SANDBOX.readWritePaths.includes(EXPECTED.ROOT),false,'whole production root must stay read-only');
});

test('happy preconditions accept exact fixed state',()=>{
  const out=m.validatePreconditions(goodState());
  assert.equal(out.ok,true);
  assert.deepEqual(out.unrelatedDirtyPaths,['app/controllers/AdminController.php','common/config/main.php']);
  assert.deepEqual(out.unrelatedDirtyEntries,[' M app/controllers/AdminController.php','M  common/config/main.php']);
});

test('rejects arbitrary input keys instead of treating them as overrides',()=>{
  expectReject(goodState({command:'rm -rf /'}),'unexpected_state_key:command');
});

test('rejects project, root, branch and HEAD drift',()=>{
  expectReject(goodState({project:'other'}),'project_mismatch');
  expectReject(goodState({root:'/tmp'}),'root_mismatch');
  expectReject(goodState({branch:'feature/x'}),'branch_mismatch');
  expectReject(goodState({head:'1111111111111111111111111111111111111111'}),'head_mismatch');
});

test('rejects missing or wrong target commit and parent',()=>{
  expectReject(goodState({targetCommit:null}),'target_commit_mismatch');
  expectReject(goodState({targetCommit:'1111111111111111111111111111111111111111'}),'target_commit_mismatch');
  expectReject(goodState({targetParent:'1111111111111111111111111111111111111111'}),'target_parent_mismatch');
});

test('rejects any extra changed path',()=>{
  expectReject(goodState({changedPaths:[EXPECTED.FILE_REL,'composer.json']}),'target_diff_mismatch');
});

test('rejects live and target SHA drift',()=>{
  expectReject(goodState({liveSha256:'0'.repeat(64)}),'live_sha_mismatch');
  expectReject(goodState({targetSha256:'0'.repeat(64)}),'target_sha_mismatch');
});

test('rejects dirty wrapper but preserves unrelated dirty paths',()=>{
  expectReject(goodState({wrapperDirty:true}),'wrapper_dirty');
  const a=m.validatePreconditions(goodState({dirtyPaths:['z.php','a.php']}));
  assert.deepEqual(a.unrelatedDirtyPaths,['a.php','z.php']);
});

test('dirty state comparator requires exact unrelated-state preservation',()=>{
  const before=['a.php','z.php'];
  assert.equal(m.assertUnrelatedDirtyStatePreserved(before,['z.php','a.php']),true);
  assert.throws(()=>m.assertUnrelatedDirtyStatePreserved(before,['a.php']),/unrelated_dirty_state_changed/);
  assert.throws(()=>m.assertUnrelatedDirtyStatePreserved(before,['a.php','z.php','new.php']),/unrelated_dirty_state_changed/);
});



test('dirty-state preservation includes staged vs unstaged status, not only paths',()=>{
  const before=[' M app/controllers/AdminController.php','M  common/config/main.php'];
  assert.equal(m.assertUnrelatedDirtyStatePreserved(before,[...before].reverse()),true);
  assert.throws(()=>m.assertUnrelatedDirtyStatePreserved(before,['M  app/controllers/AdminController.php','M  common/config/main.php']),/unrelated_dirty_state_changed/);
});

test('apply sequence lints candidate before atomic replacement',async()=>{
  const events=[];
  const io=m.createMemoryIo({preimage:Buffer.from('old'),candidate:Buffer.from('new'),postSha:EXPECTED.TARGET_SHA256});
  for(const name of ['persistPreimage','readTarget','verifyTargetSha','writeCandidate','lintCandidate','atomicReplace','verifyLiveSha']){
    const orig=io[name].bind(io);
    io[name]=async(...args)=>{events.push(name);return orig(...args)};
  }
  const result=await m.applyWithIo(io,goodState());
  assert.equal(result.ok,true);
  assert.deepEqual(events.slice(0,7),['persistPreimage','readTarget','verifyTargetSha','writeCandidate','lintCandidate','atomicReplace','verifyLiveSha']);
  assert.equal(events.indexOf('lintCandidate')<events.indexOf('atomicReplace'),true);
});

test('candidate write failure performs no replacement and no rollback',async()=>{
  const io=m.createMemoryIo({failAt:'writeCandidate'});
  await assert.rejects(()=>m.applyWithIo(io,goodState()),/candidate_write_failed/);
  assert.equal(io.events.includes('atomicReplace'),false);
  assert.equal(io.events.includes('rollback'),false);
});

test('PHP lint failure performs no replacement and no rollback',async()=>{
  const io=m.createMemoryIo({failAt:'lintCandidate'});
  await assert.rejects(()=>m.applyWithIo(io,goodState()),/php_lint_failed/);
  assert.equal(io.events.includes('atomicReplace'),false);
  assert.equal(io.events.includes('rollback'),false);
});

test('post-write verification failure automatically rolls back exact preimage',async()=>{
  const io=m.createMemoryIo({failAt:'verifyLiveSha'});
  await assert.rejects(()=>m.applyWithIo(io,goodState()),/post_write_verification_failed/);
  assert.equal(io.events.includes('atomicReplace'),true);
  assert.equal(io.events.includes('rollback'),true);
  assert.equal(io.events.includes('verifyRollbackSha'),true);
});

test('rollback verification failure is surfaced as critical rollback failure',async()=>{
  const io=m.createMemoryIo({failAt:'verifyLiveSha',rollbackVerifyFails:true});
  await assert.rejects(()=>m.applyWithIo(io,goodState()),/rollback_verification_failed/);
});

test('successful apply does not expose generic git mutation commands',()=>{
  const forbidden=['reset','checkout','pull','merge','clean','stash'];
  for(const cmd of forbidden) assert.equal((m.ALLOWED_GIT_READS||[]).some(x=>String(x).includes(cmd)),false,cmd);
  assert.deepEqual(m.ALLOWED_GIT_READS,['rev-parse','diff-tree','status','show']);
});

test('helper has explicit CLI entrypoint that executes only fixed production runner',()=>{
  const fs=require('node:fs');
  const src=fs.readFileSync(IMPL,'utf8');
  assert.match(src,/require\.main===module/);
  assert.match(src,/runProductionFixed\(\)/);
  assert.match(src,/process\.exitCode=1/);
});


// --- Bootstrap/registration contract tests ---
{
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');

const MOD=path.join(__dirname,'bootstrap-host-actions-honartik-ticket-print-hotfix-v1.js');
let m=null;
try{m=require(MOD)}catch(_e){m=null}

const PINS={
  ACTION:'honartik_ticket_print_hotfix_v1',
  OPERATION:'host_action.honartik_ticket_print_hotfix_v1',
  BASE_SHA:'ad2f0fc6924238e7bb7bff6d69a517c366ce82fbafb116bb0a2d31d78c5ed32f',
  EXEC_SHA:'a988dfcd706d3a032bd4d0d60a85c78b7fd6cdbea4e81b5e6c21212a6cd754a4',
  POLICY_SHA:'aad8b3262a86c31f6d746f0bcfbd3eada6187c4e671b51ca79957b6ca6c3340c',
  MCP_SHA:'8f24b6ed70644c1eda7b255a47ccf0d4fabfe03ac7c73dd8799ff9aeb5294075',
  HELPER_PATH:'/opt/prhm-agent-selfmaint-exec/actions/honartik-ticket-print-hotfix-v1.js',
};

function baseFixture(){return [
  'const HOST_ACTION_V2_SPECS = Object.freeze({',
  "  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' }",
  '});',
  'const HOST_ACTION_V2_LEVEL3 = new Set(["host_action_v2_installer_v1","agent_zdt_source_sha_refresh_publisher_v1"]);'
].join('\n')}
function execFixture(){return [
  'const HOST_ACTION_V2_SPECS = Object.freeze({',
  "  agent_zdt_source_sha_refresh_publisher_v1:{operation:'host_action.agent_zdt_source_sha_refresh_publisher_v1',kind:'agent_zdt_source_sha_refresh_publisher_v1'}",
  '});',
  'const applyHostActionV2Original=applyHostActionV2;',
  "applyHostActionV2=async function(action){if(action==='agent_zdt_source_sha_refresh_publisher_v1')return applyAgentZdtSourceShaRefreshPublisherV1();return applyHostActionV2Original(action);};"
].join('\n')}
function policyFixture(){return JSON.stringify({schema_version:'prhm.approval-policy.v1',version:'fixture',operations:{},typed_scopes:[]},null,2)}
function mcpFixture(){return "const HostActionV2=z.enum(['host_action_v2_installer_v1','agent_zdt_source_sha_refresh_publisher_v1']);"}

test('bootstrap implementation exists',()=>assert.ok(m,'bootstrap implementation missing'));

test('identity and live owner SHA pins are exact',()=>{
  for(const [k,v] of Object.entries(PINS)) assert.equal(m[k],v,k);
  assert.equal(m.ROLLBACK,'host-action-v2:honartik-ticket-print-hotfix-v1:file-rollback');
});

test('helper bytes are exactly the already-green implementation and SHA bound',()=>{
  const h=m.helperSource();
  assert.match(h,/const ACTION='honartik_ticket_print_hotfix_v1'/);
  assert.match(h,/const EXPECTED_HEAD='cc489ea93d8b8ab9ebd748db554a460ca49e5683'/);
  assert.match(h,/const TARGET_COMMIT='a66242e0c6904a6e77eb83913c92be3170f25334'/);
  assert.match(m.HELPER_SHA,/^[a-f0-9]{64}$/);
  assert.equal(m.sha256(Buffer.from(h)),m.HELPER_SHA);
});

test('base candidate adds fixed action but never adds it to Level-3 set',()=>{
  const out=m.buildBaseCandidate(baseFixture());
  assert.match(out,/honartik_ticket_print_hotfix_v1/);
  assert.match(out,/host_action\.honartik_ticket_print_hotfix_v1/);
  const start=out.indexOf('const HOST_ACTION_V2_LEVEL3');
  const end=out.indexOf(';',start);
  assert.equal(out.slice(start,end+1).includes(PINS.ACTION),false);
});

test('policy candidate is Level-4 critical one-time with fresh second confirmation',()=>{
  const p=JSON.parse(m.buildPolicyCandidate(policyFixture()));
  const op=p.operations[PINS.OPERATION];
  assert.equal(op.level,4);
  assert.equal(op.risk,'critical');
  assert.equal(op.requires_second_confirmation,true);
  assert.equal(op.one_time_use,true);
  assert.equal(p.typed_scopes.filter(x=>x.action===PINS.ACTION).length,1);
});

test('MCP candidate adds exactly the fixed action enum',()=>{
  const out=m.buildMcpCandidate(mcpFixture());
  assert.equal((out.match(/honartik_ticket_print_hotfix_v1/g)||[]).length,1);
});

test('executor candidate adds fixed helper dispatch in strict transient sandbox',()=>{
  const out=m.buildExecCandidate(execFixture());
  assert.match(out,/HONARTIK_TICKET_PRINT_HOTFIX_HELPER/);
  assert.match(out,/honartik-ticket-print-hotfix-v1\.js/);
  assert.match(out,/applyHonartikTicketPrintHotfixV1/);
  assert.match(out,/ProtectSystem=strict/);
  assert.match(out,/ProtectHome=read-only/);
  assert.match(out,/NoNewPrivileges=true/);
  assert.match(out,/RestrictAddressFamilies=AF_UNIX/);
  assert.match(out,/ReadWritePaths=\/home\/honartik\/domains\/dashboard\.honartik\.ir\/public_html\/app\/modules\/api\/views\/public/);
  assert.match(out,/\/var\/backups\/prhm-honartik-ticket-print-hotfix-v1/);
  assert.match(out,/\/var\/lib\/prhm-agent-selfmaint-exec\/honartik-ticket-print-hotfix-v1/);
  assert.doesNotMatch(out,/bash -lc|sh -c|git reset|git pull|git merge|git checkout|git clean|git stash/);
});

test('executor validates exact helper result and does not expose arbitrary arguments',()=>{
  const out=m.buildExecCandidate(execFixture());
  assert.match(out,/result\.action!==['"]honartik_ticket_print_hotfix_v1['"]/);
  assert.match(out,/result\.live_sha256!==['"]6b76f2c1ff9c48e0e9ff29cefbb77ab1664338c10a1d862ae0f7fa7176308377['"]/);
  assert.match(out,/result\.unrelated_dirty_state_preserved!==true/);
  assert.doesNotMatch(out,/process\.argv\[[2-9]\]/);
});

test('registration plan modifies only four owners plus fixed helper and no application tree',()=>{
  const plan=m.buildInstallPlan({base:baseFixture(),exec:execFixture(),policy:policyFixture(),mcp:mcpFixture()});
  assert.deepEqual(Object.keys(plan.files).sort(),['base','exec','helper','mcp','policy']);
  assert.equal(plan.production_application_mutation,false);
  assert.equal(plan.database_mutation,false);
  assert.equal(plan.application_tree_write,false);
  assert.equal(plan.paths.helper,PINS.HELPER_PATH);
});

test('preflight rejects owner SHA drift before any registration mutation',()=>{
  const good={base:PINS.BASE_SHA,exec:PINS.EXEC_SHA,policy:PINS.POLICY_SHA,mcp:PINS.MCP_SHA};
  assert.equal(m.assertLiveBaseline(good),true);
  for(const key of Object.keys(good)) assert.throws(()=>m.assertLiveBaseline({...good,[key]:'0'.repeat(64)}),new RegExp(key+'_sha_mismatch'));
});

test('installer transaction rolls back all registration owners on post-write verification failure',()=>{
  const state={base:baseFixture(),exec:execFixture(),policy:policyFixture(),mcp:mcpFixture(),helper:null};
  const adapter=m.createFixtureInstallerAdapter(state,{failVerify:true});
  const before=JSON.stringify(state);
  const r=m.install(adapter);
  assert.equal(r.ok,false);
  assert.equal(r.rollback_performed,true);
  assert.equal(r.rollback_verified,true);
  assert.equal(JSON.stringify(state),before);
});

test('installer transaction succeeds atomically in fixture and records no production app mutation',()=>{
  const state={base:baseFixture(),exec:execFixture(),policy:policyFixture(),mcp:mcpFixture(),helper:null};
  const r=m.install(m.createFixtureInstallerAdapter(state));
  assert.equal(r.ok,true);
  assert.equal(r.installed,true);
  assert.equal(r.production_application_mutation,false);
  assert.equal(r.database_mutation,false);
  assert.equal(r.rollback_performed,false);
  assert.match(state.helper,/honartik_ticket_print_hotfix_v1/);
});

}
