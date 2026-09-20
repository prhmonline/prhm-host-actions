'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const m=require('./bootstrap-host-actions-v28-pbcinema-sms-otp.js');

test('exports fixed Level-3 PBCinema OTP action contract',()=>{
  assert.equal(m.ACTION,'pbcinema_sms_otp_fix_v1');
  assert.equal(m.OPERATION,'host_action.pbcinema_sms_otp_fix_v1');
  assert.equal(m.POLICY_SHA,'9672e88b8c5033b7107e921d25bd4911216e86a8fe593ee67ac2330e0a75bab2');
  assert.equal(m.EXEC_SHA,'409b63bd48b3363eaec2b3921f77ece2767dff93f6143923bdb754fe8f4cf69c');
  assert.equal(m.MCP_SHA,'703a8f8ee0726fac47d008a69c759e3f52254c980cf551ea3f2660cc46321283');
  assert.equal(m.BASE_SHA,'6ae89522f439babd3b6a9679336aea0fb12bb74993d33234095f872d38ad8cc6');
});

test('policy candidate is Level-3 high and typed to fixed action',()=>{
  const p={schema_version:'prhm.approval-policy.v1',version:'2026-09-05.3-autonomous-operator-v1',operations:{},typed_scopes:[]};
  const out=JSON.parse(m.buildPolicyCandidate(JSON.stringify(p)));
  assert.deepEqual(out.operations[m.OPERATION],{
    level:3,risk:'high',requires_second_confirmation:true,one_time_use:true,requested_approver:'mohammad',expires_seconds:300,
    policy_version:m.POLICY_VERSION,rollback_reference:'host-action-v2:pbcinema-sms-otp-fix-v1:file-build-service-rollback'
  });
  assert.equal(out.typed_scopes.length,1);
  assert.equal(out.typed_scopes[0].tool,'host_action_v2_apply');
  assert.equal(out.typed_scopes[0].action,m.ACTION);
  assert.equal(out.typed_scopes[0].risk,'high');
});

test('MCP candidate adds only fixed action to enum',()=>{
  const src="const HostActionV2=z.enum(['a','control_plane_root_scripts_stage_transport_v1']);\n";
  const out=m.buildMcpCandidate(src);
  assert.equal((out.match(/pbcinema_sms_otp_fix_v1/g)||[]).length,1);
  assert.ok(out.includes("'control_plane_root_scripts_stage_transport_v1','pbcinema_sms_otp_fix_v1']"));
});

test('base candidate registers spec and Level-3 set',()=>{
  const src=[
    "const HOST_ACTION_V2_SPECS = Object.freeze({",
    "  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' }",
    "});",
    'const HOST_ACTION_V2_LEVEL3 = new Set(["x","agent_zdt_source_sha_refresh_publisher_v1"]);'
  ].join('\n');
  const out=m.buildBaseCandidate(src);
  assert.ok(out.includes("pbcinema_sms_otp_fix_v1: { operation: 'host_action.pbcinema_sms_otp_fix_v1'"));
  assert.ok(out.includes('"agent_zdt_source_sha_refresh_publisher_v1","pbcinema_sms_otp_fix_v1"]'));
});

test('executor candidate binds helper SHA, sandbox and fixed dispatch',()=>{
  const src=[
    "const HOST_ACTION_V2_SPECS={",
    "  control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'},",
    "};",
    "applyHostActionV2=async function(action){return applyHostActionV2Original(action);};"
  ].join('\n');
  const h='f'.repeat(64);
  const out=m.buildExecCandidate(src,h);
  assert.ok(out.includes("pbcinema_sms_otp_fix_v1:{operation:'host_action.pbcinema_sms_otp_fix_v1'"));
  assert.ok(out.includes("actual!=='"+h+"'"));
  assert.ok(out.includes("if(action==='pbcinema_sms_otp_fix_v1')return applyPbcinemaSmsOtpFixV1();"));
  assert.ok(out.includes('ProtectSystem=strict'));
  assert.ok(out.includes('ProtectHome=read-only'));
  assert.ok(out.includes('ReadWritePaths=/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app/components/helper'));
  assert.ok(out.includes('ReadWritePaths=/home/cfpark/domains/park.prhm.ir/public_html'));
  assert.ok(out.includes('RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6'));
  assert.equal(out.includes('process.env.TARGET'),false);
});

test('helper is fixed-input, SHA-bound, build/restart/rollback safe and never sends SMS',()=>{
  const h=m.buildHelperSource();
  assert.ok(h.includes("const ACTION='pbcinema_sms_otp_fix_v1'"));
  assert.ok(h.includes("const ADMIN='/home/cfpark/domains/dashboard.park.prhm.ir/public_html/app/components/helper/mediana.php'"));
  assert.ok(h.includes("const FRONT='/home/cfpark/domains/park.prhm.ir/public_html/src/app/login/action.ts'"));
  assert.ok(h.includes("const SERVICE='park-bazar-frontend.service'"));
  assert.ok(h.includes("ADMIN_PRE='70152fc917131f5e39ef56160a4b97e94df6fae7d44ddbe19007b8738a1f09ab'"));
  assert.ok(h.includes("ADMIN_POST='0cf54e34824df32a869465f62a27f6dba88814b2ef62173dd5b99d1ec3f3ef20'"));
  assert.ok(h.includes("FRONT_PRE='88c962c899bfcc7a3e92058bd8ddcbd9af8931864a5beade1a16b0bbef004199'"));
  assert.ok(h.includes("FRONT_POST='6271c0c9d519a0a81d5f989c5adae95490e1c7e36264501aaed3a93c4e6d3c5b'"));
  assert.ok(h.includes("'/usr/bin/php',['-l',ADMIN]"));
  assert.ok(h.includes("'/usr/sbin/runuser',['-u','cfpark','--','/usr/local/bin/prhm-node','node_modules/next/dist/bin/next','build']"));
  assert.ok(h.includes("'/usr/bin/systemctl',['restart',SERVICE]"));
  assert.ok(h.includes("'http://127.0.0.1:8081/login'"));
  assert.ok(h.includes('pbcinema_sms_otp_fix_failed_rolled_back'));
  assert.ok(h.includes('pbcinema_sms_otp_fix_failed_and_rollback_failed'));
  assert.ok(h.includes('database_mutation:false'));
  assert.ok(h.includes('dns_mutation:false'));
  assert.ok(h.includes('firewall_mutation:false'));
  assert.ok(h.includes('sms_sent:false'));
  assert.equal(/process\.env\.(TARGET|PATH_TO_WRITE|PAYLOAD)/.test(h),false);
  assert.equal(/process\.argv\[[^\]]+\].*(target|path|payload)/i.test(h),false);
});

test('embedded desired bytes match production postimage SHA bindings',()=>{
  const h=m.buildHelperSource();
  const a=h.match(/const ADMIN_BYTES=Buffer\.from\('([^']+)','base64'\);/);
  const f=h.match(/const FRONT_BYTES=Buffer\.from\('([^']+)','base64'\);/);
  assert.ok(a&&f);
  const sha=x=>crypto.createHash('sha256').update(Buffer.from(x,'base64')).digest('hex');
  assert.equal(sha(a[1]),'0cf54e34824df32a869465f62a27f6dba88814b2ef62173dd5b99d1ec3f3ef20');
  assert.equal(sha(f[1]),'6271c0c9d519a0a81d5f989c5adae95490e1c7e36264501aaed3a93c4e6d3c5b');
});
