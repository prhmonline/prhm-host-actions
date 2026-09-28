'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const bootstrap=require('./bootstrap-host-actions-v29-drtarjomeh-security-release-deploy.js');
const installer=require('./install-host-actions-v29-drtarjomeh-security-release.js');

const EXPECTED_PATHS={
  base:'/opt/prhm-agent-selfmaint/server.js',
  exec:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  helper:'/opt/prhm-agent-selfmaint-exec/actions/drtarjomeh-security-release-deploy-v1.js',
};
function fakeBinding(){
  const target={};const pre={};let i=1;
  for(const rel of Object.keys(bootstrap.PAYLOAD)){
    target[rel]=(i.toString(16).padStart(2,'0').repeat(32)).slice(0,64);
    pre[rel]=i%5===0?'absent':{sha256:((i+40).toString(16).padStart(2,'0').repeat(32)).slice(0,64),isFile:true,isSymlink:false};
    i++;
  }
  return installer.buildBinding({targetHashes:target,preimages:pre,envPreimage:'absent',runtime:{uid:1001,gid:1001}});
}

test('installer exposes only the five fixed installation targets',()=>{
  assert.deepEqual(installer.PATHS,EXPECTED_PATHS);
  assert.equal(installer.INSTALL_RESULT,'/var/lib/prhm-agent-selfmaint-exec/drtarjomeh-security-release-installer-v1/latest.json');
  assert.equal(installer.INSTALL_BACKUP_ROOT,'/var/backups/prhm-drtarjomeh-security-release-installer-v1');
});

test('binding factory freezes exact payload, release, env preimage, and runtime identity',()=>{
  const b=fakeBinding();
  assert.equal(Object.isFrozen(b),true);
  assert.equal(b.schema,'prhm.drtarjomeh-security-release-binding.v1');
  assert.equal(b.target_commit,bootstrap.TARGET_COMMIT);
  assert.equal(b.expected_release,bootstrap.EXPECTED_RELEASE);
  assert.deepEqual(Object.keys(b.manifest).sort(),Object.keys(bootstrap.PAYLOAD).sort());
  assert.equal(b.env_preimage,'absent');
  assert.deepEqual(b.runtime,{uid:1001,gid:1001});
  assert.throws(()=>installer.buildBinding({targetHashes:{},preimages:{},envPreimage:'absent',runtime:{uid:1001,gid:1001}}),/target_sha_invalid|preimage_missing/);
  const good=fakeBinding();
  assert.throws(()=>installer.buildBinding({targetHashes:Object.fromEntries(Object.entries(good.manifest).map(([k,v])=>[k,v.target_sha256])),preimages:Object.fromEntries(Object.entries(good.manifest).map(([k,v])=>[k,v.preimage==='absent'?'absent':{sha256:v.preimage,isFile:true,isSymlink:false}])),envPreimage:'absent',runtime:{uid:-1,gid:1001}}),/runtime_identity_invalid/);
});

test('install preflight rejects unstable blue-green topology',()=>{
  const stable={
    hashes:{base:bootstrap.BASE_SHA,exec:bootstrap.EXEC_SHA,policy:bootstrap.POLICY_SHA,mcp:bootstrap.MCP_SHA},
    services:{api_blue:'active',api_green:'active',mcp_blue:'active',mcp_green:'active'},
  };
  assert.doesNotThrow(()=>installer.assertInstallPreflight(stable));
  assert.throws(()=>installer.assertInstallPreflight({...stable,services:{...stable.services,mcp_green:'activating'}}),/control_plane_not_stable:mcp_green/);
  assert.throws(()=>installer.assertInstallPreflight({...stable,hashes:{...stable.hashes,mcp:'0'.repeat(64)}}),/baseline_sha_mismatch:mcp/);
});

