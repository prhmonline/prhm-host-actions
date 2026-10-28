'use strict';
/**
 * Issue #217: READ-ONLY root trust snapshot for FUTURE native Host Actions
 * adapter. This does NOT register an action, issue/consume an approval, execute
 * an installer, or authorize Production mutation. No CLI or caller paths.
 *
 * The existing root-owned executor must perform an independently audited,
 * one-time ledger consumption and maintain the durable transaction fence.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {CONTRACT,ACTION}=require('./honartik-universal-installer-l4-v1.cjs');
const {decodeJws,verifyConsumedExactL4}=
  require('./honartik-universal-installer-l4-approval-verify-v1.cjs');
const POLICY='/opt/prhm-company-control-plane/config/approval-policy.json';
const PUBLIC_KEY='/var/lib/prhm-company-approval/ed25519-public.pem';
const CONSUMED='/var/lib/prhm-company-approval/consumed';
// Root receipt and signed-approval gate MUST share one immutable live-derived
// policy digest. Independent current-SHA review + trusted activation remain
// mandatory; this source-only alias cannot grant authorization.
const {PINNED_POLICY_SHA}=require('./honartik-universal-installer-native-approval-gate-v1.cjs');
const POLICY_SHA=PINNED_POLICY_SHA;
const POLICY_VERSION='2026-10-27.1-honartik-universal-installer-exact-l4-review';
// Computed independently from the EXISTING Host Actions v2 request route:
// argumentsSha256({action}) where request schema has exactly one key.
const FIXED_ARGUMENTS_SHA='eb28cb22e48d6baea121dc345fda996f40be550d4ad0160f185d006d3f45e4fc';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=b=>crypto.createHash('sha256').update(b).digest('hex');
const deny=x=>{throw Error('honartik_root_receipt_'+x)};
const identical=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const EXPECTED_OPERATION=Object.freeze({
  level:4,risk:'critical',requires_second_confirmation:true,
  one_time_use:true,requested_approver:'mohammad',expires_seconds:180,
  policy_version:POLICY_VERSION,
  rollback_reference:'host-action-v2:honartik-universal-installer-upgrade-v1:locked-preimage-journal-rollback'
});
const EXPECTED_SCOPE=Object.freeze({
  tool:'host_action_v2_apply',project:'control_plane',environment:'production',
  action:ACTION,risk:'critical',operation:CONTRACT.operation,
  principals:[{principal_id:'mohammad',roles:['mcp-operator']}]
});
function inspectPinnedPolicy(bytes){
  if(!Buffer.isBuffer(bytes)||HASH(bytes)!==POLICY_SHA)deny('policy_exact_sha_drift');
  let p;try{p=JSON.parse(bytes.toString('utf8'))}catch{deny('policy_invalid_json')}
  if(p.version!==POLICY_VERSION||p.default_deny!==true||
     p.scope_freeze!==true||p.one_time_use!==true||
     p.levels?.['4']?.human_approval!==true||
     p.levels?.['4']?.required_approver!=='mohammad'||
     p.levels?.['4']?.second_confirmation_required!==true||
     p.levels?.['4']?.max_ttl_seconds!==180||
     !identical(p.operations?.[CONTRACT.operation],EXPECTED_OPERATION)||
     !Array.isArray(p.typed_scopes)||
     p.typed_scopes.filter(s=>s?.action===ACTION||
        s?.operation===CONTRACT.operation).length!==1||
     !identical(p.typed_scopes.find(s=>s?.action===ACTION),EXPECTED_SCOPE))
    deny('policy_exact_scope_drift');
  return Object.freeze({version:POLICY_VERSION,sha256:POLICY_SHA,
    operation:CONTRACT.operation});
}
function fixedRequestHash(ledger){
 // A consumed ledger proves a prior event, NOT what this action requested.
 // Never treat ledger.request_hash as the expected authority by itself.
 const expected=HASH(Buffer.from(JSON.stringify({action:ACTION})));
 if(expected!==FIXED_ARGUMENTS_SHA)deny('canonical_action_hash_drift');
 if(!ledger||typeof ledger!=='object'||Array.isArray(ledger)||
    ledger.request_hash!==expected)deny('consumed_request_not_fixed_action');
 return expected;
}
function rootOnly(){
 if(typeof process.getuid!=='function'||process.getuid()!==0)
   deny('root_executor_required');
}
function ownedPath(p,leafType){
 // Check every existing ancestor, not only the leaf. An ancestor symlink
 // could redirect an otherwise well-formed absolute path.
 if(!path.isAbsolute(p)||path.normalize(p)!==p)deny('unsafe_fixed_path');
 let cursor=path.parse(p).root;
 const parts=p.slice(cursor.length).split(path.sep).filter(Boolean);
 for(let i=0;i<parts.length;i++){
   cursor=path.join(cursor,parts[i]);
   const st=fs.lstatSync(cursor);
   if(st.uid!==0||(st.mode&0o022)!==0||st.isSymbolicLink()||
      !(i===parts.length-1&&leafType==='file'?st.isFile():st.isDirectory()))
     deny('untrusted_owner_or_path');
 }
}
function readOwned(p,maxBytes){
 ownedPath(p,'file');
 const s=fs.lstatSync(p);
 if(s.size<1||s.size>maxBytes||s.nlink!==1)deny('file_size_or_link_denied');
 const flags=fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW;
 const fd=fs.openSync(p,flags);
 try{
   const now=fs.fstatSync(fd);
   if(!now.isFile()||now.uid!==0||now.dev!==s.dev||now.ino!==s.ino||
      now.size!==s.size||now.nlink!==1||(now.mode&0o022)!==0)
     deny('trusted_read_race');
   const bytes=fs.readFileSync(fd);
   if(bytes.length!==now.size)deny('short_trusted_read');
   return bytes;
 }finally{fs.closeSync(fd)}
}
function readOnlyRootReceiptPreflight(token){
 rootOnly();
 if(typeof token!=='string'||token.length<120||token.length>16384)
   deny('sealed_receipt_required');
 const policy=inspectPinnedPolicy(readOwned(POLICY,160000));
 ownedPath(CONSUMED,'directory');
 const issuerPublicKey=readOwned(PUBLIC_KEY,8192);
 const claims=decodeJws(token,issuerPublicKey);
 if(!UUID.test(claims.approval_id||''))deny('approval_id_invalid');
 const ledgerBytes=readOwned(path.join(CONSUMED,claims.approval_id+'.json'),16384);
 let ledger;try{ledger=JSON.parse(ledgerBytes.toString('utf8'))}
 catch{deny('ledger_json_invalid')}
 // The fixed one-field Host Actions v2 request independently determines
 // the required hash; the authoritative ledger and signed JWS must match it.
 // Merely reading the already-consumed ledger is NOT once-only execution.
 const expectedArgumentsSha=fixedRequestHash(ledger);
 const proof=verifyConsumedExactL4({token,issuerPublicKey,ledger,
   nowSec:Math.floor(Date.now()/1000),
   trustedPolicyVersion:policy.version,trustedPolicyHash:policy.sha256,
   trustedArgumentsSha256:expectedArgumentsSha});
 return Object.freeze({
   evidence_verified:proof.ok,action:ACTION,operation:CONTRACT.operation,
   approval_id:proof.approval_id,policy_sha256:policy.sha256,
   receipt_arguments_sha256:proof.arguments_sha256,
   installer_authorized:false,registration_authorized:false,
   production_mutated:false
 });
}
// No function in this module consumes the ledger, runs an action, or exports
// a generic root-file reader. Root-owned transaction binding is still pending.
module.exports=Object.freeze({
  POLICY_SHA,POLICY_VERSION,FIXED_ARGUMENTS_SHA,fixedRequestHash,
  readOnlyRootReceiptPreflight,inspectPinnedPolicy
});
