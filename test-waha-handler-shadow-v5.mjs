import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const text=fs.readFileSync('safeFiles-waha-singlefile-handler-shadow-v5.mjs','utf8');
const reviewed=fs.readFileSync('waha-student-bridge-registration-surface-v37.mjs');
function shaBlob(bytes){return createHash('sha1').update(Buffer.from('blob '+bytes.length)).update(Buffer.from([0])).update(bytes).digest('hex')}
const config=[
 ['waha_student_bridge_registration_preflight_v1',{
 title:'Preflight WAHA Student Bridge Registration',
 description:'Fixed zero-input read-only preflight of the reviewed SHA-bound WAHA Student Bridge registration bundle against the current Agent 3 control-plane owners.',
 annotations:{readOnlyHint:true}
 }],
 ['waha_student_bridge_registration_apply_v1',{
 title:'Apply WAHA Student Bridge Registration',
 description:'After explicit Level-4 confirmation, atomically register only the reviewed fixed WAHA Student Bridge Host Actions against exact live preimages. No database mutation or service restart; a separate approved ZDT refresh is required.',
 annotations:{destructiveHint:true}
 }]
];
function registrar(custom={}) {
 const p=text.indexOf('export function registerSafeFilesPlugin(mcp,context){'), end=text.indexOf('// WAHA_SINGLEFILE_HANDLER_SHADOW_V5',p);
 assert.ok(p>=0&&end>p);
 const ctx={
   TOOL_NAMES:config.map(x=>x[0]),
   fail:reason=>{throw new Error(reason)},
   base:{registerSafeFilesPlugin(mcp){
     mcp.registerTool('existing_agent_tool',{title:'Existing Agent Tool',description:'Protected'},()=>42);
     const legacy={};
     for(const [name,cfg] of config) {
       const effective={...cfg,...(custom.legacyOverride?.[name]||{})};
       legacy[name]=function legacyHandler(){return 'OLD_PIPE_ERROR'};
       mcp.registerTool(name,effective,legacy[name]);
     }
     if(custom.duplicateLegacy) mcp.registerTool(config[0][0],config[0][1],()=>null);
     if(custom.extraTool) mcp.registerTool('another_existing_tool',{title:'Another Tool',description:'Protected'},()=>100);
     return 'FULL_BASE_PRESERVED';
   }},
   reviewedWaha:{registerSafeFilesPlugin(mcp){
     for(const [name,cfg] of config) {
       const effective={...cfg,...(custom.reviewedOverride?.[name]||{})};
       mcp.registerTool(name,effective,()=> 'NEW_JOURNAL_HANDLER');
     }
   }}
 };
 vm.runInNewContext(text.slice(p,end).replace('export function','function')+'\nregistration=registerSafeFilesPlugin;',ctx);
 return ctx.registration;
}
function mcp(){
 const registry=Object.create(null);
 return {
  _registeredTools:registry,
  registerTool(name,cfg,handler){
   if(registry[name])throw Error('Tool '+name+' is already registered');
   registry[name]={...cfg,handler,enabled:true};
   return registry[name];
  }
 }
}
test('base legacy WAHA handlers are shadowed, reviewed journal handlers replace them, other tools preserved',()=>{
 const mm=mcp();const result=registrar({extraTool:true})(mm,{});
 assert.equal(result,'FULL_BASE_PRESERVED');
 assert.deepEqual(Object.keys(mm._registeredTools),['existing_agent_tool','another_existing_tool',...config.map(x=>x[0])]);
 assert.equal(mm._registeredTools.existing_agent_tool.handler(),42);
 assert.equal(mm._registeredTools.another_existing_tool.handler(),100);
 for(const [name] of config)assert.equal(mm._registeredTools[name].handler(),'NEW_JOURNAL_HANDLER');
});
test('legacy conflicting metadata must fail closed, not quietly suppress a different tool',()=>{
 const mm=mcp();const name=config[0][0];
 assert.throws(()=>registrar({legacyOverride:{[name]:{title:'Other Action'}}})(mm,{}),/waha_legacy_reviewed_tool_contract_mismatch/);
});
test('legacy duplications fail closed',()=>{
 assert.throws(()=>registrar({duplicateLegacy:true})(mcp(),{}),/waha_legacy_duplicate_registration/);
});
test('reviewed conflicting metadata must fail closed',()=>{
 const name=config[1][0];
 assert.throws(()=>registrar({reviewedOverride:{[name]:{description:'Unexpected action'}}})(mcp(),{}),/waha_legacy_reviewed_tool_contract_mismatch/);
});
test('reviewed WAHA raw Git source and journal fix retained, pinned original owner backup',()=>{
 const m=text.match(/const WAHA_B64='([A-Za-z0-9+/=]+)';/);
 assert.ok(m);
 assert.deepEqual(Buffer.from(m[1],'base64'),reviewed);
 assert.equal(shaBlob(reviewed),'7b6e08d2ffb9faed164115be085491fce7ce6261');
 assert.match(text,/current_safeFiles_exact_backup_missing/);
 assert.match(text,/OWNER_SHA256='822e2188d1cb80578fb150eb0066c522c38696459d673ef863473cf584f1c05e'/);
 assert.match(text,/waha_legacy_exact_two_missing/);
 assert.match(text,/waha_unexpected_existing_tool/);
 assert.match(text,/waha_legacy_reviewed_tool_contract_mismatch/);
});