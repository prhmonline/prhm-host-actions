'use strict';
/**
 * Two genuine V2 runner capabilities: read-only original-state proof and
 * durable once-only metadata audit. Strictly the SHA-locked Honartik release.
 *
 * No installer, rollback executor, MCP probe, shell, network or CLI.
 * This module NEVER decides if an L4 was consumed; the independent runner
 * must make that verified signed decision and claim O_EXCL first.
 *
 * Audit writes only to the fixed root-owned existing 0700 audit directory.
 * Any uncertain/torn write is NOT cleaned up or replayed.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const G=require('./prhm-action-registry-gateway-v1.cjs');
const manifest=require('./manifests/honartik-config-center-registry-release-v2.json');
const pinned=require('./prhm-action-registry-v2-root-pinned-readers-v1.cjs');
const gate=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const AUDIT='/var/lib/prhm-agent-selfmaint-exec/registry-audit-v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(code){throw Error('registry_v2_root_accountability_'+code)}
function check(ok,code){if(!ok)fail(code)}
function exact(o,keys){
 check(o&&typeof o==='object'&&!Array.isArray(o)&&
   Object.keys(o).sort().join('|')===keys.slice().sort().join('|'),
  'input_schema_unexpected');
}
function checkRelease(release){
 check(release?.source_commit===gate.REQUEST.source_commit&&
   release?.manifest_commit===gate.REQUEST.manifest_commit&&
   release?.manifest_sha256===gate.REQUEST.manifest_sha256,
   'release_identity_drift');
 const v=G.assertManifest(manifest),got=release.normalized;
 check(v.project==='honartik'&&v.action==='honartik_config_center_readonly_enroll_v1'&&
  got?.project===v.project&&got?.action===v.action,
  'release_action_not_allowlisted');
 check(Object.keys(got.owners||{}).sort().join('|')==='base|executor|mcp|policy',
  'owner_set_changed');
 for(const [key,p]of Object.entries(v.owners)){
  const item=got.owners[key];
  check(item?.path===p.path&&
   item.before_sha256===p.before_sha256&&
   item.after_sha256===p.after_sha256,
   'owner_sha_drift_'+key);
 }
 check(Array.isArray(got.assets)&&got.assets.length===5,
  'new_asset_count_changed');
 for(const a of v.assets){
  check(got.assets.some(x=>x.path===a.path&&x.sha256===a.sha256&&
    x.source_path===a.source_path),
   'asset_pin_drift');
 }
 return v;
}
function strictOriginalState(release,{
 io=fs,readLiveOwner,uid=()=>process.getuid?.()
}={}){
 check(uid()===0,'root_required');
 const v=checkRelease(release);
 check(typeof readLiveOwner==='function'&&
  typeof io?.lstatSync==='function'&&typeof io?.realpathSync==='function',
  'untrusted_readers');
 for(const p of Object.values(v.owners)){
  const b=readLiveOwner(p.path);
  check(Buffer.isBuffer(b)&&sha(b)===p.before_sha256,
   'owner_not_restored_'+p.path);
 }
 for(const a of v.assets){
  const parent=path.posix.dirname(a.path),d=io.lstatSync(parent);
  check(d.isDirectory()&&!d.isSymbolicLink()&&
   io.realpathSync(parent)===parent&&
   d.uid===0&&(d.mode&0o022)===0,
   'asset_parent_unsafe');
  try{io.lstatSync(a.path);fail('asset_still_installed')}
  catch(e){if(e?.code!=='ENOENT')throw e}
 }
 return true;
}
function auditPayload(rec,requestId){
 const common=['request_id','action','project','source_commit',
  'manifest_commit','manifest_sha256','result','rollback'];
 const good=rec?.result==='registered';
 exact(rec,good?common:common.concat('failure_code'));
 check(UUID.test(requestId)&&rec.request_id===requestId&&
  rec.action==='honartik_config_center_readonly_enroll_v1'&&
  rec.project==='honartik'&&rec.source_commit===gate.REQUEST.source_commit&&
  rec.manifest_commit===gate.REQUEST.manifest_commit&&
  rec.manifest_sha256===gate.REQUEST.manifest_sha256,
  'audit_release_or_request_untrusted');
 if(good)check(rec.rollback==='not_needed','audit_success_rollback_invalid');
 else check(rec.result==='failed'&&rec.rollback==='verified'&&
  typeof rec.failure_code==='string'&&
  rec.failure_code.length>0&&rec.failure_code.length<=160&&
  /^[a-zA-Z0-9_:. -]+$/.test(rec.failure_code),
  'audit_failure_untrusted');
 const body=Buffer.from(G.canonicalJson({
  schema:'prhm.registry-v2.audit.v1',...rec
 })+'\n');
 check(body.length>120&&body.length<=2048,'audit_bytes_invalid');
 return Object.freeze({filename:AUDIT+'/'+requestId+'.json',
  body,sha256:sha(body)});
}
function appendBoundAudit(rec,{requestId,io=fs,uid=()=>process.getuid?.()}={}){
 check(uid()===0,'root_required');
 const record=auditPayload(rec,requestId);
 const directory=io.lstatSync(AUDIT);
 check(directory.isDirectory()&&!directory.isSymbolicLink()&&
  io.realpathSync(AUDIT)===AUDIT&&directory.uid===0&&
  directory.gid===0&&(directory.mode&0o777)===0o700,
  'audit_directory_not_root_private');
 const fd=io.openSync(record.filename,fs.constants.O_WRONLY|
  fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{
  check(io.writeSync(fd,record.body,0,record.body.length)===record.body.length,
   'audit_torn_write_indeterminate');
  io.fsyncSync(fd);
  const s=io.fstatSync(fd);
  check(s.isFile()&&!s.isSymbolicLink()&&s.uid===0&&s.gid===0&&
   (s.mode&0o777)===0o600&&s.size===record.body.length,
   'audit_file_postcondition_untrusted');
 }finally{io.closeSync(fd)}
 const dirFd=io.openSync(AUDIT,fs.constants.O_RDONLY|
  fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 try{
  const after=io.fstatSync(dirFd);
  check(after.isDirectory()&&after.ino===directory.ino&&
   after.dev===directory.dev&&after.uid===directory.uid&&
   after.gid===directory.gid,'audit_parent_replaced');
  io.fsyncSync(dirFd);
 }finally{io.closeSync(dirFd)}
 return Object.freeze({durable:true,written:true,
  request_id:requestId,record_sha256:record.sha256});
}
module.exports=Object.freeze({AUDIT,checkRelease,strictOriginalState,
 auditPayload,appendBoundAudit});
