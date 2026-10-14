'use strict';
// IN-MEMORY FIXTURE ONLY. This module has no filesystem, process or network
// capability, performs NO root installation, and never authorizes a deployment.
const {CONTRACT,verifyPolicyTransition,verifyIssuerHealth}=require('./deploy-control-cutover-contract-v1.cjs');
const {createHash}=require('node:crypto');
const POLICY='/opt/prhm-company-control-plane/config/approval-policy.json';
const ARANOB='/etc/sudoers.d/aranob-deploy-runner';
const HONARTIK='/etc/sudoers.d/deploy-control-honartik';
const GATE='/etc/sudoers.d/prhm-deploy-control-gated';
const HELPER='/usr/local/libexec/deploy-control/deploy-project-authorized-v1.mjs';
const CORE='/usr/local/libexec/deploy-control/production-approval-core.mjs';
const PATHS=Object.freeze({POLICY,ARANOB,HONARTIK,GATE,HELPER,CORE});
const CHECKPOINTS=Object.freeze(['policy_written','helper_written','core_written','sudoers_swapped','health_check']);
function fail(name){throw Error('cutover_fixture_'+name)}
function clone(source) {
  if(!(source instanceof Map))fail('memory_map_only');
  const out=new Map();
  for(const [k,v] of source){
    if(typeof k!=='string'||!Buffer.isBuffer(v))fail('invalid_fixture_value');
    out.set(k,Buffer.from(v));
  }
  return out;
}
function sha(b){return createHash('sha256').update(b).digest('hex')}
function checksum(snapshot){
  return [...snapshot].map(([p,v])=>p+':'+sha(v)).sort().join('\n');
}
function rejectUnwiredDispatcher(helper,core){
  const h=helper.toString('utf8'),c=core.toString('utf8');
  // This is a conservative *source fixture check*, not a runtime trust proof.
  if(!/import\s*\{[^}]*verifyIssuerPolicy[^}]*\}\s*from\s*['"]\.\/production-approval-core\.mjs['"]/.test(h)||
     !/await\s+verifyIssuerPolicy\s*\(/.test(h)||
     !/await\s+consumeApprovedRelease\s*\(/.test(h)||
     h.indexOf('await verifyIssuerPolicy(')>h.indexOf('await consumeApprovedRelease(')||
     !/export\s+async\s+function\s+verifyIssuerPolicy\s*\(/.test(c))
    fail('issuer_attestation_not_wired');
  return true;
}
function validatedInputs(options) {
  if(!options||options.mode!=='isolated-memory-fixture'||Object.keys(options).some(k=>![
    'mode','state','policyCandidate','dispatcher','core','gatedSudoers',
    'issuerBefore','issuerAfter','failureAt'].includes(k))) fail('fixture_mode_or_schema');
  if(options.failureAt!==undefined&&options.failureAt!==null&&!CHECKPOINTS.includes(options.failureAt))
    fail('failure_injection_unknown');
  const initial=clone(options.state);
  for(const p of [POLICY,ARANOB,HONARTIK])if(!initial.has(p))fail('preimage_missing');
  for(const p of [GATE,HELPER,CORE])if(initial.has(p))fail('candidate_already_installed');
  for(const k of ['policyCandidate','dispatcher','core','gatedSudoers'])
    if(!Buffer.isBuffer(options[k])||options[k].length<10)fail('candidate_fixture_invalid');
  // The real Git live preimage and exact proposed JSON must be used even for
  // this isolated simulation. No user-provided paths, SHAs or secrets.
  verifyPolicyTransition(initial.get(POLICY),options.policyCandidate);
  verifyIssuerHealth(options.issuerBefore,'before');
  rejectUnwiredDispatcher(options.dispatcher,options.core);
  const sudo=options.gatedSudoers.toString('utf8').split(/\r?\n/).map(x=>x.trim())
    .filter(x=>x&&!x.startsWith('#'));
  const expected=[
    'Defaults:deploy-runner env_reset',
    'Defaults:deploy-runner !setenv',
    'Defaults:deploy-runner secure_path="/sbin:/bin:/usr/sbin:/usr/bin"',
    'deploy-runner ALL=(root) NOPASSWD: /usr/local/libexec/deploy-control/deploy-project-authorized-v1.mjs *'
  ];
  if(JSON.stringify(sudo)!==JSON.stringify(expected))fail('candidate_sudoers_drift');
  if(!initial.get(ARANOB).toString().includes('/home/prhm/deploy/aranob-production.sh')||
     !initial.get(HONARTIK).toString().includes('/honartik-front-production')||
     !initial.get(HONARTIK).toString().includes('/honartik-back-production'))
    fail('unexpected_legacy_grants');
  return initial;
}
// Applies changes ONLY to a cloned Map supplied by a disposable fixture.
// On fault the copy is restored bit-for-bit. This is NOT a host installer or
// a claim of atomic OS transaction. No mutations escape into the caller.
function simulate(options) {
  const original=validatedInputs(options);
  const result=clone(original),before=checksum(original),log=[];
  let step='preflight';
  function checkpoint(name) {
    step=name;
    log.push(name);
    if(options.failureAt===name)fail('injected_failure_'+name);
  }
  try {
    result.set(POLICY,Buffer.from(options.policyCandidate));
    checkpoint('policy_written');
    result.set(HELPER,Buffer.from(options.dispatcher));
    checkpoint('helper_written');
    result.set(CORE,Buffer.from(options.core));
    checkpoint('core_written');
    result.set(GATE,Buffer.from(options.gatedSudoers));
    result.delete(ARANOB);result.delete(HONARTIK);
    checkpoint('sudoers_swapped');
    verifyIssuerHealth(options.issuerAfter,'after');
    checkpoint('health_check');
    if(result.has(ARANOB)||result.has(HONARTIK)||!result.has(GATE))
      fail('postcondition_bad_sudo_grants');
    return Object.freeze({ok:true,fixture_only:true,installed_on_host:false,
      execution_authorized:false,checkpoints:log,simulated_state:result,
      original_state_unchanged:checksum(options.state)===before});
  } catch(e) {
    result.clear();
    for(const [p,v] of original)result.set(p,Buffer.from(v));
    if(checksum(result)!==before)fail('fixture_rollback_mismatch');
    return Object.freeze({ok:false,fixture_only:true,installed_on_host:false,
      execution_authorized:false,failed_at:step,error:e.message,rollback_simulated:true,
      original_state_unchanged:checksum(options.state)===before,
      restored_state:result,restored_checksum:checksum(result)});
  }
}
module.exports=Object.freeze({PATHS,CHECKPOINTS,rejectUnwiredDispatcher,simulate,checksum});
