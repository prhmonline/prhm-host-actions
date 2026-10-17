'use strict';
/**
 * Root-owned CURRENT-OWNER in-memory patch compatibility inspector.
 * READ ONLY: reads only five fixed SHA-bound local files and helper-state JSON;
 * NO writes, no exec/spawn, no restarts, no approvals, no payload output.
 * No dynamic paths, arguments, network, stdin code evaluation or environment.
 * The output SHA digests are REVIEW EVIDENCE, not install authorization.
 */
const fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm');
const KEYS=Object.freeze(['base','exec','policy','mcp']);
const FILES=Object.freeze({
  base:'/opt/prhm-agent-selfmaint/server.js',
  exec:'/opt/prhm-agent-selfmaint-exec/server.js',
  policy:'/opt/prhm-company-control-plane/config/approval-policy.json',
  mcp:'/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
  helper:'/opt/prhm-agent-selfmaint-exec/actions/honartik-git-worktree-fixed-v1.js',
  state:'/var/lib/prhm-agent-selfmaint-exec/control-plane-root-installer-v1/state.json'
});
const EXPECTED=Object.freeze({
  base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
  exec:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
  policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
  mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'
});
const NAME='honartik_git_worktree_fixed_v1',OP='host_action.honartik_git_worktree_fixed_v1';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(why){throw Error('READONLY_BLOCKED_'+why);}
function one(s,regex,label){
  const match=[...s.matchAll(regex)];
  if(match.length!==1)fail(label+'_COUNT_'+match.length);
  return match[0];
}
function registry(s,key){
  const m=one(s,/\bconst\s+HOST_ACTION_V2_SPECS\s*=\s*Object\.freeze\(\s*\{/g,key+'_DECL');
  const start=m.index+m[0].length;
  const tail=s.slice(start), close=/\n\s*\}\);/.exec(tail);
  if(!close)fail(key+'_CLOSE_MISSING');
  const body=tail.slice(0,close.index);
  if([...body.matchAll(/\bhost_action_v2_installer_v1\s*:\s*\{/g)].length!==1)
    fail(key+'_OLD_ACTION_MISSING_OR_DUPLICATE');
  if(body.includes(NAME+':'))fail(key+'_ALREADY_PRESENT');
  const entry=key==='base'
    ? "  "+NAME+": { operation: '"+OP+"', rollback: 'host-action-v2:honartik-git-worktree-fixed-v1:worktree-remove' },"
    : "  "+NAME+": {operation:'"+OP+"',kind:'"+NAME+"'},";
  return s.slice(0,start)+'\n'+entry+s.slice(start);
}
function transforms(s){
  let base=registry(s.base,'base'),exec=registry(s.exec,'exec');
  const dispatch=one(exec,/\bapplyHostActionV2\s*=\s*async\s+function\s*\(\s*action\s*\)\s*\{/g,'EXEC_DISPATCH');
  if(exec.includes("if(action==='"+NAME+"')"))fail('EXEC_ALREADY_DISPATCHED');
  const start=dispatch.index+dispatch[0].length;
  exec=exec.slice(0,start)+"if(action==='"+NAME+"')throw Error('"+
    NAME+"_requires_separate_signed_helper_activation');"+exec.slice(start);
  const decl=one(s.mcp,/\bconst\s+HostActionV2\s*=\s*z\.enum\(\s*\[/g,'MCP_DECL');
  const begin=decl.index+decl[0].length, tail=s.mcp.slice(begin);
  const close=/\]\s*\)/.exec(tail);
  if(!close)fail('MCP_ARRAY_CLOSE_MISSING');
  const enumSource=tail.slice(0,close.index);
  const current=[...enumSource.matchAll(/(['"])([a-z][a-z0-9_]+)\1/g)].map(m=>m[2]);
  if(current.filter(x=>x==='host_action_v2_installer_v1').length!==1||
     new Set(current).size!==current.length||
     current.includes(NAME))fail('MCP_ENUM_INCOMPATIBLE');
  const mcp=s.mcp.slice(0,begin)+enumSource+(enumSource.trimEnd().endsWith(',')?'':',')+
    "'"+NAME+"'"+s.mcp.slice(begin+enumSource.length);
  let policy;
  try{policy=JSON.parse(s.policy);}catch{fail('POLICY_INVALID_JSON');}
  if(!policy||!policy.operations||!Array.isArray(policy.typed_scopes)||
     Object.hasOwn(policy.operations,OP)||
     policy.typed_scopes.some(x=>x&&x.action===NAME))fail('POLICY_UNEXPECTED_SHAPE_OR_DUPLICATE');
  policy.operations[OP]={level:4};
  policy.typed_scopes.push({tool:'host_action_v2_apply',project:'control_plane',
    environment:'production',action:NAME,risk:'critical',operation:OP,
    principals:[{principal_id:'mohammad',roles:['mcp-operator']}]});
  return {base,exec,policy:JSON.stringify(policy,null,2)+'\n',mcp};
}
function analyze(s){
  const p=transforms(s);
  for(const k of ['base','exec']){
    try{new vm.Script(p[k],{filename:k+'.js'});}catch{fail(k.toUpperCase()+'_SYNTAX_INVALID');}
  }
  try{JSON.parse(p.policy);}catch{fail('POLICY_POSTIMAGE_INVALID');}
  return Object.freeze({
    status:'SOURCE_TRANSFORMATION_PASS_NOT_INSTALL_AUTHORIZATION',
    proposed_post_sha256:Object.fromEntries(KEYS.map(k=>[k,hash(Buffer.from(p[k]))])),
    old_level3_installer_independent_of_new_level4:true,
    new_dispatch_is_inert:true,
    mcp_esm_syntax:'NOT_TESTED',
    effective_policy_critical_single_use_confirmation:'NOT_ATTESTED',
    full_postimage_semantic_review:'NOT_ATTESTED',
    production_mutation:false
  });
}
function main(){
  if(process.argv.length!==2)fail('UNEXPECTED_ARGUMENTS');
  const originals={};
  for(const k of KEYS){
    const st=fs.lstatSync(FILES[k]);
    if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)fail('INVALID_OWNER_TYPE_'+k);
    const bytes=fs.readFileSync(FILES[k]);
    const expected=EXPECTED[k];
    if(hash(bytes)!==expected)fail('PREIMAGE_DRIFT_'+k);
    originals[k]=bytes.toString('utf8');
    if(!Buffer.from(originals[k],'utf8').equals(bytes))fail('INVALID_UTF8_'+k);
    console.log('SHA_'+k.toUpperCase()+'=PASS');
  }
  const state=JSON.parse(fs.readFileSync(FILES.state,'utf8'));
  if(typeof state.honartik_worktree_helper_sha256!=='string'||
    hash(fs.readFileSync(FILES.helper))!==state.honartik_worktree_helper_sha256)
    fail('HELPER_BINDING_INVALID');
  console.log('HELPER_SHA=PASS');
  const result=analyze(originals);
  for(const k of KEYS)console.log('POSTIMAGE_'+k.toUpperCase()+'_SHA256='+result.proposed_post_sha256[k]);
  console.log('STRUCTURAL_CURRENT_OWNER_PREFLIGHT=PASS');
  console.log('NEW_DISPATCH=INERT');
  console.log('MCP_ESM_SYNTAX=NOT_TESTED');
  console.log('EFFECTIVE_LEVEL4_POLICY=NOT_ATTESTED');
  console.log('INSTALL_AUTHORIZED=NO');
  console.log('PRODUCTION_MUTATION=NO');
}
module.exports=Object.freeze({transforms,analyze,FILES,EXPECTED});
if(require.main===module){
  try{main();}catch(e){console.error(String(e.message||e));process.exitCode=1;}
}
