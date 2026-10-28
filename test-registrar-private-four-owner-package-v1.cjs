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
 ['base.server.js','4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406','d28dc9b45a6ca97a9c8aed0f1b22c684c34b5740a9f116ec7cec12efa22ee5bf'],
 ['executor.server.js','410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0','16dc7df45c8d6dbcf1501a9bdae3445e516faf7b8bef3be2d812263b2869940c'],
 ['mcp.hostActionsV2.js','bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166','aceea9d7d53bbe58c164dbacb731fdcec1fd423eea563a37db5edd4983cbfb3c'],
 ['approval-policy.json','148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174','eb9c2becba1e65033cde46eceef5f8e76e4545a35f99cb4e45a316277680bda0']
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
   assert.equal(candidate.includes('prhm_action_registry_install_v1')||candidate.includes('prhm_registrar_request_v1'),true);
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
