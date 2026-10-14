'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const runner=require('./prhm-action-registry-v2-independent-runner-contract-v1.cjs');
const closure=require('./manifests/honartik-shared-registry-pinned-release-v2.json');
const args={
 source_commit:closure.source_commit,
 manifest_commit:closure.manifest_commit,
 manifest_sha256:closure.release_manifest_sha256
};
function evidence(overrides={}){
 return {...args,owner_shas:{...runner.OWNER_PINS},
  git_blobs_verified:true,runner_binary_staged:false,
  runner_binary_sha_bound:false,signed_five_field_route_installed:false,
  independent_process_preflight:false,service_restart_tested:false,
  durable_recovery_tested:false,real_discovery_tested:false,...overrides};
}
test('only a disconnected transient root runner is described, never invoked',()=>{
 const p=runner.sandboxPlan(),s=p.systemd_properties;
 assert.equal(p.service_mode,'transient-oneshot-independent');
 assert.equal(p.root_access_granted,false);
 assert.equal(p.runner_staged,false);
 assert.equal(p.can_execute,false);
 assert.equal(p.requires_fresh_signed_level4,true);
 assert.equal(p.source_commit,args.source_commit);
 assert.equal(p.manifest_commit,args.manifest_commit);
 assert.equal(p.manifest_sha256,args.manifest_sha256);
 assert.equal(p.approval_arguments_sha256,closure.approval_arguments_sha256);
 assert.equal(s.User,'root');assert.equal(s.Group,'root');
 assert.equal(s.ProtectSystem,'strict');
 assert.equal(s.ProtectHome,'read-only');
 assert.equal(s.NoNewPrivileges,'yes');
 assert.equal(s.PrivateTmp,'yes');
 assert.equal(s.UMask,'0077');
 assert.equal(s.Type,'oneshot');
 assert.ok(p.fixed_entrypoint.startsWith(closure.destination_root+'/'));
 assert.equal(runner.SERVICES.length,4);
});
test('no broad WritePaths or HOME exception is permitted by reviewed plan',()=>{
 const p=runner.sandboxPlan();
 const paths=p.systemd_properties.ReadWritePaths.split(' ');
 assert.deepEqual(paths,runner.ROOTS);
 assert.equal(paths.length,9);
 assert.equal(new Set(paths).size,paths.length);
 for(const bad of ['/','/opt','/home','/etc','/root',
                     '/etc/systemd/system','/var/lib','/tmp'])
  assert.equal(paths.includes(bad),false,bad);
 assert.ok(paths.includes('/home/agent/ssh-mcp-server/src/plugins'));
 assert.ok(paths.includes('/var/lib/prhm-agent-selfmaint-exec/registry-one-time-v1'));
 assert.ok(paths.includes('/var/lib/prhm-agent-selfmaint-exec/registry-recovery-lock-v1'));
 assert.ok(paths.includes('/var/lib/prhm-agent-selfmaint-exec/registry-audit-v1'));
 assert.ok(paths.includes('/opt/prhm-agent-selfmaint-exec/staged/honartik-config-center-v1'));
 assert.ok(!paths.includes('/opt/prhm-agent-selfmaint-exec/staged'));
 assert.ok(!paths.includes('/home/honartik'));
});
test('real current bootstrap evidence fails CLOSED for missing live runner and route',()=>{
 const r=runner.assess(evidence());
 assert.equal(r.ready,false);
 assert.deepEqual(r.gaps,[
  'SEPARATE_RUNNER_NOT_STAGED','RUNNER_EXECUTABLE_UNATTESTED',
  'FIVE_FIELD_SIGNED_ROUTE_MISSING','INDEPENDENT_PROCESS_TEST_MISSING',
  'SERVICE_RESTART_TEST_MISSING','DURABLE_CRASH_RECOVERY_TEST_MISSING',
  'MCP_DISCOVERY_TEST_MISSING']);
 assert.equal(r.production_mutation,false);
 assert.equal(r.level4_requested,false);
});
test('any single preflight gate blocks even synthetic readiness',()=>{
 const keys=[
  'git_blobs_verified','runner_binary_staged','runner_binary_sha_bound',
  'signed_five_field_route_installed','independent_process_preflight',
  'service_restart_tested','durable_recovery_tested','real_discovery_tested'
 ];
 for(const key of keys){
  const full=evidence(Object.fromEntries(keys.map(k=>[k,true])));
  full[key]=false;
  assert.equal(runner.assess(full).ready,false,key);
 }
 const synthetic=runner.assess(evidence(Object.fromEntries(keys.map(k=>[k,true]))));
 assert.equal(synthetic.ready,true);
 assert.equal(synthetic.source_only,true);
});
test('owner SHA drift or changed Git release veto readiness',()=>{
 const full=evidence(Object.fromEntries([
  'git_blobs_verified','runner_binary_staged','runner_binary_sha_bound',
  'signed_five_field_route_installed','independent_process_preflight',
  'service_restart_tested','durable_recovery_tested','real_discovery_tested'
 ].map(k=>[k,true])));
 assert.deepEqual(runner.assess({...full,owner_shas:{...full.owner_shas,mcp:'f'.repeat(64)}}).gaps,
  ['ORIGINAL_SHA_DRIFT_mcp']);
 assert.deepEqual(runner.assess({...full,manifest_commit:'f'.repeat(40)}).gaps,
  ['IMMUTABLE_RELEASE_DRIFT']);
 assert.throws(()=>runner.assess({...full,owner_shas:{base:'a'}}),/owner_sha_shape/);
 assert.throws(()=>runner.assess({...full,arbitrary_command:'rm -rf /'}),/evidence_shape/);
});
test('result cannot say success without independent durable journal and MCP discovery',()=>{
 const ok={
  request_id:'11111111-1111-4111-8111-111111111111',runner_process_id:1234,
  source_commit:args.source_commit,manifest_commit:args.manifest_commit,
  manifest_sha256:args.manifest_sha256,
  approval_arguments_sha256:closure.approval_arguments_sha256,
  journal_verified:true,services_healthy:true,registry_visible:true,
  result:'registered',rollback:'not_needed'
 };
 assert.equal(runner.verifyExecutionReport(ok).ok,true);
 for(const bad of [
  {...ok,journal_verified:false},{...ok,services_healthy:false},
  {...ok,registry_visible:false},{...ok,rollback:'unverified'},
  {...ok,manifest_commit:'e'.repeat(40)},
  {...ok,approval_arguments_sha256:'f'.repeat(64)},
  {...ok,runner_process_id:0},{...ok,extra:'untrusted'}
 ])assert.throws(()=>runner.verifyExecutionReport(bad));
});
test('module exposes no live shell, service, credential or approval primitives',()=>{
 for(const key of ['execute','apply','install','systemdRun','spawn','stage',
  'write','approve','authorize','consume','request','readToken','rollback'])
  assert.equal(Object.hasOwn(runner,key),false);
});
