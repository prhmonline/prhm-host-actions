'use strict';

/**
 * Pure, read-only current-owner structural adapter for the original worktree
 * registration intent. This is a PROPOSED in-memory patch, not an installer.
 * It never reads or writes files, executes shell, restarts services, issues
 * approvals, or changes Production. Current live owner bytes must be supplied
 * independently and SHA checked.
 */
const crypto=require('node:crypto');
const vm=require('node:vm');
const REVIEW=require('./honartik-iticket-root-installer-four-owner-review-v1.cjs');
const ORDER=Object.freeze(['base','exec','policy','mcp']);
const ACTION='honartik_git_worktree_fixed_v1';
const OPERATION='host_action.honartik_git_worktree_fixed_v1';
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fail(label){throw Error('structural_preflight_'+label);}
function once(src,pattern,name){
  const all=[...src.matchAll(pattern)];
  if(all.length!==1)fail('anchor_count_'+name+'_'+all.length);
  return all[0];
}
function registryRange(src,name){
  const anchor=once(src,/\bconst\s+HOST_ACTION_V2_SPECS\s*=\s*Object\.freeze\(\s*\{/g,name+'_declaration');
  const start=anchor.index+anchor[0].length;
  const rest=src.slice(start);
  const close=/\n\s*\}\);/g.exec(rest);
  if(!close)fail('registry_close_missing_'+name);
  const end=start+close.index;
  const body=src.slice(start,end);
  const hasInstaller=[...body.matchAll(/\bhost_action_v2_installer_v1\s*:\s*\{/g)];
  if(hasInstaller.length!==1)fail('registry_reference_count_'+name+'_'+hasInstaller.length);
  if(/\bhonartik_git_worktree_fixed_v1\s*:/.test(body))fail('already_registered_'+name);
  return {start,end,body};
}
function patchRegistry(src,name,newSpec){
  const r=registryRange(src,name);
  const tail=r.body.search(/\s*$/);
  const last=r.body.slice(0,tail);
  const after=r.body.slice(tail);
  if(!last.trim())fail('empty_registry_'+name);
  const separator=last.trimEnd().endsWith(',')?'':',';
  const changed=last+separator+'\n  '+ACTION+': '+newSpec+','+after;
  const out=src.slice(0,r.start)+changed+src.slice(r.end);
  if(out.length===src.length)fail('registry_not_changed_'+name);
  return out;
}
function patchBase(src){
  return patchRegistry(src,'base',"{ operation: '"+OPERATION+"', rollback: 'host-action-v2:honartik-git-worktree-fixed-v1:worktree-remove' }");
}
function patchExec(src){
  let out=patchRegistry(src,'exec',"{operation:'"+OPERATION+"',kind:'"+ACTION+"'}");
  // In production the old installer hard-coded the WHOLE dispatch string.
  // The current executor has a different dispatcher. Verify exactly one
  // assignment and add a narrow, initially-disabled route without replacing
  // any previously registered handler.
  const dispatch=once(out,/\bapplyHostActionV2\s*=\s*async\s+function\s*\(\s*action\s*\)\s*\{/g,'exec_dispatch');
  if(out.includes("if(action==='"+ACTION+"')"))fail('dispatch_duplicate');
  const guard="if(action==='"+ACTION+"')throw new Error('"+
    ACTION+"_requires_separate_signed_helper_activation');";
  const index=dispatch.index+dispatch[0].length;
  out=out.slice(0,index)+guard+out.slice(index);
  return out;
}
function patchMcp(src){
  const decl=once(src,/\bconst\s+HostActionV2\s*=\s*z\.enum\(\s*\[/g,'mcp_enum_declaration');
  const start=decl.index+decl[0].length;
  const match=/\]\s*\)/g.exec(src.slice(start));
  if(!match)fail('mcp_enum_close_missing');
  const end=start+match.index;
  const list=src.slice(start,end);
  const values=[...list.matchAll(/(['"])([a-z][a-z0-9_]+)\1/g)].map(m=>m[2]);
  if(values.length<3||new Set(values).size!==values.length||
     values.filter(v=>v==='host_action_v2_installer_v1').length!==1)
    fail('mcp_enum_shape_invalid');
  if(values.includes(ACTION))fail('mcp_enum_already_registered');
  // All array bytes except one new string are preserved.
  const terminal=/,\s*$/.test(list)?'':',';
  const updated=list+terminal+"'"+ACTION+"'";
  return src.slice(0,start)+updated+src.slice(end);
}
function patchPolicy(src){
  let p;
  try{p=JSON.parse(src);}catch{fail('policy_json_invalid');}
  if(!p||typeof p!=='object'||!p.operations||typeof p.operations!=='object'||
     !Array.isArray(p.typed_scopes))fail('policy_shape_invalid');
  if(Object.hasOwn(p.operations,OPERATION)||
     p.typed_scopes.some(x=>x&&x.action===ACTION))
    fail('policy_already_registered');
  // Match known live schema (existing policy operations have only "level").
  // Effective single-use and critical rules MUST be separately attested.
  p.operations[OPERATION]={level:4};
  p.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',
    environment:'production',action:ACTION,risk:'critical',
    operation:OPERATION,principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  return JSON.stringify(p,null,2)+'\n';
}
function patchAll(sources){
  if(!sources||ORDER.some(k=>typeof sources[k]!=='string'))fail('sources_missing');
  return {base:patchBase(sources.base),exec:patchExec(sources.exec),
    policy:patchPolicy(sources.policy),mcp:patchMcp(sources.mcp)};
}
function verify({liveOwnerBytes,expectedSHA}={}){
  if(!liveOwnerBytes||!expectedSHA)fail('trusted_inputs_missing');
  const sources={};
  for(const k of ORDER){
    const bytes=liveOwnerBytes[k];
    if(!Buffer.isBuffer(bytes)||sha256(bytes)!==expectedSHA[k]||
       expectedSHA[k]!==REVIEW.OWNERS[k].live)fail('live_sha_invalid_'+k);
    const src=bytes.toString('utf8');
    if(!Buffer.from(src,'utf8').equals(bytes))fail('owner_utf8_invalid_'+k);
    sources[k]=src;
  }
  const result=patchAll(sources);
  for(const k of ['base','exec']){
    try{new vm.Script(result[k],{filename:k+'.js'});}catch{fail('syntax_invalid_'+k);}
  }
  // MCP is ESM, syntax must be validated using node --check on a copy in an
  // isolated scratch dir, not by executing the module or changing Production.
  return Object.freeze({
    schema:'prhm.iticket.current-owner-structural-preflight.v2',
    verified_preimages:true,
    all_patch_shapes_pass:true,
    effective_policy_l4_one_time_attested:false,
    underlying_handler_activated:false,
    mcp_esm_syntax:'NOT_TESTED',
    current_owner_postimage_sha256:Object.fromEntries(ORDER.map(k=>[k,sha256(Buffer.from(result[k]))])),
    postimage_bytes:result, // in-memory review only; never print these
    installation_authorized:false,
    production_mutation:false,
  });
}
module.exports=Object.freeze({ACTION,OPERATION,registryRange,patchBase,patchExec,patchMcp,patchPolicy,patchAll,verify});
