'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const bridge=require('./drtarjomeh-email-suppression-v30-bootstrap-builder.js');
const installer=require('./install-host-actions-v30-drtarjomeh-email-suppression-release.js');

test('SafeFiles bridge is fixed to three temporary Level-4 tools and one reviewed installer bundle',()=>{
  const source=bridge.buildBridgeSource({
    baseSha:'a'.repeat(64),
    sourceCommit:'0123456789abcdef0123456789abcdef01234567',
    artifacts:{
      'bootstrap-host-actions-v30-drtarjomeh-email-suppression-release.js':'1'.repeat(64),
      'install-host-actions-v30-drtarjomeh-email-suppression-release.js':'2'.repeat(64),
      'SOURCE_COMMIT':'3'.repeat(64),
      'SHA256SUMS':'4'.repeat(64)
    }
  });
  for(const name of [
    'drtarjomeh_email_suppression_bootstrap_request_v2',
    'drtarjomeh_email_suppression_bootstrap_status_v2',
    'drtarjomeh_email_suppression_bootstrap_apply_v2'
  ]) assert.equal((source.match(new RegExp(name,'g'))||[]).length>=1,true,name);
  assert.match(source,/CONFIRM_LEVEL_4_CRITICAL/);
  assert.match(source,/one_time_use:true/);
  assert.match(source,/risk:'critical'/);
  assert.match(source,/verifyArtifact/);
  assert.match(source,/--preflight-only/);
  assert.match(source,/systemd-run/);
  assert.match(source,/ProtectSystem=strict/);
  assert.match(source,/ProtectHome=read-only/);
  assert.doesNotMatch(source,/req\.body\.command|arbitrary_command|curl |wget |git clone|bash -lc|sh -c/);
});

test('installer touches only five fixed registration targets and rolls back atomically on failed verification',()=>{
  assert.deepEqual(installer.PATHS,{
    base:'/opt/prhm-agent-selfmaint/server.js',
    exec:'/opt/prhm-agent-selfmaint-exec/server.js',
    policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
    mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
    helper:'/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-email-suppression-release-bootstrap-v1.js'
  });

  const original={base:'BASE',exec:'EXEC',policy:'POLICY',mcp:'MCP',helper:null};
  const state={...original};
  const adapter=installer.createFixtureInstallerAdapter(state,{verify:false});
  const result=installer.install(adapter,{helperSource:"'use strict';\nmodule.exports={};\n"});
  assert.equal(result.ok,false);
  assert.equal(result.rollback_performed,true);
  assert.equal(result.rollback_verified,true);
  assert.deepEqual(state,original);
});

test('successful installer plan registers only the dedicated Level-4 action and has no send/database behavior',()=>{
  const state={base:'BASE',exec:'EXEC',policy:'POLICY',mcp:'MCP',helper:null};
  const adapter=installer.createFixtureInstallerAdapter(state,{verify:true});
  const result=installer.install(adapter,{helperSource:"'use strict';\nmodule.exports={};\n"});
  assert.equal(result.ok,true);
  assert.equal(result.installed,true);
  assert.equal(result.action,'drtarjomeh_email_suppression_release_installer_v1');
  assert.equal(result.production_application_mutation,false);
  assert.equal(result.database_mutation,false);
  assert.equal(result.external_send_allowed,false);
  assert.deepEqual(Object.keys(result.installed_targets).sort(),['base','exec','helper','mcp','policy']);
});
