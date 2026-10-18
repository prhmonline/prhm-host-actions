'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const x=require('./honartik-iticket-root-owner-anchor-audit-v1.cjs');
const fixture=()=>({
  base:"'use strict';\nconst HOST_ACTION_V2_SPECS=Object.freeze({\n"+
     x.ANCHOR.base+"\n",
  exec:"'use strict';\nconst HOST_ACTION_V2_SPECS=Object.freeze({\n"+
    x.ANCHOR.execSpec+"\n"+
    "let applyHostActionV2=async function(){};\n"+
    "const applyHostActionV2InstallerV1=()=>{};\n"+
    "const applyAgentZeroDowntimeBootstrapV1=()=>{};\n"+
    x.ANCHOR.execHelper+
    x.ANCHOR.execDispatch+"\n",
  policy:JSON.stringify({operations:{'host_action.host_action_v2_installer_v1':{
    level:4,risk:'critical',one_time_use:true,requires_second_confirmation:true}},
    typed_scopes:[],version:'example'},null,2)+'\n',
  mcp:"import { z } from 'zod';\nconst HostActionV2=z.enum(['agent_zero_downtime_bootstrap_v1','host_action_v2_installer_v1']);\n"
});
test('source operator anchor literals are present exactly once',()=>{
  const s=fixture();
  for(const [name,k] of [['base','base'],['execSpec','exec'],['execHelper','exec'],
    ['execDispatch','exec'],['mcpEnum','mcp']])
    assert.equal(s[k].split(x.ANCHOR[name]).length-1,1);
});
test('exact source semantics reproduce base/exec/policy/mcp patch output',()=>{
  const s=fixture(),p=x.patchPure(s);
  x.verifySyntax(p);
  for(const k of Object.keys(p))assert.notEqual(p[k],s[k]);
  for(const [key,sourceKey] of [['base','base'],['execSpec','exec'],['execHelper','exec'],
    ['execDispatch','exec'],['mcpEnum','mcp']])
    assert.equal(p[sourceKey].split(x.INSERT[key]).length-1,1);
  const policy=JSON.parse(p.policy);
  assert.equal(policy.operations[x.OP].level,4);
  assert.equal(policy.typed_scopes.find(z=>z.action===x.TARGET).risk,'critical');
  assert.equal(policy.operations[x.OP].one_time_use,undefined);
  assert.equal(policy.operations[x.OP].requires_second_confirmation,undefined);
});
for(const [key,sourceKey] of [['base','base'],['execSpec','exec'],['execHelper','exec'],
  ['execDispatch','exec'],['mcpEnum','mcp']]){
  test('reject deleted anchor: '+key,()=>{
    const s=fixture();
    s[sourceKey]=s[sourceKey].replace(x.ANCHOR[key],'// owner changed in live code\n');
    assert.throws(()=>x.patchPure(s),new RegExp('anchor_'+key.replace('execSpec','exec_spec').replace('execHelper','exec_helper').replace('execDispatch','exec_dispatch').replace('mcpEnum','mcp_enum')+'_count_0'));
  });
  test('reject duplicate anchor: '+key,()=>{
    const s=fixture();
    s[sourceKey]+='\n'+x.ANCHOR[key];
    assert.throws(()=>x.patchPure(s),/anchor_.*_count_2/);
  });
}
test('reject pre-existing duplicate policy operation',()=>{
  const s=fixture(),o=JSON.parse(s.policy);
  o.operations[x.OP]={level:4};s.policy=JSON.stringify(o);
  assert.throws(()=>x.patchPure(s),/policy_action_already_registered/);
});
test('reject pre-existing duplicate typed scope',()=>{
  const s=fixture(),o=JSON.parse(s.policy);
  o.typed_scopes.push({action:x.TARGET});s.policy=JSON.stringify(o);
  assert.throws(()=>x.patchPure(s),/policy_action_already_registered/);
});
test('reject invalid policy JSON or typed scope schema',()=>{
  let s=fixture();s.policy='{';assert.throws(()=>x.patchPure(s),/policy_json_invalid/);
  s=fixture();s.policy=JSON.stringify({operations:{},typed_scopes:{}});
  assert.throws(()=>x.patchPure(s),/policy_shape_invalid/);
});
test('reject invalid patched base/exec source syntax',()=>{
  const s=fixture();
  assert.doesNotThrow(()=>x.verifySyntax(x.patchPure(s)));
  const p=x.patchPure(s);p.exec='const {';
  assert.throws(()=>x.verifySyntax(p),/postimage_syntax_invalid_exec/);
});
test('refuse actual audit with no on-host original helper or source bytes',()=>{
  assert.throws(()=>x.audit({}),/trusted_bytes_missing/);
  const s=fixture();const ownerBytes=Object.fromEntries(Object.entries(s).map(([k,v])=>[k,Buffer.from(v)]));
  assert.throws(()=>x.audit({originalInstallerBytes:Buffer.from('test'),ownerBytes,
    helperBytes:Buffer.from('test'),stateBytes:Buffer.from('{}')}),/original_installer_sha_drift/);
});
test('pure module exports zero privileged execution controls',()=>{
  assert.deepEqual(Object.keys(x).sort(),['ANCHOR','INSERT','TARGET','OP','patchPure','verifySyntax','audit'].sort());
  const source=fs.readFileSync(require.resolve('./honartik-iticket-root-owner-anchor-audit-v1.cjs'),'utf8');
  for(const s of ["require('node:fs')","require('node:child_process')","process.argv",
    "process.env.",'runInNewContext(','runInThisContext(','writeFileSync(','renameSync('])
    assert.equal(source.includes(s),false,'unsafe executable primitive '+s);
});
