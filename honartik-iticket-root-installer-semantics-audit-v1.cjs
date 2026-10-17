'use strict';
/**
 * READ-ONLY offline installer semantic audit.
 * Accepts bytes from caller; absolutely no filesystem access, write, process
 * execution, network, or authorization. Does not execute installer source.
 *
 * A PASS is only a syntax/pin/diff preflight; NEVER an install authorization.
 */
const vm=require('node:vm');
const review=require('./honartik-iticket-root-installer-four-owner-review-v1.cjs');
const crypto=require('node:crypto');
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fail(reason){throw new Error('installer_semantics_audit_'+reason);}

const HAZARDS=Object.freeze([
  Object.freeze({id:'filesystem_write', re:/\b(?:writeFileSync|renameSync|appendFileSync|openSync|copyFileSync|rmSync|unlinkSync|mkdirSync|chmodSync|chownSync)\s*\(/g}),
  Object.freeze({id:'process_control', re:/\b(?:spawnSync|execSync|execFileSync|spawn|exec|execFile|systemctl|systemd-run)\b/g}),
  Object.freeze({id:'source_patch', re:/\b(?:repl|replaceOnce|replace|patchBase|patchExec|patchPolicy|patchMcp|patchMcpPlugin)\s*\(/g}),
  Object.freeze({id:'rollback_marker', re:/\b(?:rollback|restore|backup)\b/ig}),
  Object.freeze({id:'approval_marker', re:/\b(?:approval|Ed25519|second_confirmation|CONFIRM_LEVEL_4_CRITICAL)\b/ig}),
]);

function staticReview(source,candidate){
  if(typeof source!=='string'||typeof candidate!=='string')fail('sources_required');
  // vm.Script only COMPArses JS; no context, require or run. Syntax exceptions abort.
  try {new vm.Script(source,{filename:'original-installer.js'});}
  catch(e){fail('original_syntax_invalid');}
  try {new vm.Script(candidate,{filename:'candidate-installer.js'});}
  catch(e){fail('candidate_syntax_invalid');}
  const hazards=Object.fromEntries(HAZARDS.map(({id,re})=>[id,(source.match(re)||[]).length]));
  // Same number of occurrences of code-impacting operation references: one
  // narrow data-only hash rebind may not add/remove functional declarations.
  for(const {id,re} of HAZARDS) {
    if((source.match(re)||[]).length !== (candidate.match(re)||[]).length)
      fail('operation_reference_changed_'+id);
  }
  const before=Buffer.from(source,'utf8'),after=Buffer.from(candidate,'utf8');
  if(before.length!==after.length)fail('source_size_changed');
  return Object.freeze({
    schema:'prhm.iticket.installer-semantics-readonly-audit.v1',
    syntax_before:'PASS',
    syntax_after:'PASS',
    source_bytes:before.length,
    source_sha256:sha256(before),
    candidate_sha256:sha256(after),
    code_operation_reference_counts:hazards,
    source_only:true,
    source_exposed:false,
    production_mutation:false,
    safe_to_install:false,
    requires_review_of_actual_write_targets:true,
    requires_approved_rollback:true,
    requires_fresh_signed_authorization:true,
  });
}

/** Review original *verified* installed bytes against all four on-host owner files. */
function audit({installerBytes,liveOwnerBytes}={}){
  const r=review.makeReview({installerBytes,liveOwnerBytes});
  const out=staticReview(installerBytes.toString('utf8'),r.review_candidate_bytes.toString('utf8'));
  if(out.source_sha256!==review.INSTALLER_SHA256||
      out.candidate_sha256!==r.review_candidate_sha256)
    fail('attestation_inconsistent');
  return out;
}
module.exports=Object.freeze({HAZARDS,staticReview,audit});