test('buildInstallPlan changes exactly four control-plane files plus helper',()=>{
  const source={
    base:[
      'const HOST_ACTION_V2_SPECS = Object.freeze({',
      "  agent_zdt_source_sha_refresh_publisher_v1: { operation: 'host_action.agent_zdt_source_sha_refresh_publisher_v1', rollback: 'host-action-v2:agent-zdt-source-sha-refresh-publisher-v1:action-backup-restore' }",
      '});',
      'const HOST_ACTION_V2_LEVEL3 = new Set(["control_plane_root_scripts_stage_transport_v1"]);',
    ].join('\n'),
    exec:[
      "const ACTION_SPECS={control_plane_root_scripts_stage_transport_v1:{operation:'host_action.control_plane_root_scripts_stage_transport_v1',kind:'control_plane_root_scripts_stage_transport_v1'},};",
      'const applyHostActionV2Original=applyHostActionV2;',
      "applyHostActionV2=async function(action){if(action==='control_plane_root_scripts_stage_transport_v1')return applyControlPlaneRootScriptsStageTransportV1();return applyHostActionV2Original(action);};",
    ].join('\n'),
    policy:JSON.stringify({schema_version:'prhm.approval-policy.v1',version:'2026-09-05.3-autonomous-operator-v1',operations:{},typed_scopes:[]},null,2),
    mcp:"const HostActionV2=z.enum(['control_plane_root_scripts_stage_transport_v1']);",
  };
  const helperSource="'use strict';\nmodule.exports={};\n";
  const helperSha=installer.sha(Buffer.from(helperSource));
  const plan=installer.buildInstallPlan(source,helperSource,helperSha);
  assert.deepEqual(Object.keys(plan.files).sort(),['base','exec','helper','mcp','policy']);
  assert.deepEqual(Object.keys(plan.paths).sort(),['base','exec','helper','mcp','policy']);
  assert.equal(plan.paths.helper,EXPECTED_PATHS.helper);
  assert.equal(plan.files.helper.includes('module.exports'),true);
  assert.match(plan.sha256.helper,/^[a-f0-9]{64}$/);
  assert.equal(plan.sha256.helper,helperSha);
  assert.equal(plan.production_application_mutation,false);
  assert.equal(plan.database_mutation,false);
  assert.throws(()=>installer.buildInstallPlan(source,helperSource,'f'.repeat(64)),/helper_sha_mismatch/);
});

test('installer source contract requires backups, atomic writes, validation, rollback, and no raw shell',()=>{
  const src=installer.install.toString();
  for(const token of ['assertInstallPreflight','backup','atomic','rollback','nodeCheck','jsonCheck','verifyInstalledHashes','binding']){
    assert.ok(src.includes(token),`missing ${token}`);
  }
  assert.equal(src.includes('execSync('),false);
  assert.equal(src.includes('bash -lc'),false);
  assert.equal(src.includes('sh -c'),false);
});

test('install transaction fixture restores all previous bytes on verification failure',()=>{
  const initial={base:'BASE_OLD',exec:'EXEC_OLD',policy:'POLICY_OLD',mcp:'MCP_OLD',helper:null};
  const fsState={...initial};
  const adapter=installer.createFixtureInstallerAdapter(fsState,{failVerify:true,binding:fakeBinding()});
  const result=installer.install(adapter,{fixture:true});
  assert.equal(result.ok,false);
  assert.equal(result.rollback_performed,true);
  assert.deepEqual(fsState,initial);
});

test('successful fixture install writes a SHA-bound helper and only five fixed targets',()=>{
  const fsState={base:'BASE_OLD',exec:'EXEC_OLD',policy:'POLICY_OLD',mcp:'MCP_OLD',helper:null};
  const binding=fakeBinding();
  const adapter=installer.createFixtureInstallerAdapter(fsState,{failVerify:false,binding});
  const result=installer.install(adapter,{fixture:true});
  assert.equal(result.ok,true);
  assert.equal(result.installed,true);
  assert.equal(result.rollback_performed,false);
  assert.equal(result.production_application_mutation,false);
  assert.equal(result.database_mutation,false);
  assert.deepEqual(Object.keys(result.installed_targets).sort(),['base','exec','helper','mcp','policy']);
  assert.ok(fsState.helper.includes('prhm.drtarjomeh-security-release-binding.v1'));
  assert.ok(fsState.helper.includes(bootstrap.TARGET_COMMIT));
  assert.ok(fsState.helper.includes('/home/drtarjomeh/domains/drtarjomeh.ir/public_html'));
  assert.equal(fsState.helper.includes('SECRET'),false);
  for(const [rel,item] of Object.entries(binding.manifest)){
    assert.ok(fsState.helper.includes(item.target_sha256),`missing target pin ${rel}`);
    if(item.preimage!=='absent')assert.ok(fsState.helper.includes(item.preimage),`missing preimage pin ${rel}`);
  }
});
