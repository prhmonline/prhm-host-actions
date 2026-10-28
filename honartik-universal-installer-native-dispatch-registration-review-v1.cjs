'use strict';
/**
 * PRHM #217, source-only fixed native dispatcher binding review.
 * Does NOT install root helper, edit server, activate Policy, obtain/consume
 * signed Level 4 or authorize release. Replaces the exact fail-closed
 * dispatcher placeholder IN THE REVIEW CANDIDATE ONLY after verifying
 * all 3 installed owner SHA preimages and the reviewed shim Git blob.
 */
const crypto=require('node:crypto');
const P=require('./honartik-universal-installer-owner-registration-candidate-v1.cjs');
const REG=require('./honartik-universal-installer-registration-review-pack-v1.cjs');
const ACTION='honartik_universal_installer_upgrade_v1';
const SHIM='honartik-universal-installer-native-dispatch-trust-v1.cjs';
const SHIM_BLOB='bc0b277dc5979fcdaaa00674feda8bf1949ad1c1';
const SHIM_ROOT='/opt/prhm-agent-selfmaint-exec/actions/'+SHIM;
const DENY="throw new Error('honartik_universal_installer_upgrade_v1_native_root_dispatch_not_reviewed');";
const FORWARD="return require('"+SHIM_ROOT+"').runFixedRegisteredAction(l4Binding);";
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const blob=value=>crypto.createHash('sha1').update('blob '+value.length+'\0').update(value).digest('hex');
const fail=reason=>{throw Error('honartik217_review_binding_'+reason)};
function once(src,anchor,tag){
 if(typeof src!=='string'||src.split(anchor).length!==2)
  fail('ambiguous_'+tag);
}
function reviewCandidate(candidate,shimBytes){
 if(!Buffer.isBuffer(shimBytes)||blob(shimBytes)!==SHIM_BLOB)
  fail('shim_git_blob_drift');
 if(!candidate||candidate.action!==ACTION||
  candidate.security_boundary?.level4_only!==true||
  candidate.security_boundary?.root_dispatch_explicitly_denied!==true||
  candidate.security_boundary?.fixed_authenticated_request_context_injected_after_consume!==true||
  candidate.security_boundary?.consumed_token_remains_in_executor_memory!==true||
  candidate.security_boundary?.install_authorized!==false||
  candidate.security_boundary?.production_mutation!==false)
  fail('unreviewed_owner_context');
 if(JSON.stringify(candidate.source_preimages)!==
  JSON.stringify(Object.fromEntries(['base','executor','mcp'].map(k=>[k,REG.TARGETS[k].sha256]))))
  fail('owner_preimages_changed');
 const files=candidate.proposed_owner_text;
 if(!files||typeof files.base!=='string'||typeof files.executor!=='string'||typeof files.mcp!=='string')
  fail('owner_source_missing');
 once(files.executor,DENY,'fail_closed_dispatcher');
 once(files.executor,"loadConsumedServerToken:",'server_token_closure');
 once(files.executor,"authorize-consume",'consumed_route');
 const executor=files.executor.replace(DENY,FORWARD);
 once(executor,FORWARD,'native_forward');
 if(executor.includes(DENY))fail('deny_placeholder_not_removed');
 if(!files.base.includes('const HOST_ACTION_V2_LEVEL3 = new Set('))
  fail('level3_classifier_missing');
 const l3=files.base.split('const HOST_ACTION_V2_LEVEL3 = new Set(')[1].split('function hostActionV2ApprovalMeta')[0];
 if(l3.includes(ACTION))fail('level3_promotion_forbidden');
 return Object.freeze({
  schema:'prhm.honartik217.native-root-dispatch-review-only.v1',
  action:ACTION,shim_blob:SHIM_BLOB,shim_absolute_path:SHIM_ROOT,
  original_preimages:candidate.source_preimages,
  proposed_owner_sha256:Object.freeze({
   base:hash(Buffer.from(files.base)),
   executor:hash(Buffer.from(executor)),
   mcp:hash(Buffer.from(files.mcp))
  }),
  // For offline, independent source review only. No writer or CLI.
  proposed_owner_text:Object.freeze({base:files.base,executor,mcp:files.mcp}),
  security_boundary:Object.freeze({
   level4_only:true,independent_consumed_receipt_required:true,
   trusted_root_shim_blob_required:true,
   installed_helper_present:false,live_policy_activated:false,
   independent_review_complete:false,real_linux_rollback_attested:false,
   trusted_root_registration_complete:false,install_authorized:false,
   production_mutation:false
  })
 });
}
function previewPinnedProduction(readOwner,readShim){
 if(typeof readShim!=='function')fail('shim_reader_required');
 // Owner verifier requires exact raw live bytes and validates all 3 SHA.
 return reviewCandidate(P.previewOwnerPatch(readOwner),readShim(SHIM));
}
function previewIsolatedSynthetic(files,shimBytes){
 // Test-only synthetic fixtures must be clearly marked and non-root.
 return reviewCandidate(P.previewIsolatedSyntheticFixture(files),shimBytes);
}
module.exports=Object.freeze({
 ACTION,SHIM,SHIM_BLOB,SHIM_ROOT,previewPinnedProduction,
 previewIsolatedSynthetic,REVIEW_ONLY:true,PRODUCTION_INSTALL_AUTHORIZED:false
});
