'use strict';
/**
 * Issue #217 — fixed root-only Approval Center consumed-receipt proof.
 * SOURCE ONLY. The installed Host Actions v2 service must own the sealed
 * token, authenticate the issuer and consume the token once BEFORE this proof.
 * Neither this module nor its tests can mint, consume or apply Level 4.
 *
 * Direct CLI entry is absent. Live root registration MUST be separately
 * reviewed and installed through the pre-existing Root-of-Trust.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {CONTRACT}=require('./honartik-universal-installer-l4-v1.cjs');
const {decodeJws,verifyConsumedExactL4}=
  require('./honartik-universal-installer-l4-approval-verify-v1.cjs');
const ACTION=CONTRACT.action;
const POLICY='/opt/prhm-company-control-plane/config/approval-policy.json';
const PUBLIC='/var/lib/prhm-company-approval/ed25519-public.pem';
const CONSUMED='/var/lib/prhm-company-approval/consumed';
const FIXED_POLICY_VERSION='2026-10-27.1-honartik-universal-installer-exact-l4-review';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ARGUMENTS_SHA=crypto.createHash('sha256')
  .update(JSON.stringify({action:ACTION})).digest('hex');
const fail=x=>{throw Error('honartik217_l4_gate_'+x)};
const need=(x,n)=>{if(!x)fail(n)};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

function checkParents(file){
  let p=path.dirname(file);
  while(true){
    const st=fs.lstatSync(p);
    need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&
      (st.mode&0o022)===0,'untrusted_path_parent');
    if(p==='/')break;
    p=path.dirname(p);
  }
}
function rootRead(file,{min=1,max=1048576,privateOnly=false}={}){
  need(path.isAbsolute(file),'path_not_absolute');
  checkParents(file);
  const pre=fs.lstatSync(file);
  need(pre.isFile()&&!pre.isSymbolicLink()&&pre.uid===0&&
    (pre.mode&0o022)===0&&pre.size>=min&&pre.size<=max&&
    (!privateOnly||(pre.mode&0o777)===0o600),'root_file_untrusted');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const s=fs.fstatSync(fd);
    need(s.dev===pre.dev&&s.ino===pre.ino&&s.uid===pre.uid&&
      s.mode===pre.mode&&s.size===pre.size,'root_file_race');
    const data=fs.readFileSync(fd);
    need(data.length===s.size,'root_file_short_read');
    return data;
  }finally{fs.closeSync(fd)}
}
function parsePolicy(bytes){
  let p;
  try{p=JSON.parse(bytes.toString('utf8'))}catch{fail('invalid_policy_json')}
  need(p&&typeof p==='object'&&!Array.isArray(p)&&
    p.schema_version==='prhm.approval-policy.v1'&&
    p.default_deny===true&&p.one_time_use===true&&
    p.issuer==='prhm-company-approval'&&
    p.version===FIXED_POLICY_VERSION&&
    p.levels?.['4']?.human_approval===true&&
    p.levels?.['4']?.second_confirmation_required===true&&
    p.levels?.['4']?.max_ttl_seconds===180,'live_policy_not_approved');
  const op=p.operations?.[CONTRACT.operation];
  need(op&&op.level===4&&op.risk==='critical'&&
    op.requires_second_confirmation===true&&
    op.one_time_use===true&&op.expires_seconds===180&&
    op.policy_version===FIXED_POLICY_VERSION&&
    op.requested_approver==='mohammad','operation_scope_not_approved');
  const scopes=p.typed_scopes;
  need(Array.isArray(scopes),'typed_scopes_missing');
  const matches=scopes.filter(s=>s.action===ACTION);
  need(matches.length===1,'typed_scope_not_unique');
  const sc=matches[0];
  need(sc.tool==='host_action_v2_apply'&&sc.project==='control_plane'&&
    sc.environment==='production'&&sc.operation===CONTRACT.operation&&
    sc.risk==='critical'&&Array.isArray(sc.principals)&&
    sc.principals.length===1&&sc.principals[0].principal_id==='mohammad'&&
    JSON.stringify(sc.principals[0].roles)==='["mcp-operator"]',
    'typed_scope_not_exact');
  return {version:p.version,sha256:hash(bytes)};
}
function verifyFixedEvidence({token,publicKey,ledger,policyBytes,nowSec,requestId}){
  need(typeof requestId==='string'&&UUID.test(requestId),'request_id_invalid');
  const trusted=parsePolicy(policyBytes);
  const signed=decodeJws(token,publicKey);
  need(signed.request_id===requestId,'request_id_mismatch');
  const verified=verifyConsumedExactL4({
    token,issuerPublicKey:publicKey,ledger,nowSec,
    trustedPolicyVersion:trusted.version,
    trustedPolicyHash:trusted.sha256,
    trustedArgumentsSha256:ARGUMENTS_SHA
  });
  need(verified.request_id===requestId,'proof_request_id_mismatch');
  return Object.freeze({
    ok:true,action:ACTION,request_id:requestId,
    approval_id:verified.approval_id,policy_sha256:trusted.sha256,
    arguments_sha256:ARGUMENTS_SHA,signature_verified:true,
    consumed_ledger_verified:true,
    // Proof is read-only: the installed root adapter must independently
    // fence approval_id once in its durable installer transaction journal.
    execution_fence_reserved:false,installer_upgraded:false
  });
}
function readNativeConsumedProof(requestId,rootSealedTokenLoader){
  need(typeof process.getuid==='function'&&process.getuid()===0,'root_required');
  need(typeof requestId==='string'&&UUID.test(requestId),'request_id_invalid');
  need(typeof rootSealedTokenLoader==='function','trusted_vault_missing');
  const publicKey=rootRead(PUBLIC,{min:80,max:8192});
  const policyBytes=rootRead(POLICY,{min:100,max:131072});
  const token=rootSealedTokenLoader(requestId);
  need(typeof token==='string'&&token.length>=120&&token.length<=16384,
    'sealed_token_unavailable');
  // Check signature and signed identity BEFORE using the approval ID as a path.
  const signed=decodeJws(token,publicKey);
  need(signed.request_id===requestId&&UUID.test(signed.approval_id||''),
    'sealed_token_request_mismatch');
  const ledgerPath=CONSUMED+'/'+signed.approval_id+'.json';
  const ledgerBytes=rootRead(ledgerPath,{min:100,max:16384,privateOnly:true});
  let ledger;
  try{ledger=JSON.parse(ledgerBytes.toString('utf8'))}
  catch{fail('invalid_consumed_ledger')}
  return verifyFixedEvidence({
    token,publicKey,ledger,policyBytes,requestId,
    nowSec:Math.floor(Date.now()/1000)
  });
}
module.exports=Object.freeze({
  ACTION,ARGUMENTS_SHA,parsePolicy,verifyFixedEvidence,
  readNativeConsumedProof,
  LIVE_REGISTRATION_PRESENT:false,
  INSTALL_APPLY_EXPORTED:false
});
