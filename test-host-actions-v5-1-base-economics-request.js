const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
function load(){
  const src=fs.readFileSync(path.join(__dirname,'bootstrap-host-actions-v5-1-base-economics-request.js'),'utf8')
    .replace(/\nmain\(\);\s*$/,'\nmodule.exports={patchBase,unixHealth};\n');
  const tmp=path.join(os.tmpdir(),'v51-'+process.pid+'-'+Date.now()+'.js'); fs.writeFileSync(tmp,src);
  const mod=require(tmp); fs.unlinkSync(tmp); return mod;
}
test('patchBase adds only the fixed Economics Foundation Host Action v2 spec',()=>{
  const {patchBase}=load();
  const before="const HOST_ACTION_V2_SPECS = Object.freeze({\n  mcp_candidate_schema_compare_v1: { operation: 'host_action.mcp_candidate_schema_compare_v1', rollback: 'host-action-v2:mcp-candidate-schema-compare-v1:auto-backup' }\n});";
  const after=patchBase(before);
  assert.match(after,/leadops_economics_inputs_foundation_v1/);
  assert.match(after,/host_action\.leadops_economics_inputs_foundation_v1/);
  assert.equal((after.match(/leadops_economics_inputs_foundation_v1/g)||[]).length,2);
  assert.equal(after.replace(/,\n  leadops_economics_inputs_foundation_v1:[\s\S]*? \}\n\}\);$/,"\n});"),before);
});
test('unixHealth retries transient socket readiness failures',()=>{
  let n=0; const original=cp.spawnSync;
  cp.spawnSync=(file,args,opts)=>{
    if(file==='/usr/bin/curl'){
      n++; if(n<3)return {status:7,stdout:'',stderr:'not ready'};
      return {status:0,stdout:'{"ok":true,"version":"1.0.0-l4-fail-closed"}',stderr:''};
    }
    return original(file,args,opts);
  };
  try{const {unixHealth}=load(); assert.equal(unixHealth('/x').ok,true); assert.equal(n,3);}finally{cp.spawnSync=original;}
});
