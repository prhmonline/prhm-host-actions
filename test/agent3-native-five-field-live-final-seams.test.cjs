'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const child=require('node:child_process');
const path=require('node:path');
const mod=require('../ops/agent3-universal-backup/native-five-field-live-final-seams.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const linesRequired={base:560,executor:1097,policy:1195,mcp:49};
function fixture(){
 const files={},pins={};
 for(const key of mod.KEYS){
  const lines=Array.from({length:linesRequired[key]},(_,i)=>
   'const fixed_'+key+'_'+(i+1)+' = '+(i+1)+';');
  // MCP includes lines 1–26; place the canary in its excluded gap 27–40.
  lines[key==='mcp'?29:3]="const SECRET_OUTSIDE_REQUEST_WINDOW='NOEXPORT';";
  const first=mod.WINDOWS[key][0][0]-1;
  lines[first]="const requestAction='agent3_universal_backup_engine_install_v1';";
  lines[first+1]="const approval_token='small';";
  lines[first+2]='const real_auth=process.env.SIGNING_KEY;';
  files[key]=Buffer.from(lines.join('\n'));
  pins[key]=sha(files[key]);
 }
 return {files,pins};
}
test('fixed final windows contain exact missing native v2 handler locations only',()=>{
 const {files,pins}=fixture();
 const out=mod.inspect(files,pins);
 assert.equal(out.mode,'SHA_PINNED_REDACTED_BOUNDED_SOURCE_WINDOWS');
 assert.equal(out.owner_count,4);
 assert.equal(out.redacted_count,8);
 assert.equal(out.approved_to_install,false);
 assert.equal(out.approval_requested,false);
 assert.equal(out.approval_consumed,false);
 assert.equal(out.production_mutation,false);
 assert.equal(out.complete_source_disclosed,false);
 const expected=Object.values(mod.WINDOWS).flatMap(x=>x).reduce((n,[s,e])=>n+e-s+1,0);
 assert.equal(out.selected_count,expected);
 assert.equal(out.owners.base.excerpts[0].n,485);
 assert.equal(out.owners.executor.excerpts.some(x=>x.n===966),true);
 assert.equal(out.owners.executor.excerpts.at(-1).n,1097);
 assert.equal(out.owners.mcp.excerpts.some(x=>x.n===1),true);
 assert.equal(out.owners.mcp.excerpts.at(-1).n,49);
 for(const key of mod.KEYS){
  assert.equal(out.owners[key].sha256,pins[key]);
  const body=JSON.stringify(out.owners[key]);
  assert.equal(body.includes('NOEXPORT'),false);
  assert.equal(body.includes("approval_token='small'"),false);
  assert.equal(body.includes('process.env.SIGNING_KEY'),false);
 }
});
test('mis-matched SHA, missing source, invalid object, insufficient lines fail closed',()=>{
 const {files,pins}=fixture();
 assert.throws(()=>mod.inspect(files),/preimage_drift/);
 assert.throws(()=>mod.inspect({...files,extra:Buffer.from('x')},pins),/four_fixed_owners_required/);
 assert.throws(()=>mod.inspect({...files,executor:Buffer.from('small')},
  {...pins,executor:sha(Buffer.from('small'))}),/owner_line_count_drift:executor/);
 assert.throws(()=>mod.inspect({...files,base:Buffer.from('wrong')},pins),/preimage_drift:base/);
});
test('fixed view bounds reject extremely large yet independently pinned data',()=>{
 const {files,pins}=fixture();
 // 250 unredacted source lines, each below sensitive per-line limits,
 // cumulatively violate bounded terminal exposure without altering pins.
 const l=files.executor.toString().split('\n');
 for(let i=970;i<1080;i++)l[i]='const innocuousLine'+i+' = "'+'a.'.repeat(3000)+'";';
 files.executor=Buffer.from(l.join('\n'));
 pins.executor=sha(files.executor);
 assert.throws(()=>mod.inspect(files,pins),/output_too_large/);
});
test('tool is read only and refuses any executable CLI action',()=>{
 const target=path.join(__dirname,'../ops/agent3-universal-backup/native-five-field-live-final-seams.cjs');
 const r=child.spawnSync(process.execPath,[target,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(r.status,64);
 assert.match(r.stderr,/readonly --inspect only/);
 assert.equal(typeof mod.install,'undefined');
 assert.equal(typeof mod.consumeApproval,'undefined');
 assert.equal(typeof mod.writeFile,'undefined');
});
