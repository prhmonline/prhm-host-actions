'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const reg=require('./waha-student-bridge-registration-v1.js');

const EXPECTED_ACTIONS={
  waha_student_bridge_preflight_v1:{level:3,risk:'high',modes:['--preflight-only']},
  waha_student_bridge_install_v1:{level:4,risk:'critical',modes:['--apply','--session-ensure','--qr']},
  waha_student_bridge_status_v1:{level:3,risk:'high',modes:['--status']},
  waha_student_bridge_session_ensure_v1:{level:3,risk:'high',modes:['--session-ensure']},
  waha_student_bridge_qr_v1:{level:3,risk:'high',modes:['--qr']},
  waha_student_bridge_rollback_v1:{level:4,risk:'critical',modes:['--rollback']},
};

test('contract pins reviewed WAHA helper and live owner preimages',()=>{
  assert.equal(reg.CONTRACT.schema_version,'prhm.waha-student-bridge-registration.v1');
  assert.equal(reg.CONTRACT.source_commit,'483c1bf3ff23dea62c6512d6d374fb3dc0ec5676');
  assert.equal(reg.CONTRACT.helper_path,'waha-student-bridge-install-v1.js');
  assert.equal(reg.CONTRACT.helper_sha256,'9907f6df0a34151a6068c2c046b39b6943c6d816ff21520352e5a658c7523e96');
  assert.equal(reg.CONTRACT.helper_target,'/opt/prhm-agent-selfmaint-exec/actions/waha-student-bridge-install-v1.js');
  assert.deepEqual(reg.CONTRACT.actions,EXPECTED_ACTIONS);
  assert.deepEqual(reg.CONTRACT.preimages,{
    base:'ad2f0fc6924238e7bb7bff6d69a517c366ce82fbafb116bb0a2d31d78c5ed32f',
    exec:'a988dfcd706d3a032bd4d0d60a85c78b7fd6cdbea4e81b5e6c21212a6cd754a4',
    policy:'aad8b3262a86c31f6d746f0bcfbd3eada6187c4e671b51ca79957b6ca6c3340c',
    mcp:'8f24b6ed70644c1eda7b255a47ccf0d4fabfe03ac7c73dd8799ff9aeb5294075',
  });
});

test('mode lookup accepts only six fixed actions',()=>{
  for(const [action,spec] of Object.entries(EXPECTED_ACTIONS)) assert.deepEqual(reg.modesForAction(action),spec.modes);
  assert.throws(()=>reg.modesForAction('anything_else'),/unsupported_action/);
});

test('base patch registers all fixed actions and only Level-3 subset in level set',()=>{
  const src=`const ACTIONS={host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',rollback:'host-action-v2:host-action-v2-installer-v1:four-file-restore'}};\nconst HOST_ACTION_V2_LEVEL3 = new Set(["host_action_v2_installer_v1"]);\n`;
  const out=reg.patchBase(src);
  for(const action of Object.keys(EXPECTED_ACTIONS)) assert.match(out,new RegExp(action));
  for(const action of ['waha_student_bridge_preflight_v1','waha_student_bridge_status_v1','waha_student_bridge_session_ensure_v1','waha_student_bridge_qr_v1']) {
    const set=out.match(/HOST_ACTION_V2_LEVEL3 = new Set\(\[(.*?)\]\);/s)?.[1]||'';
    assert.match(set,new RegExp(action));
  }
  const set=out.match(/HOST_ACTION_V2_LEVEL3 = new Set\(\[(.*?)\]\);/s)?.[1]||'';
  assert.doesNotMatch(set,/waha_student_bridge_install_v1|waha_student_bridge_rollback_v1/);
});

test('executor patch binds each action to fixed helper modes with no runtime mode input',()=>{
  const src=`const ACTIONS={host_action_v2_installer_v1:{operation:'host_action.host_action_v2_installer_v1',kind:'host_action_v2_installer_v1'}};\nconst HOST_ACTION_V2_INSTALLER_HELPER='/opt/prhm-agent-selfmaint-exec/actions/host-action-v2-installer-v1.js';\napplyHostActionV2=async function(action){if(action==='host_action_v2_installer_v1')return applyHostActionV2InstallerV1();return applyHostActionV2Original(action);};\n`;
  const out=reg.patchExec(src);
  assert.match(out,/WAHA_STUDENT_BRIDGE_HELPER='\/opt\/prhm-agent-selfmaint-exec\/actions\/waha-student-bridge-install-v1\.js'/);
  for(const [action,spec] of Object.entries(EXPECTED_ACTIONS)) {
    assert.match(out,new RegExp(action));
    for(const mode of spec.modes) assert.match(out,new RegExp(mode.replaceAll('-','\\-')));
  }
  assert.doesNotMatch(out,/body\.mode|args\.mode|req\.body\.mode|process\.env\.WAHA_MODE/);
});

test('policy patch adds exact action levels and principal-bound rules',()=>{
  const input={action_levels:{'host_action.host_action_v2_installer_v1':{level:3}},rules:[{tool:'host_action_v2_apply',project:'control_plane',environment:'production',action:'host_action_v2_installer_v1',risk:'high',operation:'host_action.host_action_v2_installer_v1',principals:[{principal_id:'mohammad',roles:['mcp-operator']}]}]};
  const out=JSON.parse(reg.patchPolicy(JSON.stringify(input)));
  for(const [action,spec] of Object.entries(EXPECTED_ACTIONS)) {
    assert.equal(out.action_levels[`host_action.${action}`].level,spec.level);
    const rule=out.rules.find(x=>x.action===action);
    assert.equal(rule.operation,`host_action.${action}`);
    assert.equal(rule.risk,spec.risk);
    assert.deepEqual(rule.principals,[{principal_id:'mohammad',roles:['mcp-operator']}]);
  }
});

test('MCP patch extends only HostActionV2 enum',()=>{
  const src=`const HostActionV2=z.enum(['host_action_v2_installer_v1']);\nconst RO={};\n`;
  const out=reg.patchMcp(src);
  for(const action of Object.keys(EXPECTED_ACTIONS)) assert.match(out,new RegExp(action));
  assert.match(out,/const RO=\{\};/);
});
