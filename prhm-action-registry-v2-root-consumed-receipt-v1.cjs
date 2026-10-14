'use strict';
/**
 * Fixed root-only READ of a consumed, exact Honartik V2 Approval Center L4.
 *
 * The existing real Approval Center stores consumption as
 * /var/lib/prhm-company-approval/consumed/<approval_id>.json, NOT
 * <request_id>.json. approval_id MUST be derived from a cryptographically
 * verified Ed25519 token loaded from the existing root-sealed vault.
 *
 * No file writes, HTTP, token issuance, replay, install, service or CLI.
 * Neither an unverified JSON ledger nor a caller-provided approval_id can
 * become trusted receipt evidence. A sidecar's root service sandbox must
 * separately be allowed to read the Approval Center's private state.
 */
const fs=require('node:fs');
const path=require('node:path');
const g=require('./prhm-action-registry-gateway-v1.cjs');
const F=require('./prhm-action-registry-v2-five-field-approval-gate-v1.cjs');
const vault=require('./prhm-action-registry-v2-root-sealed-token-vault-v1.cjs');
const PUBLIC=vault.PUBLIC;
const DIR='/var/lib/prhm-company-approval/consumed';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(reason){throw Error('registry_v2_consumed_receipt_'+reason)}
function check(ok,why){if(!ok)fail(why)}
function dir(io,filename){
 const stat=io.lstatSync(filename);
 check(stat.isDirectory()&&!stat.isSymbolicLink()&&
   io.realpathSync(filename)===filename&&
   stat.uid>=0&&Number.isSafeInteger(stat.uid)&&
   stat.gid>=0&&Number.isSafeInteger(stat.gid)&&
   (stat.mode&0o022)===0,'private_state_dir_unsafe');
 return stat;
}
function fixedRead(io,filename,{min,max,privateMode}){
 const parent=path.posix.dirname(filename);
 const d=dir(io,parent);
 const st=io.lstatSync(filename);
 check(st.isFile()&&!st.isSymbolicLink()&&
  io.realpathSync(filename)===filename&&
  (st.uid===d.uid||st.uid===0)&&
  Number.isSafeInteger(st.size)&&st.size>=min&&st.size<=max&&
  ((st.mode&0o022)===0)&&
  (!privateMode||(st.mode&0o777)===0o600),
  'receipt_file_untrusted');
 const fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let bytes;
 try{
  const post=io.fstatSync(fd);
  check(post.isFile()&&!post.isSymbolicLink()&&
   post.uid===st.uid&&post.gid===st.gid&&
   post.dev===st.dev&&post.ino===st.ino&&
   post.mode===st.mode&&post.size===st.size,
   'receipt_inode_or_mode_changed');
  bytes=io.readFileSync(fd);
 }finally{io.closeSync(fd)}
 check(Buffer.isBuffer(bytes)&&bytes.length===st.size,
  'receipt_short_read');
 const after=dir(io,parent);
 check(after.ino===d.ino&&after.dev===d.dev&&after.uid===d.uid&&
  after.gid===d.gid&&after.mode===d.mode,
  'parent_replaced_during_read');
 return bytes;
}
function createReader({io=fs,getuid=()=>process.getuid?.(),
  clock=()=>Math.floor(Date.now()/1000),
  loadSealedApprovedToken}={}){
 check(typeof io?.lstatSync==='function'&&
   typeof io?.fstatSync==='function'&&
   typeof io?.readFileSync==='function'&&
   typeof io?.closeSync==='function'&&
   typeof getuid==='function'&&typeof clock==='function'&&
   typeof loadSealedApprovedToken==='function',
  'trusted_root_dependencies_missing');
 function readConsumedEvidence(requestId){
  check(getuid()===0,'root_process_required');
  check(typeof requestId==='string'&&UUID.test(requestId),
    'request_id_invalid');
  const key=fixedRead(io,PUBLIC,{min:80,max:8192,privateMode:false});
  const token=loadSealedApprovedToken(requestId);
  // Proves both the signature and immutable request/operation binding
  // before using any token-derived filename.
  const claims=g.decodeJws(token,key);
  check(UUID.test(claims.approval_id||'')&&
    claims.request_id===requestId&&claims.jti===claims.approval_id,
    'signed_approval_and_request_id_mismatch');
  const filename=DIR+'/'+claims.approval_id+'.json';
  const bytes=fixedRead(io,filename,{min:100,max:16384,privateMode:true});
  let ledger;
  try{ledger=JSON.parse(bytes.toString('utf8'))}
  catch{fail('consumed_ledger_not_json')}
  const nowSec=clock();
  check(Number.isSafeInteger(nowSec)&&nowSec>0,'trusted_time_invalid');
  const verified=F.verifyConsumedCryptographically({
    token,publicKey:key,ledger,nowSec
  });
  check(verified.request_id===requestId&&
    verified.action===F.REQUEST.action&&
    verified.arguments_sha256===F.ARGUMENTS_SHA,
    'consumed_ledger_identity_drift');
  // Adapter independently verifies these exact values again against
  // its sealed token; no token is returned or logged.
  return Object.freeze({
    publicKey:Buffer.from(key),ledger:Object.freeze({...ledger}),nowSec
  });
 }
 return Object.freeze({readConsumedEvidence});
}
module.exports=Object.freeze({PUBLIC,DIR,createReader});
