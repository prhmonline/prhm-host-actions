import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('safeFiles-waha-singlefile-idempotent-v3.mjs','utf8');
const start=source.indexOf('export function registerSafeFilesPlugin(mcp,context){');
const end=source.indexOf('// WAHA_SINGLEFILE_PINNED_IDEMPOTENT_V3',start);
assert.ok(start>=0&&end>start);

const reviewed=[
  {
    name:'waha_student_bridge_registration_preflight_v1',
    cfg:{
      title:'Preflight WAHA Student Bridge Registration',
      description:'Fixed zero-input read-only preflight of the reviewed SHA-bound WAHA Student Bridge registration bundle against the current Agent 3 control-plane owners.'
    }
  },
  {
    name:'waha_student_bridge_registration_apply_v1',
    cfg:{
      title:'Apply WAHA Student Bridge Registration',
      description:'After explicit Level-4 confirmation, atomically register only the reviewed fixed WAHA Student Bridge Host Actions against exact live preimages. No database mutation or service restart; a separate approved ZDT refresh is required.'
    }
  }
];
function createRegister(){
  const ctx={
    TOOL_NAMES:reviewed.map(x=>x.name),
    fail:message=>{throw new Error(message);},
    base:{
      registerSafeFilesPlugin(mcp){
        if(!mcp._registeredTools.existing){
          mcp.registerTool('existing',{title:'Existing Tool',description:'Do not remove'});
        }
        return 'preserved';
      }
    },
    reviewedWaha:{
      registerSafeFilesPlugin(mcp){
        for(const x of reviewed)mcp.registerTool(x.name,x.cfg,()=>null);
      }
    }
  };
  vm.runInNewContext(source.slice(start,end).replace('export function','function')+'\nregister=registerSafeFilesPlugin;',ctx);
  return ctx.register;
}
function fakeMcp(){
  const mcp={_registeredTools:Object.create(null),writes:[]};
  mcp.registerTool=function(name,cfg,handler){
    if(this._registeredTools[name])throw new Error('Tool '+name+' is already registered');
    const value={...cfg,enabled:true,handler};
    this._registeredTools[name]=value;
    this.writes.push(name);
    return value;
  };
  return mcp;
}
test('real wrapper registrar may safely initialize same exact two WAHA tools twice',()=>{
  const reg=createRegister(),mcp=fakeMcp();
  assert.equal(reg(mcp,{}),'preserved');
  assert.deepEqual(mcp.writes,['existing',...reviewed.map(x=>x.name)]);
  assert.equal(reg(mcp,{}),'preserved');
  assert.deepEqual(mcp.writes,['existing',...reviewed.map(x=>x.name)]);
});
test('unknown or conflicting WAHA registrations fail closed',()=>{
  const reg=createRegister(),mcp=fakeMcp();
  mcp._registeredTools[reviewed[0].name]={title:'Wrong Tool',description:'Wrong',enabled:true};
  assert.throws(()=>reg(mcp,{}),/waha_existing_tool_contract_mismatch/);
  const second=fakeMcp();
  second._registeredTools[reviewed[1].name]={...reviewed[1].cfg,enabled:false};
  assert.throws(()=>reg(second,{}),/waha_existing_tool_contract_mismatch/);
});
test('no arbitrary duplicate suppression; exact trusted metadata only',()=>{
  assert.match(source,/waha_existing_tool_contract_mismatch/);
  assert.match(source,/existing\.title!==cfg\.title\|\|existing\.description!==cfg\.description/);
  assert.match(source,/waha_tool_duplicate_in_source/);
  assert.match(source,/current_safeFiles_exact_backup_missing/);
  assert.match(source,/reviewed_waha_blob_sha_mismatch/);
});
