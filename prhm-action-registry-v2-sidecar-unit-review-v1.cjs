'use strict';
/**
 * SHA-pinned, read-only attestation of the independent Honartik V2 systemd unit.
 * No install, enable, start, approval request, secret read or mutation.
 * IMPORTANT: ReadOnlyPaths is not a grant of DAC read privileges; the
 * Approval Center private receipt must be verified under the real host sandbox.
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const socket=require('./prhm-action-registry-v2-isolated-socket-v1.cjs');
const vault=require('./prhm-action-registry-v2-root-sealed-token-vault-v1.cjs');
const receipt=require('./prhm-action-registry-v2-root-consumed-receipt-v1.cjs');
const transport=require('./prhm-action-registry-v2-root-approval-transport-v1.cjs');
const SOURCE='systemd/prhm-shared-registry-approval-v2.service';
const DEST='/etc/systemd/system/prhm-shared-registry-approval-v2.service';
const REVIEWED_BLOB='dc87ad2937b63ab965944cef081f55a6a0984cdd';
const ROOT='/opt/prhm-agent-selfmaint-exec/actions/shared-registry-v2';
const NO_GO=Object.freeze([
 'NO_SIGNED_FIVE_FIELD_BOOTSTRAP_INSTALLED',
 'NO_VERIFIED_HOST_PRIVATE_LEDGER_ACCESS',
 'NO_SIGNED_INDEPENDENT_ROOT_LAUNCHER',
 'NO_ROOT_DURABLE_RECOVERY_AND_DUAL_MCP_DISCOVERY'
]);
function fail(c){throw Error('registry_v2_sidecar_unit_'+c)}
function check(v,c){if(!v)fail(c)}
function blobSha(b){
 return crypto.createHash('sha1')
  .update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
}
function review(bytes){
 check(Buffer.isBuffer(bytes)&&bytes.length>800&&bytes.length<8000,
  'unit_file_size_invalid');
 const value=bytes.toString('utf8');
 check(Buffer.from(value).equals(bytes)&&!value.includes('\r')&&
  value.endsWith('\n'),'unit_file_encoding_invalid');
 check(blobSha(bytes)===REVIEWED_BLOB,'git_blob_sha_mismatch');
 const sections=Object.create(null);
 let section=null;
 for(const line of value.split('\n').map(s=>s.trim())){
  if(!line||line.startsWith('#'))continue;
  if(line==='[Unit]'||line==='[Service]'){
   section=line.slice(1,-1);
   check(!sections[section],'duplicate_section');
   sections[section]=Object.create(null);continue;
  }
  check(section&&line.includes('=')&&!line.startsWith('['),
   'invalid_unit_directive');
  const at=line.indexOf('='),key=line.slice(0,at);
  check(!Object.hasOwn(sections[section],key),
   'duplicate_directive');
  sections[section][key]=line.slice(at+1);
 }
 check(Object.keys(sections).sort().join('|')==='Service|Unit',
  'unreviewed_section');
 const s=sections.Service;
 const expected=Object.freeze({
  Type:'simple',User:'root',Group:'root',UMask:'0077',
  WorkingDirectory:ROOT,
  ExecStart:'/usr/local/bin/prhm-node20 '+ROOT+
   '/prhm-action-registry-v2-isolated-socket-v1.cjs',
  Restart:'no',TimeoutStartSec:'15',TimeoutStopSec:'10',
  KillMode:'control-group',
  RuntimeDirectory:'prhm-shared-registry-v2',
  RuntimeDirectoryMode:'0700',RuntimeDirectoryPreserve:'no',
  NoNewPrivileges:'yes',PrivateTmp:'yes',PrivateDevices:'yes',
  ProtectSystem:'strict',ProtectHome:'yes',
  ProtectKernelTunables:'yes',ProtectKernelModules:'yes',
  ProtectControlGroups:'yes',ProtectClock:'yes',
  ProtectHostname:'yes',RestrictSUIDSGID:'yes',
  RestrictNamespaces:'yes',LockPersonality:'yes',
  RestrictAddressFamilies:'AF_UNIX AF_INET',
  IPAddressDeny:'any',IPAddressAllow:'localhost',
  CapabilityBoundingSet:'CAP_DAC_READ_SEARCH',AmbientCapabilities:'',
  ReadWritePaths:socket.SOCKET_DIR+' '+vault.DIR,
  ReadOnlyPaths:receipt.DIR+' '+receipt.PUBLIC+' '+transport.ENV,
  StandardOutput:'journal',StandardError:'journal',
  SyslogIdentifier:'prhm-shared-registry-approval-v2'
 });
 check(Object.keys(s).sort().join('|')===
  Object.keys(expected).sort().join('|'),
  'service_directives_added_or_removed');
 for(const [k,v] of Object.entries(expected))
  check(s[k]===v,'unit_drift_'+k);
 check(Object.keys(sections.Unit).sort().join('|')===
  'After|Description|StartLimitBurst|StartLimitIntervalSec',
  'unit_directive_set_changed');
 check(sections.Unit.StartLimitBurst==='1'&&
  sections.Unit.StartLimitIntervalSec==='0',
  'start_limit_changed');
 check(socket.UNIT===DEST.split('/').pop()&&
  socket.SOCKET_DIR==='/run/prhm-shared-registry-v2',
  'sidecar_unit_identity_drift');
 return Object.freeze({
  schema:'prhm.registry-v2.systemd-source-review.v1',
  unit:socket.UNIT,source_git_blob_sha1:REVIEWED_BLOB,
  review_passed:true,host_installed:false,
  installation_authorized:false,production_mutation:false,
  blockers:NO_GO
 });
}
function inspectInstalled({io=fs,getuid=()=>process.getuid?.()}={}){
 check(getuid()===0,'root_required');
 const parent='/etc/systemd/system',pd=io.lstatSync(parent);
 check(pd.isDirectory()&&!pd.isSymbolicLink()&&
  io.realpathSync(parent)===parent&&pd.uid===0&&
  (pd.mode&0o022)===0,'systemd_parent_unsafe');
 const before=io.lstatSync(DEST);
 check(before.isFile()&&!before.isSymbolicLink()&&
  io.realpathSync(DEST)===DEST&&before.uid===0&&
  (before.mode&0o022)===0&&before.size>800&&before.size<8000,
  'installed_unit_unsafe');
 const fd=io.openSync(DEST,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let b;
 try{
  const after=io.fstatSync(fd);
  check(after.isFile()&&after.dev===before.dev&&
   after.ino===before.ino&&after.mode===before.mode&&
   after.uid===before.uid&&after.gid===before.gid&&
   after.size===before.size,'installed_unit_race');
  b=io.readFileSync(fd);
 }finally{io.closeSync(fd)}
 check(Buffer.isBuffer(b)&&b.length===before.size,'short_read');
 const later=io.lstatSync(parent);
 check(later.ino===pd.ino&&later.dev===pd.dev,
  'systemd_parent_replaced');
 return Object.freeze({...review(b),host_installed:true,
  installation_authorized:false,production_mutation:false});
}
module.exports=Object.freeze({
 SOURCE,DEST,REVIEWED_BLOB,NO_GO,review,inspectInstalled
});
