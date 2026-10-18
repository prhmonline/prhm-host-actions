'use strict';
/**
 * OFFLINE ONLY. Cryptographic contract for a FUTURE PRHM Level4 root grant.
 *
 * Deliberate limitations:
 *  1) No pinned live Ed25519 trust anchor is available in this module.
 *     Caller's public key MUST NEVER be accepted by a production adapter
 *     until bound to the on-host Approval Center independently.
 *  2) Verifying a signature does NOT consume a grant, prevent replay, or
 *     authorize a transaction. Replay/approval binding remains external.
 *  3) This module performs NO file reads/writes, approvals, service changes,
 *     external IO, deployments, or shell execution.
 *
 * The schema below is PROPOSED, not claimed compatible with live issuer.
 */
const crypto=require('node:crypto');
const ACTION='honartik_git_worktree_fixed_v1';
const OPERATION='host_action.'+ACTION;
const AUDIENCE='prhm-company-control-plane:root-four-owner-installer-v1';
const ROLLBACK='host-action-v2:honartik-git-worktree-fixed-v1:worktree-remove';
const SCHEMA='prhm.control-plane.root-four-owner-ed25519-grant.proposed.v1';
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PRE=Object.freeze({
  base:'4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406',
  exec:'410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0',
  policy:'148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174',
  mcp:'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166'
});
const POST=Object.freeze({
  base:'629212ae3052eab380ea1b3fc7c0b15395dfb23a251331762ebb781e1bbf1b2f',
  exec:'9dade5d2a9a9722c1dd1283a3a1002325da02e134804aca1ea6d673cf2de3e87',
  policy:'9a2c47db59211a638976ee181e8a5b246c79f082371d82a7396c6a07f646faa7',
  mcp:'52d3c0c04cd3bb26815403e2c089f9a408047bd9d376536ae570df669a7fd2a3'
});
function fail(v){throw Error('signed_grant_contract_'+v);}
function equalPin(x,expected,kind){
  if(!x||typeof x!=='object'||Array.isArray(x)||
     Object.keys(x).length!==4)fail('wrong_pins_'+kind);
  for(const [k,sha] of Object.entries(expected)){
    if(typeof x[k]!=='string'||!HASH.test(x[k])||x[k]!==sha)fail('sha_mismatch_'+kind+'_'+k);
  }
}
function canonicalObject(v){
  if(v===null)return 'null';
  if(typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
  if(typeof v==='number'){
    if(!Number.isSafeInteger(v))fail('noninteger_value');
    return JSON.stringify(v);
  }
  if(Array.isArray(v))return '['+v.map(canonicalObject).join(',')+']';
  if(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype){
    const keys=Object.keys(v).sort();
    if(keys.some(k=>['__proto__','constructor','prototype'].includes(k)))fail('unsafe_key');
    return '{'+keys.map(k=>JSON.stringify(k)+':'+canonicalObject(v[k])).join(',')+'}';
  }
  fail('noncanonical_value');
}
function checkPayload(p,now){
  if(!p||typeof p!=='object'||Array.isArray(p))fail('payload_invalid');
  const required=[
    'action','audience','expires_at','issued_at','issuer','jti','level',
    'operation','owner_post_sha256','owner_pre_sha256','policy_version',
    'requested_approver','risk','rollback_reference','schema',
    'second_confirmation'
  ];
  if(Object.keys(p).sort().join(',')!==required.sort().join(','))fail('payload_keys_invalid');
  if(p.schema!==SCHEMA||p.action!==ACTION||p.operation!==OPERATION||
     p.audience!==AUDIENCE||p.issuer!=='prhm-company-approval'||
     p.rollback_reference!==ROLLBACK||p.level!==4||p.risk!=='critical'||
     p.requested_approver!=='mohammad'||p.second_confirmation!==true||
     p.policy_version!=='2026-10-18.1-honartik-worktree-level4-v1')
    fail('action_binding_invalid');
  if(typeof p.jti!=='string'||!UUID.test(p.jti))fail('jti_invalid');
  if(!Number.isSafeInteger(now)||now<0||
     !Number.isSafeInteger(p.issued_at)||!Number.isSafeInteger(p.expires_at)||
     p.issued_at<0||p.expires_at<=p.issued_at||
     p.expires_at-p.issued_at>180||now<p.issued_at||now>=p.expires_at)
    fail('expiry_invalid');
  equalPin(p.owner_pre_sha256,PRE,'pre');
  equalPin(p.owner_post_sha256,POST,'post');
  return true;
}
function decodeCanonicalBase64url(s){
  if(typeof s!=='string'||!s.length||!/^[A-Za-z0-9_-]+$/.test(s))fail('base64url_invalid');
  const buf=Buffer.from(s,'base64url');
  if(buf.toString('base64url')!==s)fail('noncanonical_base64url');
  return buf;
}
function verifyOffline({payload,signature,issuerPublicKey,now}={}){
  checkPayload(payload,now);
  // Do not accept arbitrary key types (RSA, symmetric, P-256 etc).
  if(!(issuerPublicKey instanceof crypto.KeyObject)||
     issuerPublicKey.type!=='public'||issuerPublicKey.asymmetricKeyType!=='ed25519')
    fail('public_ed25519_key_required');
  const digest=crypto.createHash('sha256').update(issuerPublicKey.export({type:'spki',format:'der'})).digest('hex');
  const sig=decodeCanonicalBase64url(signature);
  if(sig.length!==64)fail('signature_length');
  const message=Buffer.from(canonicalObject(payload),'utf8');
  if(!crypto.verify(null,message,issuerPublicKey,sig))fail('signature_invalid');
  return Object.freeze({
    schema:'prhm.iticket.l4-signed-grant-verification-fixture.v1',
    signature_valid_under_supplied_key:true,
    supplied_key_spki_sha256:digest,
    fixed_operation:OPERATION,
    fixed_pre_and_post_shas:true,
    expires_in_seconds:payload.expires_at-now,
    live_trust_anchor_attested:false,
    effective_issuer_semantics_attested:false,
    replay_prevention_attested:false,
    real_second_confirmation_attested:false,
    registration_authorized:false,install_authorized:false,
    production_mutation:false
  });
}
module.exports=Object.freeze({ACTION,OPERATION,AUDIENCE,ROLLBACK,SCHEMA,PRE,POST,
  canonicalObject,checkPayload,verifyOffline});
