'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cp=require('node:child_process');
const path=require('node:path');
const evidence=require('../ops/agent3-universal-backup/native-five-field-live-handler-evidence.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fake(){
 const lengths={base:560,executor:1097,policy:1195,mcp:49};
 const bytes={},pins={};
 for(const k of evidence.NAMES){
  const lines=Array.from({length:lengths[k]},(_,i)=>
    'const safe_'+k+'_'+(i+1)+' = '+(i+1)+';');
  lines[2]='const OUTSIDE_SECRET_NEVER_DISCLOSE = "excluded";';
  const first=evidence.WINDOWS[k][0][0];
  lines[first-1]="const typed_action='agent3_universal_backup_engine_install_v1';";
  lines[first]="const pass = process.env.SECRET_PASSPHRASE;";
  lines[first+1]="const hidden = 'ghp_"+'x'.repeat(50)+"';";
  lines[first+2]="const bridge='host_action_v2_apply';";
  bytes[k]=Buffer.from(lines.join('\n'),'utf8');
  pins[k]=sha(bytes[k]);
 }
 return {bytes,pins};
}
test('report includes only narrowly selected line windows, digest and exact owners',()=>{
 const {bytes,pins}=fake();
 const projected=evidence.project(bytes,pins);
 assert.equal(projected.mode,'READ_ONLY_BOUNDED_FOUR_OWNER_HANDLERS');
 assert.equal(projected.unsafe_to_apply,true);
 assert.equal(projected.production_mutation,false);
 assert.equal(projected.approval_issued,false);
 assert.equal(projected.approval_consumed,false);
 assert.equal(projected.source_export_complete,false);
 assert.deepEqual(Object.keys(projected.owners).sort(),evidence.NAMES.slice().sort());
 const count=evidence.NAMES.reduce((n,k)=>n+evidence.WINDOWS[k].reduce((a,[l,r])=>a+r-l+1,0),0);
 assert.equal(projected.selected_lines,count);
 assert.equal(projected.redacted_lines,8);
 for(const k of evidence.NAMES){
  const owner=projected.owners[k];
  assert.equal(owner.original_sha256,pins[k]);
  assert.equal(owner.total_source_lines,({base:560,executor:1097,policy:1195,mcp:49})[k]);
  assert.equal(owner.selected.some(x=>x.line===3),false);
  assert.equal(owner.selected.every(x=>x.line>20),true);
  assert.equal(owner.selected.find(x=>x.line===evidence.WINDOWS[k][0][0]).source.includes('typed_action'),true);
  assert.equal(owner.selected.find(x=>x.line===evidence.WINDOWS[k][0][0]+1).redacted,true);
  assert.equal(owner.selected.find(x=>x.line===evidence.WINDOWS[k][0][0]+2).redacted,true);
 }
 assert.equal(JSON.stringify(projected).includes('OUTSIDE_SECRET_NEVER_DISCLOSE'),false);
 assert.equal(JSON.stringify(projected).includes('ghp_'+ 'x'.repeat(50)),false);
});
test('redacts secret-bearing source lines, full private keys and long literals',()=>{
 for(const s of [
  'const x=process.env.DB_PASSWORD;',
  'authorization: Bearer abcdefghijklmnopqrs0123',
  'const password = "secret";',
  'const key = "-----BEGIN PRIVATE KEY-----"',
  "const token = 'sk-abcdef0123456789abcdef0123456789';",
  'const cookie = "session-value";',
  "const token = 'short';",
  "const approval_token='tiny';",
  "const x={token:'short'};",
  "const x={'approval_token':'tiny'};"
 ])assert.equal(evidence.sanitizeLine(s).redacted,true,s);
 const raw='const keyHash='+'a'.repeat(64)+';';
 const info=evidence.sanitizeLine(raw);
 assert.equal(info.redacted,true);
 assert.equal(info.source.includes('a'.repeat(48)),false);
 assert.equal(info.sha256,sha(Buffer.from(raw)));
 const huge='z'.repeat(evidence.MAX_SOURCE_LINE+1);
 const denied=evidence.sanitizeLine(huge);
 assert.equal(denied.why,'OVERSIZED_SOURCE_LINE');
 assert.equal(denied.source.includes('z'),false);
});
test('refuses unpinned or missing owner, and unexpectedly short source without exposing bytes',()=>{
 const {bytes,pins}=fake();
 assert.throws(()=>evidence.project(bytes),/owner_sha_mismatch/);
 assert.throws(()=>evidence.project({...bytes,mcp:Buffer.from('changed')},pins),/owner_sha_mismatch/);
 const missing={...bytes};delete missing.base;
 assert.throws(()=>evidence.project(missing,pins),/exact_four_buffers_required/);
 const short={...bytes,base:Buffer.from('ok')};
 assert.throws(()=>evidence.project(short,{...pins,base:sha(short.base)}),/insufficient_owner_lines:base/);
});
test('read-only program has no free-form CLI apply, stage or source upload',()=>{
 const script=path.join(__dirname,'../ops/agent3-universal-backup/native-five-field-live-handler-evidence.cjs');
 const p=cp.spawnSync(process.execPath,[script,'--apply'],{encoding:'utf8',timeout:10000});
 assert.equal(p.status,64);
 assert.match(p.stderr,/read-only --handlers only/);
 assert.equal(typeof evidence.install,'undefined');
 assert.equal(typeof evidence.upload,'undefined');
 assert.equal(typeof evidence.approve,'undefined');
});
