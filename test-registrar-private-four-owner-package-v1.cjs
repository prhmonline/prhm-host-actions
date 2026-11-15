'use strict';
/**
 * Run only on the secure private baseline/candidate files (not in Git CI).
 * Proves byte-level pinned four owner SHA, Node syntax is external preflight,
 * legacy source has not been deleted/rewritten, and fixed new routes exist.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const expect=[
 ['base.server.js','649941e1a2f77a9a1515327e47fa7176a0ae8f4602042750d53847e568deed0e','452ac7670963c363f644d9625474aa014a4c1597cfd05dde9f0e656a0f8a2860'],
 ['executor.server.js','34ce844008fbb7763250cdfa7859ca16360db1aa414fff77d107ffb0ccfa4121','cffa9924a926467a0706da51d24d926dc324efd91794289f9bae44955e1cdc5d'],
 ['mcp.hostActionsV2.js','01eb930e8e9177b8754ab5cf36a004cb69141d44b74e70b4d42dc3f0f33f1c56','2bef3b13bfc7f0609be8e029b1e2f8096c4aa7ea80e56eefbaf93e4a74ea8229'],
 ['approval-policy.json','aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934','8eb49274cdf12d39823a6d39a05a22d24c9909e18748d0ea7bd7fed0956ce8e7']
];
function includedInOrder(a,b){
 let i=0;for(const x of b.split('\n')){if(x===a.split('\n')[i])i++}
 return i===a.split('\n').length;
}
function inspect(src,cand){
 const report=[];
 for(const [name,oldSha,newSha] of expect){
  const old=fs.readFileSync(path.join(src,name)),fresh=fs.readFileSync(path.join(cand,name));
  assert.equal(sha(old),oldSha,'invalid_baseline:'+name);
  assert.equal(sha(fresh),newSha,'invalid_candidate:'+name);
  let oldText=old.toString('utf8'),candidate=fresh.toString('utf8');
  if(name!=='approval-policy.json'){
   assert.ok(includedInOrder(oldText,candidate),'legacy_line_modified_or_removed:'+name);
   assert.equal(name==='executor.server.js'?candidate.includes('/v2/registrar/request'):candidate.includes('prhm_action_registry_install_v1')||candidate.includes('prhm_registrar_request_v1'),true);
   assert.ok(candidate.length>oldText.length);
  }else{
   const o=JSON.parse(oldText),n=JSON.parse(candidate);
   assert.equal(n.default_deny,true);assert.equal(n.scope_freeze,true);
   assert.equal(n.typed_scopes.length,o.typed_scopes.length+1);
   assert.deepEqual(n.typed_scopes.slice(0,-1),o.typed_scopes);
   for(const [key,value]of Object.entries(o.operations))
    assert.deepEqual(n.operations[key],value);
   assert.equal(n.operations['host_action.prhm_action_registry_install_v1'].level,4);
  }
  report.push({name,before_sha256:oldSha,after_sha256:newSha,legacy_preserved:true});
 }
 const base=fs.readFileSync(path.join(cand,'base.server.js'),'utf8');
 const executor=fs.readFileSync(path.join(cand,'executor.server.js'),'utf8');
 const mcp=fs.readFileSync(path.join(cand,'mcp.hostActionsV2.js'),'utf8');
 for(const v of ['issuer/request','issuer/decision','issuer/validate','issuer/consume'])
  assert.equal(base.includes('/v2/registrar/'+v),true,'missing_base_issuer:'+v);
 for(const v of ['request','execute'])
  assert.equal(executor.includes('/v2/registrar/'+v),true,'missing_executor_route:'+v);
 assert.equal(executor.includes('shared-registrar-native-host-hooks-v1.cjs'),true);
 assert.equal(executor.includes('registrar_native_installer_hooks_missing'),true);
 for(const tool of ['prhm_registrar_request_v1','prhm_registrar_apply_v1'])
  assert.equal(mcp.includes(tool),true,'missing_tool:'+tool);
 return {ok:true,read_only:true,legacy_routes_preserved:true,
   full_four_owner_candidate:true,provider_bootstrap_complete:false,
   native_host_hooks_complete:false,isolated_vm_services_tested:false,files:report};
}
if(require.main===module){
 try{
  if(process.argv.length!==4)throw Error('two private directories required');
  process.stdout.write(JSON.stringify(inspect(process.argv[2],process.argv[3]))+'\n');
 }catch(e){process.stderr.write('PRIVATE_CANDIDATE_FAIL '+e.message+'\n');process.exitCode=1}
}
module.exports={inspect};
